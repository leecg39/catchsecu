import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/server/db";
const base = "http://127.0.0.1:3197", out = "docs/qa/P10-T02/event-integrity/", marker = ".local/qa-payment-event-integrity.json";
const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.pathname, "/catchsecu_test"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const secret = process.env.PAYMENT_WEBHOOK_SECRET; assert.ok(secret);
type Fixture = { email: string; password: string; userId: string; tenantId: string; orderId: string; refundId: string; paidEvent: string; refundEvent: string; complete: boolean };
const checks: { step: string; status: number; code?: string; cookieSent: boolean; originSent: boolean }[] = [];
let cookie = "";
async function request(step: string, path: string, method = "GET", input?: unknown, expected = 200, key: string = randomUUID(), signature?: string) {
  const body = input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input);
  const response = await fetch(base + "/api/v1" + path, { method, redirect: "manual", headers: { ...(signature ? {} : { origin: base, cookie }), "idempotency-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(signature ? { "x-payment-signature": signature } : {}) }, body });
  const value = await response.clone().json(); checks.push({ step, status: response.status, cookieSent: !signature && !!cookie, originSent: !signature, ...(value.error ? { code: value.error.code } : {}) });
  writeFileSync(out + "http-progress.json", JSON.stringify({ checks }, null, 2)); assert.equal(response.status, expected, step);
  return response;
}
function event(step: string, input: unknown, expected = 202) {
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  return request(step, "/billing/provider-events", "POST", raw, expected, randomUUID(), createHmac("sha256", secret!).update(raw).digest("hex"));
}
async function login(f: Fixture) {
  const response = await request("로그인", "/auth/sign-in/email", "POST", { email: f.email, password: f.password });
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert.ok(cookie);
}
async function fingerprint(f: Fixture) {
  const scope = { tenantId: f.tenantId }, orderBy = { id: "asc" as const };
  const data = {
    orders: await db.paymentOrder.findMany({ where: scope, orderBy }),
    subscriptions: await db.billingSubscription.findMany({ where: scope, orderBy }),
    refunds: await db.paymentRefund.findMany({ where: scope, orderBy }),
    events: await db.paymentEvent.findMany({ where: { order: scope }, orderBy }),
    ledger: await db.ledgerTransaction.findMany({ where: scope, orderBy }),
    audits: await db.auditEvent.findMany({ where: { ...scope, action: { startsWith: "billing." } }, orderBy }),
  };
  return { sha256: createHash("sha256").update(JSON.stringify(data, (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex"), counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])) };
}
try {
  const restart = process.argv.includes("--verify-restart");
  if (restart) {
    const f = JSON.parse(readFileSync(marker, "utf8")) as Fixture; assert.ok(f.complete);
    const before = JSON.parse(readFileSync(out + "http.json", "utf8")).fingerprint;
    assert.deepEqual(await fingerprint(f), before); await login(f);
    const order = await (await request("재시작 후 주문", "/billing/orders/" + f.orderId)).json(); assert.equal(order.status, "paid");
    assert.equal((await (await event("재시작 후 승인 재전송", { orderId: f.orderId, eventId: f.paidEvent, outcome: "paid" })).json()).duplicate, true);
    assert.equal((await (await event("재시작 후 환불 재전송", { orderId: f.orderId, eventId: f.refundEvent, outcome: "refunded", refundId: f.refundId })).json()).duplicate, true);
    assert.deepEqual(await fingerprint(f), before);
    await request("로그아웃", "/auth/sign-out", "POST", {}); assert.equal(await db.session.count({ where: { userId: f.userId } }), 0);
    writeFileSync(out + "http-restart.json", JSON.stringify({ checks, fingerprint: before, preserved: true, ownSessionsRemaining: 0 }, null, 2));
  } else {
    assert.equal(existsSync(marker), false, "기존 실행 기록을 먼저 확인하세요");
    const f: Fixture = { email: "event-qa-" + randomUUID() + "@catchsecu.test", password: "Payment!" + randomUUID(), userId: "", tenantId: "", orderId: "", refundId: "", paidEvent: randomUUID(), refundEvent: randomUUID(), complete: false };
    writeFileSync(marker, JSON.stringify(f), { mode: 0o600 });
    await request("가입", "/auth/sign-up/email", "POST", { name: "결제 이벤트 QA", email: f.email, password: f.password });
    const user = await db.user.update({ where: { email: f.email }, data: { emailVerified: true } }); f.userId = user.id;
    const company = await db.company.create({ data: { name: "결제 이벤트 QA", publicName: "결제 이벤트 QA", policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId: user.id, role: "owner" } } } }); f.tenantId = company.id;
    writeFileSync(marker, JSON.stringify(f), { mode: 0o600 }); await login(f);
    const purchase = { planVersionId: "privacy-lifecycle-month-v1" };
    const sub = await (await request("구독 요청", "/subscriptions", "POST", purchase, 202)).json();
    const order = await (await request("주문 생성", "/billing/orders", "POST", { subscriptionId: sub.id }, 201)).json(); f.orderId = order.id;
    const cancelKey = randomUUID();
    const blocked = await (await request("결제 중 구독 취소 거절", `/subscriptions/${sub.id}/cancel`, "POST", { version: 1 }, 409, cancelKey)).json(); assert.equal(blocked.error.code, "PAYMENT_IN_PROGRESS");
    const paid = { orderId: order.id, eventId: f.paidEvent, outcome: "paid" };
    const before = await fingerprint(f);
    await event("승인에 환불 ID 혼합 거절", { ...paid, refundId: randomUUID() }, 422);
    await event("잘못된 JSON 거절", '{"orderId":', 400); assert.deepEqual(await fingerprint(f), before);
    await event("정상 승인", paid);
    const refund = await (await request("환불 요청", `/billing/orders/${order.id}/refunds`, "POST", { amount: 2000, reason: "합성 환불" }, 201)).json(); f.refundId = refund.id;
    const refunded = { orderId: order.id, eventId: f.refundEvent, outcome: "refunded", refundId: refund.id };
    await event("정상 환불", refunded);
    const settled = await fingerprint(f);
    await event("환불 재전송 식별자 누락 거절", { orderId: order.id, eventId: f.refundEvent, outcome: "refunded" }, 422);
    assert.equal((await (await event("정상 환불 재전송", refunded)).json()).duplicate, true);
    assert.deepEqual(await fingerprint(f), settled);
    const next = await (await request("두 번째 구독 요청", "/subscriptions", "POST", purchase, 202)).json();
    const nextOrder = await (await request("두 번째 주문", "/billing/orders", "POST", { subscriptionId: next.id }, 201)).json();
    await event("실패 결과", { orderId: nextOrder.id, eventId: randomUUID(), outcome: "failed" });
    const cancelled = await (await request("실패 후 취소", `/subscriptions/${next.id}/cancel`, "POST", { version: 1 })).json(); assert.equal(cancelled.status, "cancelled");
    // 이전 코드에서 생길 수 있던 cancelled 구독 + pending 주문을 별도 합성 fixture로 재현.
    const legacy = await db.billingSubscription.create({ data: { tenantId: company.id, planId: sub.planId, planVersionId: purchase.planVersionId, status: "pending", priceKrw: sub.priceKrw } });
    const legacyOrder = await db.paymentOrder.create({ data: { tenantId: company.id, subscriptionId: legacy.id, amount: sub.priceKrw, currency: "KRW" } });
    await db.billingSubscription.update({ where: { id: legacy.id }, data: { status: "cancelled", version: 2 } });
    const legacyBefore = await fingerprint(f);
    const rejected = await (await event("과거 취소 구독 승인 거절", { orderId: legacyOrder.id, eventId: randomUUID(), outcome: "paid" }, 409)).json(); assert.equal(rejected.error.code, "SUBSCRIPTION_UNAVAILABLE");
    assert.deepEqual(await fingerprint(f), legacyBefore);
    await request("로그아웃", "/auth/sign-out", "POST", {}); assert.equal(await db.session.count({ where: { userId: f.userId } }), 0);
    f.complete = true; writeFileSync(marker, JSON.stringify(f), { mode: 0o600 });
    writeFileSync(out + "http.json", JSON.stringify({ checks, fingerprint: legacyBefore, ownSessionsRemaining: 0, realExternalAcceptance: false }, null, 2));
  }
  console.log(JSON.stringify({ passed: checks.length, restart }));
} finally { await db.$disconnect(); }
