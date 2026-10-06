import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";
import { POST as paymentWebhook } from "@/app/api/v1/billing/provider-events/route";
import { applyKakaoReview } from "@/server/kakao";
import { postTrustedLedgerTransfer } from "@/server/ledger";
import { expireSubscriptions } from "@/server/subscription-worker";
import { claimNotification, notificationAttemptResult, recoverNotifications } from "@/server/notification-worker";

const url = new URL(env.DATABASE_URL), secret = "isolated-audit-provider-secret-0123456789";
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
const sign = (raw: string) => createHmac("sha256", secret).update(raw).digest("hex");
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });
async function fixture() {
  const company = await db.company.create({ data: { name: "감사 시스템 시험", publicName: "합성 회사" } });
  const service = await db.service.create({ data: { tenantId: company.id, name: "합성 서비스", externalName: "합성 서비스" } });
  return { tenantId: company.id, serviceId: service.id };
}
async function fault(action: string, operation: () => Promise<void>) {
  if (!/^[a-z_.]+$/.test(action)) throw new Error("Invalid fault action");
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_system_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_system_audit_fault BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_system_audit_fault()');
  try { await operation(); } finally {
    await db.$executeRawUnsafe('DROP TRIGGER qa_system_audit_fault ON "AuditEvent"');
    await db.$executeRawUnsafe('DROP FUNCTION qa_system_audit_fault()');
  }
}
async function order() {
  const f = await fixture(), plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "합성 유료" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 100, features: {}, orderable: true } });
  const subscription = await db.billingSubscription.create({ data: { tenantId: f.tenantId, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 100 } });
  return db.paymentOrder.create({ data: { tenantId: f.tenantId, subscriptionId: subscription.id, amount: 100, currency: "KRW" } });
}
async function payment(id: string) {
  const raw = JSON.stringify({ orderId: id, eventId: "synthetic:" + id, outcome: "paid" });
  const previous = env.PAYMENT_WEBHOOK_SECRET; env.PAYMENT_WEBHOOK_SECRET = secret;
  try { return await paymentWebhook(new Request(env.BETTER_AUTH_URL + "/api/v1/billing/provider-events", { method: "POST", headers: { "content-type": "application/json", "x-payment-signature": sign(raw) }, body: raw })); }
  finally { env.PAYMENT_WEBHOOK_SECRET = previous; }
}
test("서명된 결제 결과는 HTTP 요청 ID로 한 번 감사하고 중복 수신은 추가하지 않는다", async () => {
  const row = await order(), response = await payment(row.id); expect(response.status).toBe(202);
  expect((await payment(row.id)).status).toBe(202);
  const events = await db.auditEvent.findMany({ where: { resourceId: row.id, action: "billing.payment_paid" } });
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ tenantId: row.tenantId, actorId: null, requestId: response.headers.get("x-request-id"), detail: { changedFields: ["status"] } });
});
test("결제 감사 실패는 결제 상태와 공급자 수신 기록을 롤백한다", async () => {
  const row = await order(); await fault("billing.payment_paid", async () => { expect((await payment(row.id)).status).toBe(500); });
  expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("pending");
  expect(await db.paymentEvent.count()).toBe(0); expect(await db.auditEvent.count()).toBe(0);
});
test.each(["channel", "template"] as const)("카카오 %s 심사는 안전한 범위와 요청 ID를 감사하고 저장 실패는 상태를 보존한다", async kind => {
  const f = await fixture(), channel = await db.kakaoChannel.create({ data: { ...f, name: "합성 채널", searchId: "@synthetic" } });
  const template = await db.kakaoTemplate.create({ data: { ...f, channelId: channel.id, name: "합성 템플릿", body: "PRIVATE_PROVIDER_MESSAGE", buttons: [], status: "submitted" } });
  const id = kind === "channel" ? channel.id : template.id, action = kind === "channel" ? "kakao.channel_verified" : "kakao.template_approved";
  const raw = JSON.stringify({ kind, id, version: 1, outcome: kind === "channel" ? "verified" : "approved", note: "PRIVATE_PROVIDER_NOTE" }), requestId = randomUUID();
  await fault(action, async () => { await expect(applyKakaoReview(raw, sign(raw), secret, requestId)).rejects.toThrow(); });
  expect((kind === "channel" ? await db.kakaoChannel.findUniqueOrThrow({ where: { id } }) : await db.kakaoTemplate.findUniqueOrThrow({ where: { id } })).status).toBe(kind === "channel" ? "pending" : "submitted");
  await applyKakaoReview(raw, sign(raw), secret, requestId);
  const event = await db.auditEvent.findFirstOrThrow({ where: { requestId } }); expect(event).toMatchObject({ ...f, actorId: null, action, resourceId: id });
  expect(JSON.stringify(event)).not.toMatch(/PRIVATE_PROVIDER/);
});
test("원장 감사 실패는 잔고와 쌍별 기입까지 롤백하며 동일 원천은 한 번만 감사한다", async () => {
  const f = await fixture(), input = { tenantId: f.tenantId, currency: "KRW", kind: "funding" as const, amount: BigInt(100), sourceKind: "pg_capture", sourceId: randomUUID() };
  await fault("billing.ledger_funding", async () => { await expect(postTrustedLedgerTransfer(input)).rejects.toThrow(); });
  expect(await db.ledgerTransaction.count()).toBe(0); expect(await db.ledgerEntry.count()).toBe(0); expect(await db.creditAccount.count()).toBe(0);
  const saved = await postTrustedLedgerTransfer(input); expect((await postTrustedLedgerTransfer(input)).id).toBe(saved.id);
  expect(await db.auditEvent.count({ where: { resourceId: saved.id, requestId: saved.id, action: "billing.ledger_funding" } })).toBe(1);
});
test("체험 만료 감사 실패는 만료 상태·개정·이력까지 롤백한다", async () => {
  const f = await fixture(), version = await db.billingPlanVersion.findFirstOrThrow({ where: { planId: "trial", cycle: "trial" } });
  const start = new Date(Date.now() - 8 * 86400000), row = await db.billingSubscription.create({ data: { tenantId: f.tenantId, planId: "trial", planVersionId: version.id, status: "trialing", priceKrw: 0, activationSource: "trial", periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86400000) } });
  await fault("billing.trial_expired", async () => { await expect(expireSubscriptions()).rejects.toThrow(); });
  expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("trialing"); expect(await db.billingSubscriptionEvent.count()).toBe(0);
  expect(await expireSubscriptions()).toBe(1); expect(await expireSubscriptions()).toBe(0);
  expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "billing.trial_expired", actorId: null } })).toBe(1);
});
async function notification(expired = false) {
  const f = await fixture(), user = await db.user.create({ data: { name: "합성 담당자", email: randomUUID() + "@example.test", emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: f.tenantId, userId: user.id, role: "owner" } });
  const integration = await db.notificationIntegration.create({ data: { ...f, creatorId: member.id, name: "합성 알림", provider: "slack", transport: "local", endpointCipher: encrypt("https://hooks.slack.com/services/TLOCAL/BLOCAL/SYNTHETICSECRET1234567890"), endpointHost: "hooks.slack.com" } });
  const event = await db.notificationEvent.create({ data: { ...f, eventKey: randomUUID(), kind: "test", sourceId: integration.id, targetId: integration.id, sourceVersion: 1 } });
  await db.notificationDelivery.create({ data: { ...f, integrationId: integration.id, eventId: event.id, transport: "local", generation: 1 } });
  const leased = await claimNotification("audit-test"); expect(leased).toBeDefined();
  return db.notificationDelivery.update({ where: { id: leased.id }, data: { status: "sending", ...(expired ? { leaseUntil: new Date(Date.now() - 1000) } : {}), version: { increment: 1 } } });
}
test("알림 결과 감사 실패는 시도와 최종 상태를 롤백하고 복구 후 같은 범위에 안전한 결과를 남긴다", async () => {
  const row = await notification();
  const complete = () => db.$transaction(tx => notificationAttemptResult(tx, row, { kind: "success", outcome: "local_delivered" }));
  await fault("message.notification_local_delivered", async () => { await expect(complete()).rejects.toThrow(); });
  expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("sending"); expect(await db.notificationAttempt.count()).toBe(0);
  await complete(); const events = await db.auditEvent.findMany({ where: { resourceId: row.id } }); expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ tenantId: row.tenantId, serviceId: row.serviceId, actorId: null, requestId: row.id, action: "message.notification_local_delivered", detail: { changedFields: ["status"] } });
});
test("알림 lease 복구 감사 실패는 불확실 상태와 시도 기록을 함께 롤백한다", async () => {
  const row = await notification(true);
  await fault("message.notification_unknown", async () => { await expect(recoverNotifications()).rejects.toThrow(); });
  expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("sending"); expect(await db.notificationAttempt.count()).toBe(0);
  expect(await recoverNotifications()).toBe(1); expect(await recoverNotifications()).toBe(0);
  expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "message.notification_unknown" } })).toBe(1);
});
