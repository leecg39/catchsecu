import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { applyPaymentEvent } from "@/server/payments";
import { POST as createOrder } from "@/app/api/v1/billing/orders/route";
import { POST as requestRefund } from "@/app/api/v1/billing/orders/[id]/refunds/route";
import { POST as virtualCheckout } from "@/app/api/v1/billing/orders/[id]/virtual-checkout/route";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Concurrent-payment!123", secret = "mock-payment-secret-0123456789abcdef";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
const apply = (body: string) => applyPaymentEvent(body, createHmac("sha256", secret).update(body).digest("hex"), secret);
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });
async function fixture() {
  const email = "vpg-" + randomUUID() + "@catchsecu.test";
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "가상결제", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "가상 결제 회사", publicName: "VPG", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } } } });
  const plan = await db.billingPlan.create({ data: { id: "vpg-" + randomUUID(), name: "유료" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000, currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date("2026-01-01") } });
  const subscription = await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000, currency: "KRW" } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const order = await (await createOrder(req("/billing/orders", cookie, "POST", { subscriptionId: subscription.id }, randomUUID()))).json();
  return { company, subscription, order, cookie, user };
}

test("같은 승인 웹훅 8개가 동시에 와도 이벤트·입금은 한 번이고 나머지는 멱등 응답이다", async () => {
  const { order, company } = await fixture();
  const body = JSON.stringify({ orderId: order.id, eventId: randomUUID(), outcome: "paid" });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => apply(body)));
  expect(results.every(r => r.status === "fulfilled")).toBe(true);
  expect(results.filter(r => r.status === "fulfilled" && !r.value.duplicate)).toHaveLength(1);
  expect(await db.paymentEvent.count({ where: { orderId: order.id } })).toBe(1);
  expect(await db.ledgerTransaction.count({ where: { tenantId: company.id, kind: "funding" } })).toBe(1);
});
test("승인과 실패 웹훅이 동시 도착하면 하나만 상태를 변경한다", async () => {
  const { order, company, subscription } = await fixture();
  const results = await Promise.allSettled(["paid", "failed"].map(outcome => apply(JSON.stringify({ orderId: order.id, eventId: randomUUID(), outcome }))));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409, code: "OUT_OF_ORDER" } });
  expect(await db.paymentEvent.count({ where: { orderId: order.id } })).toBe(1);
  const saved = await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
  const sub = await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
  expect(sub.status).toBe(saved.status === "paid" ? "active" : "pending");
  expect(await db.ledgerTransaction.count({ where: { tenantId: company.id, kind: "funding" } })).toBe(saved.status === "paid" ? 1 : 0);
});
test.each([false, true])("환불 동시 이벤트 duplicate=%s에서 정산은 한 번만 적용된다", async duplicate => {
  const { order, company, cookie } = await fixture();
  await apply(JSON.stringify({ orderId: order.id, eventId: randomUUID(), outcome: "paid" }));
  const refund = await (await requestRefund(req(`/billing/orders/${order.id}/refunds`, cookie, "POST", { amount: 4000, reason: "부분" }, randomUUID()))).json();
  const first = JSON.stringify({ orderId: order.id, eventId: randomUUID(), outcome: "refunded", refundId: refund.id });
  const second = duplicate ? first : JSON.stringify({ orderId: order.id, eventId: randomUUID(), outcome: "refund_rejected", refundId: refund.id });
  const results = await Promise.allSettled([apply(first), apply(second)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(duplicate ? 2 : 1);
  if (duplicate) expect(results.filter(r => r.status === "fulfilled" && r.value.duplicate)).toHaveLength(1);
  else expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409, code: "OUT_OF_ORDER" } });
  expect(await db.paymentEvent.count({ where: { orderId: order.id, outcome: { in: ["refunded", "refund_rejected"] } } })).toBe(1);
  const row = await db.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
  const balance = await db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId: company.id, currency: "KRW" } } });
  expect(balance.available).toBe(BigInt(row.status === "refunded" ? 8000 : 12000));
});
test("가상 승인과 외부 실패가 동시에 와도 상태와 원장이 일치한다", async () => {
  const { order, cookie, company } = await fixture();
  const results = await Promise.allSettled([
    virtualCheckout(req(`/billing/orders/${order.id}/virtual-checkout`, cookie, "POST", { outcome: "paid" })).then(async r => ({ status: r.status })),
    apply(JSON.stringify({ orderId: order.id, eventId: randomUUID(), outcome: "failed" })).then(() => ({ status: 200 })),
  ]);
  expect(results.filter(r => r.status === "fulfilled" && r.value.status === 200)).toHaveLength(1);
  expect(await db.paymentEvent.count({ where: { orderId: order.id } })).toBe(1);
  const saved = await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
  expect(await db.ledgerTransaction.count({ where: { tenantId: company.id, kind: "funding" } })).toBe(saved.status === "paid" ? 1 : 0);
});
