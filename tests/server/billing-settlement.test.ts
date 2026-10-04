import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";
import { senderAddressHash } from "@/server/senders";
import { roleCapabilities } from "@/server/permissions";
import { postTrustedLedgerTransfer } from "@/server/ledger";
import { runOneJob } from "@/server/jobs";
import { POST, GET } from "@/app/api/v1/campaigns/[[...segments]]/route";
import { POST as formPost } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Settlement!123", saved = { sms: env.SMS_TRANSPORT, cost: env.MESSAGE_UNIT_COST_KRW };
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> { expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json(); }
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  env.SMS_TRANSPORT = "local"; env.MESSAGE_UNIT_COST_KRW = 50;
});
afterAll(async () => { env.SMS_TRANSPORT = saved.sms; env.MESSAGE_UNIT_COST_KRW = saved.cost; await db.$disconnect(); });

async function fixture() {
  const email = "settle-" + randomUUID() + "@catchsecu.test";
  await ok(await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "정산", email, password })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "정산 회사", publicName: "정산", policy: { create: {} } } });
  const service = await db.service.create({ data: { tenantId: company.id, name: "정산 서비스", externalName: "정산" } });
  const member = await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  await db.serviceGrant.create({ data: { tenantId: company.id, memberId: member.id, serviceId: service.id, capabilities: [...roleCapabilities("owner")] } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const phone = "010" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
  const sender = await db.$transaction(async tx => {
    const created = await tx.sender.create({ data: { tenantId: company.id, serviceId: service.id, creatorId: user.id, channel: "sms",
      addressHash: senderAddressHash("sms", phone), addressCipher: encrypt(phone), label: "정산 발신자" } });
    await tx.senderEvent.create({ data: { tenantId: company.id, senderId: created.id, version: 1, kind: "created", actorId: user.id } });
    const until = new Date(Date.now() + 90 * 86400e3);
    await tx.senderVerification.create({ data: { tenantId: company.id, senderId: created.id, generation: 1, method: "solapi", status: "verified",
      attempts: 1, environment: "live", verifiedAt: new Date(), validUntil: until, expiresAt: until } });
    await tx.sender.update({ where: { id: created.id }, data: { status: "verified", version: 2, verifiedAt: new Date(), expiresAt: until, environment: "live" } });
    await tx.senderEvent.create({ data: { tenantId: company.id, senderId: created.id, version: 2, kind: "verified", actorId: user.id } });
    return created;
  });
  const name = randomUUID(), mail = randomUUID(), tel = randomUUID();
  const form = await ok<{ id: string; version: number }>(await formPost(req("/forms", cookie, "POST", { serviceId: service.id, title: "정산 근거 " + randomUUID(),
    content: { body: "합성", consentPurpose: "시험", consentRequired: true, retentionDays: 30, maxResponses: 20,
      questions: [{ id: name, label: "이름", type: "단문형 답변", required: true }, { id: mail, label: "이메일", type: "단문형 답변", required: true }, { id: tel, label: "전화번호", type: "단문형 답변", required: true }],
      marketing: { purpose: "소식 안내", nameQuestionId: name, emailQuestionId: mail, smsQuestionId: tel } } }, randomUUID())), 201);
  const pub = await ok<{ token: string }>(await formAction(req("/forms/" + form.id + "/publish", cookie, "POST", { version: form.version }, randomUUID())), 201);
  const target = "010" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
  const sub = await ok<{ id: string }>(await publicPost(req("/public/forms/" + pub.token + "/submissions", "", "POST",
    { answers: { [name]: "정산 수신자", [mail]: "s-" + randomUUID() + "@settle.test", [tel]: target }, consent: true, marketingChannels: ["sms"] }, randomUUID())), 201);
  const pref = await db.marketingPreference.findFirstOrThrow({ where: { sourceSubmissionId: sub.id, channel: "sms" } });
  return { company, service, member, cookie, sender, pref };
}
async function campaign(fx: Awaited<ReturnType<typeof fixture>>, cost = env.MESSAGE_UNIT_COST_KRW) {
  env.MESSAGE_UNIT_COST_KRW = cost;
  const created = await ok<{ id: string }>(await POST(req("/campaigns", fx.cookie, "POST", { serviceId: fx.service.id, channel: "sms", source: "form",
    title: "정산 캠페인 " + randomUUID(), senderId: fx.sender.id, content: { format: "text", subject: "정산", text: "정산 문자" } }, randomUUID())), 201);
  const draft = await ok<{ version: number }>(await GET(req("/campaigns/" + created.id, fx.cookie)));
  await ok(await POST(req("/campaigns/" + created.id + "/recipients", fx.cookie, "POST", { mode: "selection", version: draft.version, preferenceIds: [fx.pref.id] })));
  const current = await ok<{ version: number }>(await GET(req("/campaigns/" + created.id, fx.cookie)));
  await ok(await POST(req("/campaigns/" + created.id + "/schedule", fx.cookie, "POST", { version: current.version, at: null }, randomUUID())), 202);
  return created.id;
}
async function drain(campaignId: string) {
  for (let i = 0; i < 30; i++) {
    await runOneJob("settle-" + randomUUID());
    const job = await db.job.findFirst({ where: { campaignDelivery: { campaignId } }, orderBy: { createdAt: "desc" } });
    if (job && ["done", "cancelled", "dead"].includes(job.status)) return job;
  }
  throw new Error("campaign job did not finish");
}
const account = (tenantId: string) => db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId, currency: "KRW" } } });
const ledger = (tenantId: string) => db.ledgerTransaction.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });

test("문자 발송은 예약·확정으로 정산되고 재실행해도 이중 차감되지 않는다", async () => {
  const fx = await fixture();
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(120), sourceKind: "pg_capture", sourceId: randomUUID() });
  const campaignId = await campaign(fx);
  const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId } });
  await drain(campaignId);
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("local_delivered");
  const rows = await ledger(fx.company.id), kinds = rows.map(r => r.kind);
  expect(kinds).toEqual(["funding", "reserve", "capture"]);
  expect(rows[2].reservationId).toBe(rows[1].id);
  expect(rows[1].sourceKind).toBe("campaign_delivery"); expect(rows[1].sourceId).toBe(delivery.id);
  const acc = await account(fx.company.id);
  expect(acc.available).toBe(BigInt(70)); expect(acc.held).toBe(BigInt(0));
  const job = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId } } });
  const { runCampaignJob } = await import("@/server/campaign-worker");
  await runCampaignJob(job, "settle-replay");
  expect((await ledger(fx.company.id)).length).toBe(3);
  expect(await db.ledgerEntry.count({ where: { transaction: { tenantId: fx.company.id } } })).toBe(6);
});

test("잔액 부족은 INSUFFICIENT_CREDIT 실패로 기록되고 원장을 오염시키지 않는다", async () => {
  const fx = await fixture();
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(30), sourceKind: "pg_capture", sourceId: randomUUID() });
  const campaignId = await campaign(fx);
  const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId } });
  await drain(campaignId);
  const row = await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  expect(row.status).toBe("failed"); expect(row.reason).toBe("INSUFFICIENT_CREDIT");
  const rows = await ledger(fx.company.id);
  expect(rows.map(r => r.kind)).toEqual(["funding"]);
  const acc = await account(fx.company.id);
  expect(acc.available).toBe(BigInt(30)); expect(acc.held).toBe(BigInt(0));
});

test("동의 철회로 취소된 발송은 예약 크레딧을 반환한다", async () => {
  const fx = await fixture();
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(100), sourceKind: "pg_capture", sourceId: randomUUID() });
  const campaignId = await campaign(fx);
  const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId } });
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, serviceId: fx.service.id, currency: "KRW", kind: "reserve", amount: BigInt(50), sourceKind: "campaign_delivery", sourceId: delivery.id });
  await db.$transaction(async tx => {
    const bumped = await tx.marketingPreference.update({ where: { id: fx.pref.id }, data: { version: { increment: 1 } } });
    await tx.marketingEvent.create({ data: { tenantId: fx.company.id, preferenceId: fx.pref.id, kind: "source_corrected", version: bumped.version } });
  });
  await drain(campaignId);
  const row = await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  expect(row.status).toBe("cancelled");
  const rows = await ledger(fx.company.id), kinds = rows.map(r => r.kind);
  expect(kinds).toEqual(["funding", "reserve", "release"]);
  const acc = await account(fx.company.id);
  expect(acc.available).toBe(BigInt(100)); expect(acc.held).toBe(BigInt(0));
});
