import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as createOrder } from "@/app/api/v1/billing/orders/route";
import { GET as listRefunds, POST as requestRefund } from "@/app/api/v1/billing/orders/[id]/refunds/route";
import { GET as invoice } from "@/app/api/v1/billing/orders/[id]/invoice/route";
import { GET as closeGet, POST as closePost } from "@/app/api/v1/billing/closing/route";
import { POST as subAction } from "@/app/api/v1/subscriptions/[[...segments]]/route";
import { applyPaymentEvent } from "@/server/payments";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Refund-test!123", secret = "payment-webhook-secret-0123456789abc";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
function sign(body: string) { return createHmac("sha256", secret).update(body).digest("hex"); }
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

async function paidFixture() {
  const email = "rf-" + randomUUID() + "@catchsecu.test";
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "환불", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "환불 회사", publicName: "환불", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } } } });
  const foreign = await db.company.create({ data: { name: "타 회사", publicName: "타사", policy: { create: {} } } });
  const plan = await db.billingPlan.create({ data: { id: "rf-" + randomUUID(), name: "유료" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000, currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date("2026-01-01") } });
  const subscription = await db.billingSubscription.create({ data: { tenantId: company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000, currency: "KRW" } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const created = await createOrder(req("/billing/orders", cookie, "POST", { subscriptionId: subscription.id }, randomUUID()));
  const order = await created.json();
  const paid = JSON.stringify({ orderId: order.id, eventId: "ev-paid-" + randomUUID().slice(0, 8), outcome: "paid" });
  await applyPaymentEvent(paid, sign(paid), secret);
  return { company, foreign, subscription, order, cookie };
}
const account = (tenantId: string) => db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId, currency: "KRW" } } });

test("환불 요청은 결제 주문에만 허용되고 누계 초과는 거부된다", async () => {
  const { order, cookie } = await paidFixture();
  expect((await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 13000, reason: "초과" }, randomUUID()))).status).toBe(409);
  const created = await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 5000, reason: "부분 환불" }, randomUUID()));
  expect(created.status).toBe(201);
  const refund = await created.json();
  expect(refund).toMatchObject({ amount: 5000, status: "requested", reason: "부분 환불" });
  expect((await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 8000, reason: "추가" }, randomUUID()))).status).toBe(409);
  const key = randomUUID();
  const a = await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 7000, reason: "전액 잔여" }, key));
  const b = await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 7000, reason: "전액 잔여" }, key));
  expect((await a.json()).id).toBe((await b.json()).id);
  expect((await listRefunds(req("/billing/orders/" + order.id + "/refunds", cookie)).then(r => r.json())).items.length).toBe(2);
  expect((await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 5000, reason: "악의" }, key))).status).toBe(409);
  expect((await listRefunds(req("/billing/orders/" + order.id + "/refunds"))).status).toBe(401);
  expect((await listRefunds(req("/billing/orders/" + randomUUID() + "/refunds", cookie))).status).toBe(404);
  const foreignCompany = await db.company.findFirstOrThrow({ where: { name: "타 회사" } });
  const alien = await db.paymentOrder.findFirst({ where: { tenantId: foreignCompany.id } });
  expect(alien).toBeNull();
  expect((await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 1000, reason: "x" }))).status).toBe(400);
});

test("서명된 환불 이벤트만 정산하고 재시도·무서명·비paid 주문을 거부한다", async () => {
  const { company, order, cookie } = await paidFixture();
  const refund = await (await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 4000, reason: "사유" }, randomUUID()))).json();
  expect((await account(company.id)).available).toBe(BigInt(12000));
  const bad = JSON.stringify({ orderId: order.id, eventId: "ev-rf-" + randomUUID().slice(0, 8), outcome: "refunded" });
  await expect(applyPaymentEvent(bad, sign(bad), secret)).rejects.toMatchObject({ status: 422 });
  const ghost = JSON.stringify({ orderId: order.id, eventId: "ev-rf-" + randomUUID().slice(0, 8), outcome: "refunded", refundId: randomUUID() });
  await expect(applyPaymentEvent(ghost, sign(ghost), secret)).rejects.toMatchObject({ status: 404 });
  const carded = JSON.stringify({ orderId: order.id, eventId: "ev-rf-card", outcome: "refunded", refundId: refund.id, cardNumber: "4111111111111111" });
  await expect(applyPaymentEvent(carded, sign(carded), secret)).rejects.toMatchObject({ status: 422 });
  const done = JSON.stringify({ orderId: order.id, eventId: "ev-rf-" + randomUUID().slice(0, 8), outcome: "refunded", refundId: refund.id });
  await expect(applyPaymentEvent(done, "00", secret)).rejects.toMatchObject({ status: 401 });
  await applyPaymentEvent(done, sign(done), secret);
  expect((await db.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("refunded");
  const acc = await account(company.id);
  expect(acc.available).toBe(BigInt(8000));
  const txn = await db.ledgerTransaction.findFirstOrThrow({ where: { tenantId: company.id, kind: "refund", sourceId: refund.id } });
  expect(txn.amount).toBe(BigInt(4000));
  expect((await applyPaymentEvent(done, sign(done), secret)).duplicate).toBe(true);
  expect(await db.ledgerTransaction.count({ where: { tenantId: company.id, kind: "refund" } })).toBe(1);
  expect((await db.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } })).version).toBe(2);
  const second = await (await requestRefund(req("/billing/orders/" + order.id + "/refunds", cookie, "POST", { amount: 1000, reason: "거부됨" }, randomUUID()))).json();
  const rejected = JSON.stringify({ orderId: order.id, eventId: "ev-rf-" + randomUUID().slice(0, 8), outcome: "refund_rejected", refundId: second.id });
  await applyPaymentEvent(rejected, sign(rejected), secret);
  expect((await db.paymentRefund.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("rejected");
  expect(await db.ledgerTransaction.count({ where: { tenantId: company.id, kind: "refund" } })).toBe(1);
  const late = JSON.stringify({ orderId: order.id, eventId: "ev-rf-" + randomUUID().slice(0, 8), outcome: "refunded", refundId: refund.id });
  await expect(applyPaymentEvent(late, sign(late), secret)).rejects.toMatchObject({ status: 409 });
  await expect(db.paymentRefund.update({ where: { id: refund.id }, data: { status: "requested", version: 2 } })).rejects.toThrow();
  const big = await db.paymentOrder.create({ data: { tenantId: company.id, subscriptionId: order.subscriptionId, amount: 99999999, currency: "KRW", status: "pending" } });
  await expect(db.paymentRefund.create({ data: { tenantId: company.id, orderId: big.id, amount: 1, reason: "미결제", currency: "KRW" } })).rejects.toThrow();
});

test("청구서는 paid 주문에만 발행되고 권한·격리를 지킨다", async () => {
  const { order, cookie } = await paidFixture();
  const pdf = await invoice(req("/billing/orders/" + order.id + "/invoice", cookie));
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  const bytes = Buffer.from(await pdf.arrayBuffer());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
  expect((await invoice(req("/billing/orders/" + order.id + "/invoice"))).status).toBe(401);
  expect((await invoice(req("/billing/orders/" + randomUUID() + "/invoice", cookie))).status).toBe(404);
});

test("월마감 스냅샷하고 마감 후 거래는 정정으로 식별한다", async () => {
  const { company, cookie } = await paidFixture();
  const now = new Date(), prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const month = prev.toISOString().slice(0, 7);
  expect((await closePost(req("/billing/closing", cookie, "POST", { month: now.toISOString().slice(0, 7), currency: "KRW" }, randomUUID()))).status).toBe(422);
  const closed = await closePost(req("/billing/closing", cookie, "POST", { month, currency: "KRW" }, randomUUID()));
  expect(closed.status).toBe(201);
  expect((await closed.json()).totals.funded).toBe("0");
  const replay = await closePost(req("/billing/closing", cookie, "POST", { month, currency: "KRW" }, randomUUID()));
  expect(replay.status).toBe(200);
  expect(await db.billingMonthClose.count({ where: { tenantId: company.id } })).toBe(1);
  const adjId = randomUUID();
  await db.$executeRaw`INSERT INTO "LedgerTransaction" (id,"tenantId",currency,kind,amount,"sourceKind","sourceId","createdAt") VALUES (${adjId},${company.id},'KRW','funding',${BigInt(5)},'pg_capture',${"adj-" + randomUUID().slice(0, 8)},${prev})`;
  await db.auditEvent.create({ data: { tenantId: company.id, action: "billing.ledger_funding", resource: "ledgerTransaction", resourceId: adjId, requestId: adjId, detail: {} } });
  const view = await (await closeGet(req("/billing/closing?month=" + month + "&currency=KRW", cookie))).json();
  expect(view.closed).toBe(true);
  expect(view.postCloseAdjustments).toBe(1);
  expect(view.totals.funded).toBe("0");
  expect((await closeGet(req("/billing/closing?month=" + month, ""))).status).toBe(401);
});

test("유료 구독은 해지 예약·철회가 되고 effective date가 적용된다", async () => {
  const { subscription, cookie } = await paidFixture();
  const active = await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
  expect(active.status).toBe("active");
  const eff = new Date(Date.now() + 10 * 86400e3).toISOString();
  const past = await subAction(req("/subscriptions/" + subscription.id + "/schedule-cancel", cookie, "POST", { version: active.version, effectiveAt: new Date(Date.now() - 1000).toISOString(), reason: "테스트" }, randomUUID()));
  expect(past.status).toBe(422);
  const scheduled = await subAction(req("/subscriptions/" + subscription.id + "/schedule-cancel", cookie, "POST", { version: active.version, effectiveAt: eff, reason: "비용 절감" }, randomUUID()));
  expect(scheduled.status).toBe(200);
  const saved = await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
  expect(saved.cancelAt?.toISOString()).toBe(eff);
  const ev = await db.billingSubscriptionEvent.findFirstOrThrow({ where: { subscriptionId: subscription.id, kind: "cancel_scheduled" } });
  expect((ev.detail as { reason: string }).reason).toBe("비용 절감");
  const undo = await subAction(req("/subscriptions/" + subscription.id + "/undo-cancel", cookie, "POST", { version: saved.version }, randomUUID()));
  expect(undo.status).toBe(200);
  expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).cancelAt).toBeNull();
  const badVersion = await subAction(req("/subscriptions/" + subscription.id + "/schedule-cancel", cookie, "POST", { version: 1, effectiveAt: eff }, randomUUID()));
  expect(badVersion.status).toBe(409);
});
