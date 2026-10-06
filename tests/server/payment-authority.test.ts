import { randomUUID, createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { createPaymentMethod, updatePaymentMethod, removePaymentMethod, listPaymentMethods } from "@/server/payment-methods";
import { listPaymentOrders, readPaymentOrder, rejectPaymentReturn, applyPaymentEvent, requestPaymentOrder } from "@/server/payments";
import { POST as createOrder } from "@/app/api/v1/billing/orders/route";

const clock = vi.hoisted(() => ({ advance: false, cache: false }));
vi.mock("@/server/audit", async original => {
  const actual = await original<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (clock.advance) { clock.advance = false; vi.setSystemTime(Date.now() + 120_000); }
  } };
});
vi.mock("@/server/crypto", async original => {
  const actual = await original<typeof import("@/server/crypto")>();
  return { ...actual, encrypt: (...args: Parameters<typeof actual.encrypt>) => {
    const result = actual.encrypt(...args);
    if (clock.cache) { clock.cache = false; vi.setSystemTime(Date.now() + 120_000); }
    return result;
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const email = "payment-authority@catchsecu.test", password = "Payment-authority!123";
let userId: string, ownerId: string, ctx: Context, methodId: string, orderId: string, subscriptionId: string, cookie: string;
function req(path: string, input: unknown, key?: string) {
  return new Request(origin + "/api/v1/" + path, { method: "POST", headers: { origin, cookie: cookie ?? "", "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(input) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(req("auth/sign-up/email", { email, password, name: "결제 담당자" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  ownerId = (await db.user.create({ data: { name: "소유자", email: randomUUID() + "@catchsecu.test", emailVerified: true } })).id;
});
beforeEach(async () => {
  clock.advance = false; clock.cache = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "결제 권한 시험", publicName: "결제 권한 시험", policy: { create: { passwordMonths: 0 } }, memberships: { create: [{ userId, role: "billing" }, { userId: ownerId, role: "owner" }] } } });
  const signed = await auth.handler(req("auth/sign-in/email", { email, password }));
  expect(signed.status).toBe(200);
  cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(new Headers({ cookie }), "billing.write");
  methodId = (await createPaymentMethod(ctx, { token: "pm_" + randomUUID().replace(/[0-9]/g, digit => String.fromCharCode(107 + Number(digit))), kind: "card", label: "첫 수단", setDefault: false }, randomUUID())).id;
  const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "결제 테스트" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000, features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 86400e3) } });
  subscriptionId = (await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000 } })).id;
  orderId = (await db.paymentOrder.create({ data: { tenantId: company.id, subscriptionId, amount: 12000, currency: "KRW" } })).id;
});
afterAll(async () => { clock.advance = false; clock.cache = false; vi.useRealTimers(); await db.$disconnect(); });
const operations = {
  methodList: () => listPaymentMethods(ctx, { includeRevoked: false }),
  methodCreate: () => createPaymentMethod(ctx, { token: "pm_" + randomUUID().replace(/[0-9]/g, digit => String.fromCharCode(107 + Number(digit))), label: "추가 수단", kind: "card", setDefault: true }, randomUUID()),
  methodUpdate: () => updatePaymentMethod(ctx, methodId, { version: 1, label: "변경" }, randomUUID()),
  methodRemove: () => removePaymentMethod(ctx, methodId, 1, randomUUID()),
  orderCreate: () => requestPaymentOrder(ctx, { subscriptionId }, randomUUID(), randomUUID()),
  orderList: () => listPaymentOrders(ctx), orderRead: () => readPaymentOrder(ctx, orderId), orderReturn: () => rejectPaymentReturn(ctx, orderId),
};
async function state() {
  return { methods: await db.paymentMethod.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { id: "asc" } }),
    orders: await db.paymentOrder.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { id: "asc" } }),
    audits: await db.auditEvent.count({ where: { tenantId: ctx.tenantId } }) };
}
for (const name of Object.keys(operations) as (keyof typeof operations)[]) {
  test(`${name}: 이미 읽은 문맥도 현재 권한 회수를 적용한다`, async () => {
    await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer", version: { increment: 1 } } });
    const before = await state();
    await expect(operations[name]()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await state()).toEqual(before);
  });
  test(`${name}: 회수된 세션은 차단한다`, async () => {
    await db.session.delete({ where: { id: ctx.session.id } });
    const before = await state();
    await expect(operations[name]()).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(await state()).toEqual(before);
  });
}
for (const name of ["methodCreate", "methodUpdate", "methodRemove"] as const) {
  test(`${name}: 감사 저장 중 세션 만료도 업무와 감사를 모두 롤백한다`, async () => {
    await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
    const before = await state(); vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
    await expect(operations[name]()).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    vi.useRealTimers(); expect(await state()).toEqual(before);
  });
}
for (const change of ["create", "update"] as const) {
  test(`${change}: 대표 교체는 기존 수단의 버전도 갱신해 옛 화면 수정이 충돌한다`, async () => {
    const second = await createPaymentMethod(ctx, { token: "pm_" + randomUUID().replace(/[0-9]/g, digit => String.fromCharCode(107 + Number(digit))), label: "둘째", kind: "card", setDefault: change === "create" }, randomUUID());
    if (change === "update") await updatePaymentMethod(ctx, second.id, { version: 1, setDefault: true }, randomUUID());
    const first = await db.paymentMethod.findUniqueOrThrow({ where: { id: methodId } });
    expect(first).toMatchObject({ isDefault: false, version: 2 });
    await expect(updatePaymentMethod(ctx, methodId, { version: 1, label: "오래된 수정" }, randomUUID())).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });
}
test("주문 생성 재전송은 서명 승인 후 최신 paid 상태를 반환한다", async () => {
  const key = randomUUID(), input = { subscriptionId };
  const first = await createOrder(req("billing/orders", input, key)); expect(first.status).toBe(201);
  const secret = "local-payment-test-secret", raw = JSON.stringify({ orderId, eventId: randomUUID(), outcome: "paid" });
  await applyPaymentEvent(raw, createHmac("sha256", secret).update(raw).digest("hex"), secret);
  const replay = await createOrder(req("billing/orders", input, key)); expect(replay.status).toBe(201);
  expect(await replay.json()).toMatchObject({ id: orderId, status: "paid", version: 2 });
});

for (const revoke of ["role", "session"] as const) {
  test(`주문 재요청: ${revoke} 회수는 과거 성공 응답도 차단한다`, async () => {
    const key = randomUUID(); await requestPaymentOrder(ctx, { subscriptionId }, key, randomUUID());
    if (revoke === "role") await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer", version: { increment: 1 } } });
    else await db.session.delete({ where: { id: ctx.session.id } });
    const before = await state();
    await expect(requestPaymentOrder(ctx, { subscriptionId }, key, randomUUID())).rejects.toMatchObject({ status: revoke === "role" ? 403 : 401 });
    expect(await state()).toEqual(before);
  });
}
test("주문 캐시 저장 도중 세션 만료는 신규 주문·감사·키를 전부 롤백한다", async () => {
  await db.paymentOrder.delete({ where: { id: orderId } });
  await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  const key = randomUUID(), before = await state(); vi.useFakeTimers({ toFake: ["Date"] }); clock.cache = true;
  await expect(requestPaymentOrder(ctx, { subscriptionId }, key, randomUUID())).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  vi.useRealTimers(); expect(await state()).toEqual(before);
  expect(await db.idempotencyRecord.count({ where: { key } })).toBe(0);
});
test("같은 version 동시 수정은 하나만 성공하며 대표는 하나다", async () => {
  const results = await Promise.allSettled([operations.methodUpdate(), operations.methodUpdate()]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  expect(await db.paymentMethod.count({ where: { tenantId: ctx.tenantId, isDefault: true } })).toBe(1);
});
test("다른 결제수단을 요청하면 기존 대기 주문을 성공처럼 반환하지 않는다", async () => {
  await expect(requestPaymentOrder(ctx, { subscriptionId, methodId }, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, code: "ORDER_METHOD_CONFLICT" });
  expect(await db.paymentOrder.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
});
test("서로 다른 키의 동시 주문도 같은 대기 주문 하나만 만든다", async () => {
  await db.paymentOrder.delete({ where: { id: orderId } });
  const responses = await Promise.all([operations.orderCreate(), operations.orderCreate()]);
  expect(responses[0].body.id).toBe(responses[1].body.id);
  expect(await db.paymentOrder.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId, action: "billing.order_created" } })).toBe(1);
});
test("수단 해지와 주문 생성 경합에서 해지된 수단의 대기 주문은 생기지 않는다", async () => {
  await db.paymentOrder.delete({ where: { id: orderId } });
  const outcomes = await Promise.allSettled([
    requestPaymentOrder(ctx, { subscriptionId, methodId }, randomUUID(), randomUUID()), operations.methodRemove(),
  ]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = (outcomes.find(result => result.status === "rejected") as PromiseRejectedResult).reason;
  expect(["METHOD_IN_USE", "METHOD_INACTIVE"]).toContain(rejected.code);
  const method = await db.paymentMethod.findUniqueOrThrow({ where: { id: methodId } });
  const pending = await db.paymentOrder.count({ where: { methodId, status: "pending" } });
  expect(method.status === "active" || pending === 0).toBe(true);
});
test("변경된 MFA 정책과 현재 회사 선택을 적용한다", async () => {
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
  await expect(operations.methodCreate()).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: false } });
  const other = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
  await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: other.id } });
  await expect(operations.orderCreate()).rejects.toMatchObject({ status: 403, code: "COMPANY_CHANGED" });
});
