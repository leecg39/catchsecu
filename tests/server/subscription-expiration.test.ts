import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { expireSubscriptions } from "@/server/subscription-worker";
import { assertQuota } from "@/server/entitlements";

const fault = vi.hoisted(() => ({ audit: false }));
vi.mock("@/server/audit", async original => {
  const actual = await original<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    if (fault.audit && args[3] === "billing.expired") throw new Error("synthetic paid expiry audit failure");
    return actual.audit(...args);
  } };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required");
beforeEach(async () => {
  fault.audit = false;
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });

// 결제 공급자를 흉내내지 않고 DB의 정상 pending→active 전이로 과거/미래 구독을 준비한다.
async function fixture(due: boolean) {
  const company = await db.company.create({ data: { name: "유료 만료 시험", publicName: "유료 만료 시험" } });
  const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "시험 유료" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000,
    features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 90 * 86400e3) } });
  const pending = await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id,
    planVersionId: version.id, status: "pending", priceKrw: 12000,
    events: { create: { version: 1, kind: "purchase_requested", detail: {} } } } });
  const order = await db.paymentOrder.create({ data: { tenantId: company.id, subscriptionId: pending.id,
    amount: 12000, currency: "KRW", status: "paid" } });
  const active = await db.billingSubscription.update({ where: { id: pending.id }, data: { status: "active",
    activationSource: "payment", periodStart: new Date(Date.now() - 31 * 86400e3),
    periodEnd: new Date(Date.now() + (due ? -1 : 1) * 86400e3), version: { increment: 1 },
    events: { create: { version: 2, kind: "activated", detail: { orderId: order.id } } } } });
  return { company, order, active };
}

test("유료 자연 만료는 DB 상태·이력·감사를 한 번만 저장하고 결제 주문을 보존한다", async () => {
  const fx = await fixture(true);
  await expect(db.$transaction(tx => assertQuota(tx, fx.company.id, "services"))).rejects.toMatchObject({ status: 402 });
  expect(await expireSubscriptions()).toBe(1);
  expect(await expireSubscriptions()).toBe(0);
  const row = await db.billingSubscription.findUniqueOrThrow({ where: { id: fx.active.id }, include: { events: true } });
  expect(row).toMatchObject({ status: "expired", version: 3, cancelAt: null, periodEnd: fx.active.periodEnd });
  expect(row.events.filter(event => event.kind === "expired")).toHaveLength(1);
  expect(row.events.find(event => event.kind === "expired")?.detail).toEqual({ reason: "period_end" });
  expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "billing.expired", actorId: null } })).toBe(1);
  expect(await db.paymentOrder.findUniqueOrThrow({ where: { id: fx.order.id } })).toEqual(fx.order);
});

test("유료 DB 전이는 기한 도래를 허용하고 만료와 함께 해지일을 바꾸는 요청은 거부한다", async () => {
  const fx = await fixture(true);
  await expect(db.billingSubscription.update({ where: { id: fx.active.id }, data: {
    status: "expired", cancelAt: new Date(fx.active.periodEnd!.getTime() - 1000), version: { increment: 1 },
  } })).rejects.toThrow();
  await expect(db.billingSubscription.update({ where: { id: fx.active.id }, data: {
    status: "expired", version: { increment: 1 },
  } })).resolves.toMatchObject({ status: "expired", cancelAt: null });
});

test("유료 예약 해지는 도래 전 유지하고 도래 후 두 워커가 한 번만 종결한다", async () => {
  const fx = await fixture(false), cancelAt = new Date(Date.now() + 1500);
  await db.billingSubscription.update({ where: { id: fx.active.id }, data: { cancelAt, version: { increment: 1 },
    events: { create: { version: 3, kind: "cancel_scheduled", detail: { effectiveAt: cancelAt.toISOString() } } } } });
  expect(await expireSubscriptions()).toBe(0);
  await expect(db.billingSubscription.update({ where: { id: fx.active.id }, data: {
    status: "expired", version: { increment: 1 },
  } })).rejects.toThrow();
  // 실제 PostgreSQL 시계가 해지 시각에 도달할 때까지 기다린다. 날짜/트리거를 우회하지 않는다.
  await db.$executeRaw`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (${cancelAt}::timestamp - (clock_timestamp() AT TIME ZONE 'UTC')))) + 0.05)`;
  const pair = await Promise.all([expireSubscriptions(), expireSubscriptions()]);
  expect(pair.sort()).toEqual([0, 1]);
  const row = await db.billingSubscription.findUniqueOrThrow({ where: { id: fx.active.id }, include: { events: true } });
  expect(row).toMatchObject({ status: "expired", version: 4, cancelAt, periodEnd: fx.active.periodEnd });
  expect(row.events.filter(event => event.kind === "expired").map(event => event.detail)).toEqual([{ reason: "scheduled_cancel" }]);
  expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "billing.expired" } })).toBe(1);
});

test("유료 미래 구독·철회한 해지 예약은 워커가 만료시키지 않는다", async () => {
  const fx = await fixture(false);
  const scheduled = await db.billingSubscription.update({ where: { id: fx.active.id },
    data: { cancelAt: new Date(Date.now() + 3600e3), version: { increment: 1 } } });
  await db.billingSubscription.update({ where: { id: scheduled.id }, data: { cancelAt: null, version: { increment: 1 } } });
  expect(await expireSubscriptions()).toBe(0);
  expect(await db.billingSubscription.findUniqueOrThrow({ where: { id: scheduled.id } })).toMatchObject({ status: "active", cancelAt: null, version: 4 });
  expect(await db.auditEvent.count({ where: { action: "billing.expired" } })).toBe(0);
});

test("유료 만료 감사 저장 실패는 상태·이력을 함께 롤백하고 다음 실행에서 복구한다", async () => {
  const fx = await fixture(true);
  fault.audit = true;
  await expect(expireSubscriptions()).rejects.toThrow("synthetic paid expiry audit failure");
  expect(await db.billingSubscription.findUniqueOrThrow({ where: { id: fx.active.id } })).toEqual(fx.active);
  expect(await db.billingSubscriptionEvent.count({ where: { subscriptionId: fx.active.id, kind: "expired" } })).toBe(0);
  fault.audit = false;
  expect(await expireSubscriptions()).toBe(1);
  expect(await expireSubscriptions()).toBe(0);
});
