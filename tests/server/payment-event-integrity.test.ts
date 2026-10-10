import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { applyPaymentEvent } from "@/server/payments";
import { cancelPurchase } from "@/server/subscriptions";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Payment-integrity!123", secret = "mock-payment-integrity-0123456789abcdef";
let userId: string, ctx: Context, subscriptionId: string, orderId: string;
const email = "integrity-" + randomUUID() + "@catchsecu.test";
function authRequest(path: string, input: unknown) { return new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) }); }
const applyRaw = (body: string) => applyPaymentEvent(body, createHmac("sha256", secret).update(body).digest("hex"), secret);
const apply = (input: unknown) => applyRaw(JSON.stringify(input));
const event = (outcome: string, extra = {}) => ({ orderId, eventId: randomUUID(), outcome, ...extra });
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(authRequest("sign-up/email", { name: "결제 무결성", email, password }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
});
beforeEach(async () => {
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "결제 무결성 QA", publicName: "결제 무결성", policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId, role: "owner" } } } });
  const signed = await auth.handler(authRequest("sign-in/email", { email, password })); expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(new Headers({ cookie }), "billing.write");
  const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "합성 상품" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000, features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 86400e3) } });
  subscriptionId = (await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000 } })).id;
  orderId = (await db.paymentOrder.create({ data: { tenantId: company.id, subscriptionId, amount: 12000, currency: "KRW" } })).id;
});
afterAll(async () => { await db.$disconnect(); });
async function state() {
  return {
    subscription: await db.billingSubscription.findUnique({ where: { id: subscriptionId } }),
    order: await db.paymentOrder.findUnique({ where: { id: orderId } }),
    events: await db.paymentEvent.findMany({ where: { orderId }, orderBy: { id: "asc" } }),
    refunds: await db.paymentRefund.findMany({ where: { orderId }, orderBy: { id: "asc" } }),
    ledger: await db.ledgerTransaction.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { id: "asc" } }),
    audits: await db.auditEvent.count({ where: { tenantId: ctx.tenantId } }),
  };
}
for (const outcome of ["paid", "failed"] as const) {
  test(`${outcome}: 환불 식별자가 섞인 승인·실패 이벤트를 거절한다`, async () => {
    const before = await state();
    await expect(apply(event(outcome, { refundId: randomUUID() }))).rejects.toMatchObject({ status: 422 });
    expect(await state()).toEqual(before);
  });
}
for (const outcome of ["refunded", "refund_rejected"] as const) {
  test(`${outcome}: 성공 이벤트 재전송도 환불 식별자 누락을 거절한다`, async () => {
    await apply(event("paid"));
    const refund = await db.paymentRefund.create({ data: { tenantId: ctx.tenantId, orderId, amount: 2000, currency: "KRW", reason: "합성 환불" } });
    const done = event(outcome, { refundId: refund.id }); await apply(done);
    const before = await state();
    await expect(apply({ orderId, eventId: done.eventId, outcome })).rejects.toMatchObject({ status: 422 });
    expect(await state()).toEqual(before);
  });
}
test("서명은 유효해도 잘못된 JSON은 서버500 대신400으로 거절한다", async () => {
  const before = await state();
  await expect(applyRaw('{"orderId":')).rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });
  expect(await state()).toEqual(before);
});
test("결제 진행 중 구독 취소는 거절하고 업무·감사·요청 키를 유지한다", async () => {
  const key = randomUUID(), before = await state();
  await expect(cancelPurchase(ctx, subscriptionId, 1, key, randomUUID())).rejects.toMatchObject({ status: 409, code: "PAYMENT_IN_PROGRESS" });
  expect(await state()).toEqual(before); expect(await db.idempotencyRecord.count({ where: { key } })).toBe(0);
});
test("이미 취소된 과거 구독의 뒤늦은 승인은 원장만 충전하지 않는다", async () => {
  // 과거 코드/데이터의 취소된 구독 + pending 주문을 재현한다.
  await db.billingSubscription.update({ where: { id: subscriptionId }, data: { status: "cancelled", version: 2 } });
  const before = await state();
  await expect(apply(event("paid"))).rejects.toMatchObject({ status: 409, code: "SUBSCRIPTION_UNAVAILABLE" });
  expect(await state()).toEqual(before);
});

test("결제 실패 확인 후에는 같은 취소 요청 키로 정상 취소할 수 있다", async () => {
  const key = randomUUID();
  await expect(cancelPurchase(ctx, subscriptionId, 1, key, randomUUID())).rejects.toMatchObject({ code: "PAYMENT_IN_PROGRESS" });
  await apply(event("failed"));
  const result = await cancelPurchase(ctx, subscriptionId, 1, key, randomUUID());
  expect(result.body).toMatchObject({ status: "cancelled", version: 2 });
  expect(await db.ledgerTransaction.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
});
test("승인과 구독 취소 경합은 활성 구독·한 번 충전으로 끝나며 취소는409다", async () => {
  const results = await Promise.allSettled([apply(event("paid")), cancelPurchase(ctx, subscriptionId, 1, randomUUID(), randomUUID())]);
  expect(results[0].status).toBe("fulfilled");
  expect(results[1]).toMatchObject({ status: "rejected", reason: { status: 409 } });
  const saved = await state(); expect(saved.subscription?.status).toBe("active"); expect(saved.order?.status).toBe("paid");
  expect(saved.ledger).toHaveLength(1); expect(saved.events).toHaveLength(1);
});
test("동일 환불 이벤트 ID로 다른 환불 대상을 보내면409이며 두 번째 환불은 대기다", async () => {
  await apply(event("paid"));
  const first = await db.paymentRefund.create({ data: { tenantId: ctx.tenantId, orderId, amount: 2000, reason: "첫 환불" } });
  const second = await db.paymentRefund.create({ data: { tenantId: ctx.tenantId, orderId, amount: 2000, reason: "둘째 환불" } });
  const done = event("refunded", { refundId: first.id }); await apply(done);
  const before = await state();
  await expect(apply({ ...done, refundId: second.id })).rejects.toMatchObject({ status: 409, code: "DUPLICATE_EVENT" });
  expect(await state()).toEqual(before);
  expect((await db.paymentRefund.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("requested");
});
for (const outcome of ["refunded", "refund_rejected"] as const) {
  test(`${outcome}: 정확한 환불 이벤트 재전송은 상태·원장·감사를 변경하지 않는다`, async () => {
    await apply(event("paid"));
    const refund = await db.paymentRefund.create({ data: { tenantId: ctx.tenantId, orderId, amount: 2000, reason: "환불 재전송" } });
    const done = event(outcome, { refundId: refund.id }); await apply(done);
    const before = await state(); expect((await apply(done)).duplicate).toBe(true);
    expect(await state()).toEqual(before);
  });
}
