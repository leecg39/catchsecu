import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { POST as createOrder, GET as listOrders } from "@/app/api/v1/billing/orders/route";
import { POST as virtualCheckout } from "@/app/api/v1/billing/orders/[id]/virtual-checkout/route";
import { POST as virtualSettle } from "@/app/api/v1/billing/refunds/[id]/virtual-settle/route";
import { POST as requestRefund } from "@/app/api/v1/billing/orders/[id]/refunds/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Vpg-test!12345";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
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
  return { company, subscription, order, cookie };
}

test("주문 목록이 가상 결제 활성 여부를 보고한다", async () => {
  const { cookie } = await fixture();
  const body = await (await listOrders(req("/billing/orders", cookie))).json();
  expect(body.virtual).toBe(true);
});

test("가상 승인은 실제 서명 이벤트 경로로 결제·구독활성·원장입금을 완료한다", async () => {
  const { company, subscription, order, cookie } = await fixture();
  const res = await virtualCheckout(req(`/billing/orders/${order.id}/virtual-checkout`, cookie, "POST", { outcome: "paid" }));
  expect(res.status).toBe(200);
  const saved = await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
  expect(saved.status).toBe("paid");
  const event = await db.paymentEvent.findFirstOrThrow({ where: { orderId: order.id } });
  expect(event.providerEventId).toMatch(/^vpg:/);
  expect(event.outcome).toBe("paid");
  expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).status).toBe("active");
  const account = await db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId: company.id, currency: "KRW" } } });
  expect(account.available).toBe(BigInt(12000));
  // 종료된 주문에 재승인은 충돌
  expect((await virtualCheckout(req(`/billing/orders/${order.id}/virtual-checkout`, cookie, "POST", { outcome: "failed" }))).status).toBe(409);
});

test("가상 실패는 주문만 종료하고 구독·원장을 건드리지 않는다", async () => {
  const { company, subscription, order, cookie } = await fixture();
  const res = await virtualCheckout(req(`/billing/orders/${order.id}/virtual-checkout`, cookie, "POST", { outcome: "failed" }));
  expect(res.status).toBe(200);
  expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("failed");
  expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).status).toBe("pending");
  expect(await db.creditAccount.findFirst({ where: { tenantId: company.id } })).toBeNull();
});

test("가상 환불 정산은 실제 환불 이벤트 경로로 원장 차감을 완료하고 거절도 기록한다", async () => {
  const { company, order, cookie } = await fixture();
  await virtualCheckout(req(`/billing/orders/${order.id}/virtual-checkout`, cookie, "POST", { outcome: "paid" }));
  const refund = await (await requestRefund(req(`/billing/orders/${order.id}/refunds`, cookie, "POST", { amount: 4000, reason: "부분" }, randomUUID()))).json();
  const settled = await virtualSettle(req(`/billing/refunds/${refund.id}/virtual-settle`, cookie, "POST", { outcome: "refunded" }));
  expect(settled.status).toBe(200);
  expect((await db.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("refunded");
  const event = await db.paymentEvent.findFirstOrThrow({ where: { orderId: order.id, outcome: "refunded" } });
  expect(event.providerEventId).toMatch(/^vpg:/);
  expect((await db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId: company.id, currency: "KRW" } } })).available).toBe(BigInt(8000));
  // 이미 정산된 환불 재정산 → 409
  expect((await virtualSettle(req(`/billing/refunds/${refund.id}/virtual-settle`, cookie, "POST", { outcome: "refund_rejected" }))).status).toBe(409);
  const refund2 = await (await requestRefund(req(`/billing/orders/${order.id}/refunds`, cookie, "POST", { amount: 2000, reason: "두번째" }, randomUUID()))).json();
  const rejected = await virtualSettle(req(`/billing/refunds/${refund2.id}/virtual-settle`, cookie, "POST", { outcome: "refund_rejected" }));
  expect(rejected.status).toBe(200);
  expect((await db.paymentRefund.findUniqueOrThrow({ where: { id: refund2.id } })).status).toBe("rejected");
});

test("타 테넌트 주문·환불과 미인증 요청은 가상 경로에서도 거부된다", async () => {
  const { order, cookie } = await fixture();
  const otherEmail = "vpg-other-" + randomUUID() + "@catchsecu.test";
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "타인", email: otherEmail, password }));
  const other = await db.user.update({ where: { email: otherEmail }, data: { emailVerified: true } });
  await db.company.create({ data: { name: "타 회사", publicName: "타사", policy: { create: {} }, memberships: { create: { userId: other.id, role: "owner" } } } });
  const otherLogin = await auth.handler(req("/auth/sign-in/email", "", "POST", { email: otherEmail, password }));
  const otherCookie = otherLogin.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  expect((await virtualCheckout(req(`/billing/orders/${order.id}/virtual-checkout`, otherCookie, "POST", { outcome: "paid" }))).status).toBe(404);
  expect((await virtualCheckout(req(`/billing/orders/${order.id}/virtual-checkout`, "", "POST", { outcome: "paid" }))).status).toBe(401);
  expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending");
});
