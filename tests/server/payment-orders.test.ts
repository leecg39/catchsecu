import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as createOrder } from "@/app/api/v1/billing/orders/route";
import { GET as readOrder } from "@/app/api/v1/billing/orders/[id]/route";
import { POST as paymentReturn } from "@/app/api/v1/billing/orders/[id]/return/route";
import { applyPaymentEvent } from "@/server/payments";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Payment-order!123", secret = "payment-webhook-secret-0123456789abc";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
function sign(body: string) { return createHmac("sha256", secret).update(body).digest("hex"); }
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("성공 주소와 카드 원문으로는 결제 완료가 되지 않고 서명된 결과만 한 번 반영한다", async () => {
  const email = "pay-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "결제", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "결제 회사", publicName: "결제", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } } } });
  const plan = await db.billingPlan.create({ data: { id: "pay-" + randomUUID(), name: "유료" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000, currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date("2026-01-01") } });
  const subscription = await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000, currency: "KRW" } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const created = await createOrder(req("/billing/orders", cookie, "POST", { subscriptionId: subscription.id }, randomUUID()));
  expect(created.status).toBe(201);
  const order = await created.json();
  expect(order.status).toBe("pending");
  expect(order.amount).toBe(12000);
  const forged = await readOrder(req("/billing/orders/" + order.id + "?result=success", cookie));
  expect((await forged.json()).status).toBe("pending");
  expect((await paymentReturn(req("/billing/orders/" + order.id + "/return", cookie, "POST", { result: "success" }))).status).toBe(409);
  expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending");
  const card = JSON.stringify({ orderId: order.id, eventId: "event-card-1", outcome: "paid", cardNumber: "4111111111111111" });
  await expect(applyPaymentEvent(card, sign(card), secret)).rejects.toMatchObject({ status: 422 });
  expect(await db.paymentEvent.count()).toBe(0);
  const paid = JSON.stringify({ orderId: order.id, eventId: "event-paid-1", outcome: "paid" });
  await expect(applyPaymentEvent(paid, "00", secret)).rejects.toMatchObject({ status: 401 });
  expect((await applyPaymentEvent(paid, sign(paid), secret)).status).toBe("paid");
  const activated = await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
  expect(activated.status).toBe("active");
  expect(activated.activationSource).toBe("payment");
  expect(activated.periodStart).not.toBeNull();
  expect(activated.periodEnd!.getTime() - activated.periodStart!.getTime()).toBeGreaterThan(25 * 24 * 60 * 60 * 1000);
  const event = await db.billingSubscriptionEvent.findFirstOrThrow({ where: { subscriptionId: subscription.id, kind: "activated" } });
  expect((event.detail as { orderId: string }).orderId).toBe(order.id);
  const account = await db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId: company.id, currency: "KRW" } } });
  expect(account.available).toBe(BigInt(12000));
  expect(account.held).toBe(BigInt(0));
  const funding = await db.ledgerTransaction.findFirstOrThrow({ where: { tenantId: company.id, kind: "funding", sourceKind: "pg_capture", sourceId: order.id } });
  expect(funding.amount).toBe(BigInt(12000));
  expect(funding.currency).toBe("KRW");
  expect((await applyPaymentEvent(paid, sign(paid), secret)).duplicate).toBe(true);
  expect(await db.ledgerTransaction.count({ where: { tenantId: company.id, kind: "funding" } })).toBe(1);
  expect((await db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId: company.id, currency: "KRW" } } })).available).toBe(BigInt(12000));
  const late = JSON.stringify({ orderId: order.id, eventId: "event-fail-2", outcome: "failed" });
  await expect(applyPaymentEvent(late, sign(late), secret)).rejects.toMatchObject({ status: 409 });
  expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("paid");
});

test("연간 주기는 1년 기간으로 활성화되고 결제 없는 활성화는 DB가 거부한다", async () => {
  const email = "pay-y-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "연간", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "연간 회사", publicName: "연간", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } } } });
  const plan = await db.billingPlan.create({ data: { id: "pay-y-" + randomUUID(), name: "연간" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "year", priceKrw: 120000, currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date("2026-01-01") } });
  const subscription = await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 120000, currency: "KRW" } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const order = await (await createOrder(req("/billing/orders", cookie, "POST", { subscriptionId: subscription.id }, randomUUID()))).json();
  await expect(db.billingSubscription.update({ where: { id: subscription.id },
    data: { status: "active", activationSource: "payment", periodStart: new Date(), periodEnd: new Date(Date.now() + 30 * 24 * 3600e3), version: { increment: 1 } } })).rejects.toThrow();
  const paid = JSON.stringify({ orderId: order.id, eventId: "event-paid-y", outcome: "paid" });
  await applyPaymentEvent(paid, sign(paid), secret);
  const active = await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
  expect(active.status).toBe("active");
  const days = (active.periodEnd!.getTime() - active.periodStart!.getTime()) / 86400e3;
  expect(days).toBeGreaterThan(360); expect(days).toBeLessThan(370);
  expect((await db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId: company.id, currency: "KRW" } } })).available).toBe(BigInt(120000));
  const early = await db.billingSubscription.update({ where: { id: subscription.id }, data: { status: "expired", version: { increment: 1 } } }).then(() => null, (e: Error) => e.message);
  expect(early).toContain("BILLING_EARLY_EXPIRATION");
});
