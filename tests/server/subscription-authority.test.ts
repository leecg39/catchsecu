import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { plans, subscriptions, entitlement, assetOverview, requestPurchase, cancelPurchase, scheduleTrialCancellation, undoTrialCancellation } from "@/server/subscriptions";

const clock = vi.hoisted(() => ({ advance: false }));
vi.mock("@/server/crypto", async original => {
  const actual = await original<typeof import("@/server/crypto")>();
  return { ...actual, encrypt: (...args: Parameters<typeof actual.encrypt>) => {
    const result = actual.encrypt(...args);
    if (clock.advance) { clock.advance = false; vi.setSystemTime(Date.now() + 120_000); }
    return result;
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const email = "subscription-authority@catchsecu.test", password = "Subscription-authority!123";
let userId: string, ownerId: string, ctx: Context, pendingId: string, activeId: string;
const planVersionId = "privacy-lifecycle-month-v1";
const future = () => new Date(Date.now() + 4 * 3600e3);
function authRequest(path: string, input: unknown) {
  return new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(authRequest("sign-up/email", { email, password, name: "결제 담당자" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  ownerId = (await db.user.create({ data: { name: "별도 소유자", email: "owner-" + randomUUID() + "@catchsecu.test", emailVerified: true } })).id;
});
beforeEach(async () => {
  clock.advance = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "구독 권한 시험", publicName: "구독 권한 시험",
    policy: { create: { passwordMonths: 0 } }, memberships: { create: [{ userId, role: "billing" }, { userId: ownerId, role: "owner" }] } } });
  const signed = await auth.handler(authRequest("sign-in/email", { email, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(new Headers({ cookie }), "billing.write");
  for (const active of [false, true]) {
    const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "합성 구독" } });
    const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000,
      features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 86400e3) } });
    const row = await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id,
      planVersionId: version.id, status: "pending", priceKrw: 12000 } });
    if (!active) { pendingId = row.id; continue; }
    activeId = row.id;
    await db.paymentOrder.create({ data: { tenantId: company.id, subscriptionId: row.id, amount: 12000, currency: "KRW", status: "paid" } });
    await db.billingSubscription.update({ where: { id: row.id }, data: { status: "active", activationSource: "payment",
      periodStart: new Date(Date.now() - 86400e3), periodEnd: new Date(Date.now() + 30 * 86400e3), version: 2 } });
    await db.billingSubscription.update({ where: { id: row.id }, data: { cancelAt: new Date(Date.now() + 2 * 3600e3), version: 3 } });
  }
});
afterAll(async () => { clock.advance = false; vi.useRealTimers(); await db.$disconnect(); });

const operations = {
  plans: () => plans(ctx), list: () => subscriptions(ctx), entitlement: () => entitlement(ctx), assets: () => assetOverview(ctx),
  purchase: () => requestPurchase(ctx, planVersionId, randomUUID(), randomUUID()),
  cancel: () => cancelPurchase(ctx, pendingId, 1, randomUUID(), randomUUID()),
  schedule: () => scheduleTrialCancellation(ctx, activeId, 3, future(), randomUUID(), randomUUID(), "비용 조정"),
  undo: () => undoTrialCancellation(ctx, activeId, 3, randomUUID(), randomUUID()),
};
for (const operation of Object.keys(operations) as (keyof typeof operations)[]) {
  test(`${operation}: 이미 조회한 문맥도 회수된 결제 권한을 다시 검사한다`, async () => {
    await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer", version: { increment: 1 } } });
    const before = await state();
    await expect(operations[operation]()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await state()).toEqual(before);
  });
}
for (const operation of ["purchase", "cancel", "schedule", "undo"] as const) {
  test(`${operation}: 회수된 세션으로 신규 변경을 실행하지 않는다`, async () => {
    await db.session.delete({ where: { id: ctx.session.id } });
    await expect(operations[operation]()).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  });
  test(`${operation}: 응답 캐시 저장 중 세션 만료 시 업무·감사·키를 모두 롤백한다`, async () => {
    await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
    const before = await state();
    vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
    await expect(operations[operation]()).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    vi.useRealTimers(); expect(await state()).toEqual(before);
  });
}
async function state() {
  return { subscriptions: await db.billingSubscription.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { id: "asc" } }),
    events: await db.billingSubscriptionEvent.count({ where: { subscription: { tenantId: ctx.tenantId } } }),
    audits: await db.auditEvent.count({ where: { tenantId: ctx.tenantId } }),
    keys: await db.idempotencyRecord.count({ where: { scope: { contains: ctx.tenantId } } }) };
}
test("성공한 구매 요청 재전송도 현재 결제 권한을 확인한다", async () => {
  const key = randomUUID(); await requestPurchase(ctx, planVersionId, key, randomUUID());
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer", version: { increment: 1 } } });
  await expect(requestPurchase(ctx, planVersionId, key, randomUUID())).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
});
test("같은 해지 예약 키에 다른 취소 사유를 넣으면 충돌한다", async () => {
  const key = randomUUID(), at = future();
  await scheduleTrialCancellation(ctx, activeId, 3, at, key, randomUUID(), "최초 사유");
  await expect(scheduleTrialCancellation(ctx, activeId, 3, at, key, randomUUID(), "변경 사유"))
    .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_MISMATCH" });
});
test("구매 재전송은 취소 후 최신 상태를 반환하고 구독을 다시 만들지 않는다", async () => {
  const key = randomUUID(), created = await requestPurchase(ctx, planVersionId, key, randomUUID());
  await cancelPurchase(ctx, created.body.id, created.body.version, randomUUID(), randomUUID());
  const before = await state(), replay = await requestPurchase(ctx, planVersionId, key, randomUUID());
  expect(replay.body).toMatchObject({ id: created.body.id, status: "cancelled", version: 2 });
  expect(await state()).toEqual(before);
});
test("예약 재전송은 철회 후 최신 상태를 반환하고 다시 예약하지 않는다", async () => {
  const key = randomUUID(), at = future();
  await scheduleTrialCancellation(ctx, activeId, 3, at, key, randomUUID());
  await undoTrialCancellation(ctx, activeId, 4, randomUUID(), randomUUID());
  const before = await state();
  const replay = await scheduleTrialCancellation(ctx, activeId, 3, at, key, randomUUID());
  expect(replay.body).toMatchObject({ id: activeId, cancelAt: null, version: 5 });
  expect(await state()).toEqual(before);
});
test("같은 version 구매 취소 두 건은 하나만 성공하고 다른 건은409로 끝난다", async () => {
  const results = await Promise.allSettled([operations.cancel(), operations.cancel()]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(row => row.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  expect(await db.billingSubscriptionEvent.count({ where: { subscriptionId: pendingId, kind: "request_cancelled" } })).toBe(1);
});
test("변경 전 새 MFA 정책과 선택 회사 변경을 적용한다", async () => {
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
  await expect(operations.schedule()).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: false } });
  const other = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
  await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: other.id } });
  await expect(operations.undo()).rejects.toMatchObject({ status: 403, code: "COMPANY_CHANGED" });
});

for (const operation of ["schedule", "undo"] as const) {
  test(`${operation}: 처리 중 해지 기한 도래는 변경·이력·캐시를 롤백한다`, async () => {
    let version = 3;
    if (operation === "undo") {
      await db.billingSubscription.update({ where: { id: activeId }, data: { cancelAt: new Date(Date.now() + 60_000), version: 4 } });
      version = 4;
    }
    const before = await state(), at = new Date(Date.now() + 60_000);
    vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
    const result = operation === "schedule"
      ? scheduleTrialCancellation(ctx, activeId, version, at, randomUUID(), randomUUID())
      : undoTrialCancellation(ctx, activeId, version, randomUUID(), randomUUID());
    await expect(result).rejects.toMatchObject({ status: 409, code: "SUBSCRIPTION_UNAVAILABLE" });
    vi.useRealTimers(); expect(await state()).toEqual(before);
  });
}
test("구매 처리 중 상품 판매 기간 종료는 새 구독과 요청 키를 롤백한다", async () => {
  const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "마감 상품" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000,
    features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 86400e3), effectiveTo: new Date(Date.now() + 60_000) } });
  const before = await state();
  vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
  await expect(requestPurchase(ctx, version.id, randomUUID(), randomUUID())).rejects.toMatchObject({ status: 409, code: "PLAN_UNAVAILABLE" });
  vi.useRealTimers(); expect(await state()).toEqual(before);
});
test("철회 요청 재전송은 이후 새 해지 예약을 되돌리지 않고 최신 상태를 반환한다", async () => {
  const key = randomUUID(); await undoTrialCancellation(ctx, activeId, 3, key, randomUUID());
  const at = future(); await scheduleTrialCancellation(ctx, activeId, 4, at, randomUUID(), randomUUID());
  const before = await state(), replay = await undoTrialCancellation(ctx, activeId, 3, key, randomUUID());
  expect(replay.body).toMatchObject({ version: 5, cancelAt: at.toISOString() });
  expect(await state()).toEqual(before);
});
for (const operation of ["cancel", "schedule", "undo"] as const) {
  test(`${operation}: 성공 요청 재전송도 회수된 세션을 차단한다`, async () => {
    const key = randomUUID(), at = future();
    const run = () => operation === "cancel" ? cancelPurchase(ctx, pendingId, 1, key, randomUUID())
      : operation === "schedule" ? scheduleTrialCancellation(ctx, activeId, 3, at, key, randomUUID())
      : undoTrialCancellation(ctx, activeId, 3, key, randomUUID());
    await run(); await db.session.delete({ where: { id: ctx.session.id } });
    const before = await state();
    await expect(run()).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(await state()).toEqual(before);
  });
}
