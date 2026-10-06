import { randomUUID, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";
import { senderAddressHash } from "@/server/senders";
import { roleCapabilities } from "@/server/permissions";
import { postTrustedLedgerTransfer } from "@/server/ledger";
import * as ledgerModule from "@/server/ledger";
import { runOneJob } from "@/server/jobs";
import { POST, GET } from "@/app/api/v1/campaigns/[[...segments]]/route";
import { POST as formPost } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Settlement!123", saved = { sms: env.SMS_TRANSPORT, cost: env.MESSAGE_UNIT_COST_KRW, sKey: env.SOLAPI_API_KEY, sSecret: env.SOLAPI_API_SECRET, sTenant: env.SOLAPI_TENANT_ID };
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> { expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json(); }
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  env.SMS_TRANSPORT = "local"; env.MESSAGE_UNIT_COST_KRW = 50;
});
afterAll(async () => { env.SMS_TRANSPORT = saved.sms; env.MESSAGE_UNIT_COST_KRW = saved.cost; env.SOLAPI_API_KEY = saved.sKey; env.SOLAPI_API_SECRET = saved.sSecret; env.SOLAPI_TENANT_ID = saved.sTenant; await db.$disconnect(); });

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
  return { company, service, member, cookie, sender, pref, pub, q: { name, mail, tel } };
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
async function drain(tenantId: string, campaignId: string) {
  const target = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId } }, orderBy: { createdAt: "desc" } });
  for (let i = 0; i < 30; i++) {
    await runOneJob("settle-" + randomUUID(), { tenantId, jobId: target.id });
    const job = await db.job.findUniqueOrThrow({ where: { id: target.id } });
    if (["done", "cancelled", "dead"].includes(job.status)) return job;
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
  await drain(fx.company.id, campaignId);
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
  await drain(fx.company.id, campaignId);
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
  await drain(fx.company.id, campaignId);
  const row = await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  expect(row.status).toBe("cancelled");
  const rows = await ledger(fx.company.id), kinds = rows.map(r => r.kind);
  expect(kinds).toEqual(["funding", "reserve", "release"]);
  const acc = await account(fx.company.id);
  expect(acc.available).toBe(BigInt(100)); expect(acc.held).toBe(BigInt(0));
});

test("예약된 문자 캠페인 취소는 미발송분을 취소하고 발송분만 정산한다", async () => {
  const fx = await fixture();
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(100), sourceKind: "pg_capture", sourceId: randomUUID() });
  // 두 번째 동의 수신자를 같은 폼으로 추가한다
  const target = "010" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
  const sub2 = await ok<{ id: string }>(await publicPost(req("/public/forms/" + fx.pub.token + "/submissions", "", "POST",
    { answers: { [fx.q.name]: "두번째", [fx.q.mail]: "s2-" + randomUUID() + "@settle.test", [fx.q.tel]: target }, consent: true, marketingChannels: ["sms"] }, randomUUID())), 201);
  const pref2 = await db.marketingPreference.findFirstOrThrow({ where: { sourceSubmissionId: sub2.id, channel: "sms" } });
  // 캠페인을 두 수신자로 예약하고 한 건만 실제 발송한다
  const created = await ok<{ id: string }>(await POST(req("/campaigns", fx.cookie, "POST", { serviceId: fx.service.id, channel: "sms", source: "form",
    title: "취소 정산 " + randomUUID(), senderId: fx.sender.id, content: { format: "text", subject: "정산", text: "정산 문자" } }, randomUUID())), 201);
  const draft = await ok<{ version: number }>(await GET(req("/campaigns/" + created.id, fx.cookie)));
  await ok(await POST(req("/campaigns/" + created.id + "/recipients", fx.cookie, "POST", { mode: "selection", version: draft.version, preferenceIds: [fx.pref.id, pref2.id] })));
  const current = await ok<{ version: number }>(await GET(req("/campaigns/" + created.id, fx.cookie)));
  await ok(await POST(req("/campaigns/" + created.id + "/schedule", fx.cookie, "POST", { version: current.version, at: null }, randomUUID())), 202);
  // 첫 잡만 실제 발송까지 완료한다
  const first = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: created.id }, status: "queued" }, orderBy: { createdAt: "asc" } });
  await runOneJob("settle-" + randomUUID(), { tenantId: fx.company.id, jobId: first.id });
  expect((await db.job.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("done");
  const latest = await ok<{ version: number }>(await GET(req("/campaigns/" + created.id, fx.cookie)));
  const cancelled = await ok<{ cancelled: number; accepted: number }>(await POST(req("/campaigns/" + created.id + "/cancel", fx.cookie, "POST", { version: latest.version }, randomUUID())));
  expect(cancelled).toMatchObject({ cancelled: 1, accepted: 1 });
  // 미발송분은 잡도 취소되고 원장에 아무 기록도 남지 않는다 — 발송분만 reserve+capture 정산
  const rows = (await db.campaignDelivery.findMany({ where: { campaignId: created.id }, orderBy: { createdAt: "asc" } }));
  expect(rows.map(r => r.status).sort()).toEqual(["cancelled", "local_delivered"]);
  const leftover = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: created.id }, id: { not: first.id } } });
  expect(leftover.status).toBe("cancelled");
  const kinds = (await ledger(fx.company.id)).map(r => r.kind);
  expect(kinds).toEqual(["funding", "reserve", "capture"]);
  const acc = await account(fx.company.id);
  expect(acc.available).toBe(BigInt(50)); expect(acc.held).toBe(BigInt(0));
  // 취소된 잡은 재실행돼도 발송되지 않는다 — 해당 잡을 직접 claim해도 변하지 않는다
  await runOneJob("settle-" + randomUUID(), { tenantId: fx.company.id, jobId: leftover.id });
  expect((await db.job.findUniqueOrThrow({ where: { id: leftover.id } })).status).toBe("cancelled");
  expect((await ledger(fx.company.id)).length).toBe(3);
});

const webhookSecret = "settle-webhook-secret-0123456789";
const signReceipt = (body: string) => createHmac("sha256", webhookSecret).update(body).digest("hex");
async function smsReceipt(deliveryId: string, outcome: "accepted" | "failed" | "timeout") {
  const { applySmsReceipt } = await import("@/server/sms-adapter");
  const body = JSON.stringify({ deliveryId, receiptId: "rcpt-" + randomUUID(), outcome });
  return applySmsReceipt(body, signReceipt(body), webhookSecret);
}
// 발송 중 크래시를 재현한다 — delivery는 sending, 예약 홀드만 남고 finish가 안 끝난 상태.
async function crashedSend(fx: Awaited<ReturnType<typeof fixture>>) {
  const campaignId = await campaign(fx);
  const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId } });
  await db.campaignDelivery.update({ where: { id: delivery.id }, data: { status: "sending" } });
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, serviceId: fx.service.id, currency: "KRW", kind: "reserve", amount: BigInt(50), sourceKind: "campaign_delivery", sourceId: delivery.id });
  return { campaignId, delivery };
}
const holdsOf = (tenantId: string, deliveryId: string) => db.ledgerTransaction.findMany({ where: { tenantId, sourceId: deliveryId } });

test("공급자 수신 결과는 미정산 발송 예약을 접수는 청구·거부와 미확인은 환불로 정산한다", async () => {
  const fx = await fixture();
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(300), sourceKind: "pg_capture", sourceId: randomUUID() });
  // 접수 → 청구 유지
  const a = await crashedSend(fx);
  await smsReceipt(a.delivery.id, "accepted");
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: a.delivery.id } })).status).toBe("accepted");
  expect((await holdsOf(fx.company.id, a.delivery.id)).map(r => r.kind)).toEqual(["reserve", "capture"]);
  // 거부 → 환불
  const b = await crashedSend(fx);
  await smsReceipt(b.delivery.id, "failed");
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: b.delivery.id } })).status).toBe("failed");
  expect((await holdsOf(fx.company.id, b.delivery.id)).map(r => r.kind)).toEqual(["reserve", "release"]);
  // 미확인(timeout) → 환불
  const c = await crashedSend(fx);
  await smsReceipt(c.delivery.id, "timeout");
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: c.delivery.id } })).status).toBe("unknown");
  expect((await holdsOf(fx.company.id, c.delivery.id)).map(r => r.kind)).toEqual(["reserve", "release"]);
  // unknown은 종결 상태라 상태는 바뀌지 않지만 원장은 정산된다
  const d = await crashedSend(fx);
  await db.campaignDelivery.update({ where: { id: d.delivery.id }, data: { status: "unknown", reason: "DELIVERY_UNCERTAIN" } });
  await smsReceipt(d.delivery.id, "accepted");
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: d.delivery.id } })).status).toBe("unknown");
  expect((await holdsOf(fx.company.id, d.delivery.id)).map(r => r.kind)).toEqual(["reserve", "capture"]);
  const acc = await account(fx.company.id);
  expect(acc.available).toBe(BigInt(200)); expect(acc.held).toBe(BigInt(0));
});

test("solapi 영수증 부재 복구는 재전송하지 않고 webhook 대사가 정산한다", async () => {
  const fx = await fixture();
  env.SMS_TRANSPORT = "solapi"; env.SOLAPI_API_KEY = "test-solapi-key"; env.SOLAPI_API_SECRET = "test-solapi-secret-0123"; env.SOLAPI_TENANT_ID = fx.company.id;
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(100), sourceKind: "pg_capture", sourceId: randomUUID() });
  const calls: string[] = [], realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => { calls.push(String(url)); return new Response("{}", { status: 500 }); }) as typeof fetch;
  try {
    const { campaignId, delivery } = await crashedSend(fx);
    const job = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId } } });
    expect(job.status).toBe("queued");
    await runOneJob("settle-" + randomUUID(), { tenantId: fx.company.id, jobId: job.id });
    // 공급자 수신 여부를 모르므로 재전송하지 않는다 — 잡은 죽고 발송 상태는 unknown으로 보존
    expect(calls.filter(u => u.includes("solapi.com"))).toEqual([]);
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status + ":" + (done.lastError ?? "")).toBe("dead:DELIVERY_UNCERTAIN");
    const row = await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe("unknown"); expect(row.reason).toBe("DELIVERY_UNCERTAIN");
    // webhook이 올 때까지 예약은 보류한다
    let acc = await account(fx.company.id);
    expect(acc.available).toBe(BigInt(50)); expect(acc.held).toBe(BigInt(50));
    // 뒤늦게 온 접수 결과가 보류를 청구로 정산한다 — 발송 상태는 종결된 unknown을 유지
    await smsReceipt(delivery.id, "accepted");
    acc = await account(fx.company.id);
    expect(acc.available).toBe(BigInt(50)); expect(acc.held).toBe(BigInt(0));
    expect((await holdsOf(fx.company.id, delivery.id)).map(r => r.kind)).toEqual(["reserve", "capture"]);
    expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("unknown");
  } finally { globalThis.fetch = realFetch; }
});

test("끊긴 발송 잡의 수리는 영수증으로 정산하고 미전송분은 환불한다", async () => {
  const fx = await fixture();
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(100), sourceKind: "pg_capture", sourceId: randomUUID() });
  const { cleanupCampaigns } = await import("@/server/campaign-worker");
  // 영수증이 남은 크래시 → 접수로 정산
  const a = await crashedSend(fx);
  const jobA = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: a.campaignId } } });
  await db.job.update({ where: { id: jobA.id }, data: { status: "dead" } });
  await mkdir(env.LOCAL_SMS_DIR, { recursive: true });
  await writeFile(resolve(env.LOCAL_SMS_DIR, jobA.id + ".json"), JSON.stringify({ jobId: jobA.id, status: "local_delivered" }));
  // 영수증이 없는 크래시 → 로컬 전송은 미전송이 확실하므로 환불
  const b = await crashedSend(fx);
  const jobB = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: b.campaignId } } });
  await db.job.update({ where: { id: jobB.id }, data: { status: "dead" } });
  await cleanupCampaigns();
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: a.delivery.id } })).status).toBe("local_delivered");
  expect((await holdsOf(fx.company.id, a.delivery.id)).map(r => r.kind)).toEqual(["reserve", "capture"]);
  const rowB = await db.campaignDelivery.findUniqueOrThrow({ where: { id: b.delivery.id } });
  expect(rowB.status).toBe("unknown"); expect(rowB.reason).toBe("DELIVERY_UNCERTAIN");
  expect((await holdsOf(fx.company.id, b.delivery.id)).map(r => r.kind)).toEqual(["reserve", "release"]);
  const acc = await account(fx.company.id);
  expect(acc.available).toBe(BigInt(50)); expect(acc.held).toBe(BigInt(0));
});

test("월별 사용량은 서비스별로 집계되고 마감 스냅샷에 보존된다", async () => {
  const fx = await fixture();
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, currency: "KRW", kind: "funding", amount: BigInt(200), sourceKind: "pg_capture", sourceId: randomUUID() });
  const campaignId = await campaign(fx);
  const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId } });
  await drain(fx.company.id, campaignId);
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("local_delivered");
  // 두 번째 서비스의 사용량을 섞는다
  const other = await db.service.create({ data: { tenantId: fx.company.id, name: "두번째 서비스", externalName: "두번째" } });
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, serviceId: other.id, currency: "KRW", kind: "reserve", amount: BigInt(30), sourceKind: "campaign_delivery", sourceId: randomUUID() });
  const released = await db.ledgerTransaction.findFirstOrThrow({ where: { tenantId: fx.company.id, kind: "reserve", serviceId: other.id } });
  await postTrustedLedgerTransfer({ tenantId: fx.company.id, serviceId: other.id, currency: "KRW", kind: "release", amount: BigInt(30), sourceKind: "campaign_delivery", sourceId: randomUUID(), reservationId: released.id });
  const { GET: closingGet } = await import("@/app/api/v1/billing/closing/route");
  const month = new Date().toISOString().slice(0, 7);
  const live = await ok<{ services: { serviceId: string; captured: string; released: string }[] }>(await closingGet(req("/billing/closing?month=" + month, fx.cookie)));
  const first = live.services.find(s => s.serviceId === fx.service.id), second = live.services.find(s => s.serviceId === other.id);
  expect(first).toMatchObject({ serviceId: fx.service.id, serviceName: "정산 서비스", captured: "50", released: "0" });
  expect(second).toMatchObject({ serviceId: other.id, captured: "0", released: "30" });
  // 이미 마감된 월의 스냅샷도 같은 구조로 읽힌다
  const { POST: closingPost } = await import("@/app/api/v1/billing/closing/route");
  const past = "2026-09";
  const closed = await ok<{ services: unknown[] }>(await closingPost(req("/billing/closing", fx.cookie, "POST", { month: past, currency: "KRW" }, randomUUID())), 201);
  expect(closed.services).toEqual([]);
  const reread = await ok<{ closed: boolean; services: unknown[] }>(await closingGet(req("/billing/closing?month=" + past, fx.cookie)));
  expect(reread).toMatchObject({ closed: true, services: [] });
});

test.each(["accepted","failed","timeout"] as const)("수동 재요청 문자 webhook %s는 새 attempt 예약만 정산한다", async outcome=>{
  const fx=await fixture();await postTrustedLedgerTransfer({tenantId:fx.company.id,currency:"KRW",kind:"funding",amount:BigInt(150),sourceKind:"pg_capture",sourceId:randomUUID()});
  const campaignId=await campaign(fx),delivery=await db.campaignDelivery.findFirstOrThrow({where:{campaignId}});
  const old=await postTrustedLedgerTransfer({tenantId:fx.company.id,serviceId:fx.service.id,currency:"KRW",kind:"reserve",amount:BigInt(50),sourceKind:"campaign_delivery",sourceId:delivery.id});
  await postTrustedLedgerTransfer({tenantId:fx.company.id,serviceId:fx.service.id,currency:"KRW",kind:"release",amount:BigInt(50),sourceKind:"campaign_delivery",sourceId:delivery.id,reservationId:old.id});
  await db.campaignDelivery.update({where:{id:delivery.id},data:{status:"sending"}});
  await db.campaignDelivery.update({where:{id:delivery.id},data:{status:"failed",reason:"DELIVERY_FAILED"}});
  const job=await db.job.findFirstOrThrow({where:{campaignDeliveryId:delivery.id}});await db.job.update({where:{id:job.id},data:{status:"dead"}});
  const {cleanupCampaigns}=await import("@/server/campaign-worker");await cleanupCampaigns();
  const current=await ok<{version:number}>(await GET(req("/campaigns/"+campaignId,fx.cookie)));
  await ok(await POST(req("/campaigns/"+campaignId+"/retry",fx.cookie,"POST",{version:current.version,ids:[delivery.id]},randomUUID())),202);
  expect(await db.campaignDelivery.findUniqueOrThrow({where:{id:delivery.id}})).toMatchObject({attempt:2,status:"queued"});
  await db.campaignDelivery.update({where:{id:delivery.id},data:{status:"sending"}});
  const source=delivery.id+":attempt:2",hold=await postTrustedLedgerTransfer({tenantId:fx.company.id,serviceId:fx.service.id,currency:"KRW",kind:"reserve",amount:BigInt(50),sourceKind:"campaign_delivery",sourceId:source});
  await smsReceipt(delivery.id,outcome);
  const entries=await db.ledgerTransaction.findMany({where:{tenantId:fx.company.id,sourceId:source}});
  expect(entries.map(r=>r.kind).sort()).toEqual([outcome==="accepted"?"capture":"release","reserve"].sort());
  expect(entries.find(r=>r.kind!=="reserve")?.reservationId).toBe(hold.id);
  expect((await holdsOf(fx.company.id,delivery.id)).map(r=>r.kind).sort()).toEqual(["release","reserve"]);
  expect(await account(fx.company.id)).toMatchObject({available:BigInt(outcome==="accepted"?100:150),held:BigInt(0)});
});

test.each(["worker","cleanup"] as const)("이전 빌드가 예약한 수동 attempt의 기존 원장은 %s에서도 중복 예약 없이 복구한다", async mode=>{
  const fx=await fixture(),campaignId=await campaign(fx);
  await drain(fx.company.id,campaignId);
  const delivery=await db.campaignDelivery.findFirstOrThrow({where:{campaignId}});expect(delivery.status).toBe("failed");
  expect(await db.ledgerTransaction.count({where:{tenantId:fx.company.id,sourceId:delivery.id}})).toBe(0);
  await postTrustedLedgerTransfer({tenantId:fx.company.id,currency:"KRW",kind:"funding",amount:BigInt(100),sourceKind:"pg_capture",sourceId:randomUUID()});
  const current=await ok<{version:number}>(await GET(req("/campaigns/"+campaignId,fx.cookie)));
  await ok(await POST(req("/campaigns/"+campaignId+"/retry",fx.cookie,"POST",{version:current.version,ids:[delivery.id]},randomUUID())),202);
  await postTrustedLedgerTransfer({tenantId:fx.company.id,serviceId:fx.service.id,currency:"KRW",kind:"reserve",amount:BigInt(50),sourceKind:"campaign_delivery",sourceId:delivery.id});
  const job=await db.job.findFirstOrThrow({where:{campaignDeliveryId:delivery.id},orderBy:{createdAt:"desc"}});
  const {cleanupCampaigns}=await import("@/server/campaign-worker");
  try {
    if(mode==="cleanup") {
      const post=ledgerModule.postLedgerTransfer;
      vi.spyOn(ledgerModule,"postLedgerTransfer").mockImplementation(async(tx,input)=>{
        if(input.kind==="capture")throw new Error("MOCK_LEGACY_CAPTURE_INTERRUPTED");return post(tx,input);
      });
    }
    await runOneJob("legacy-attempt-"+randomUUID(),{tenantId:fx.company.id,jobId:job.id});
    if(mode==="cleanup") {
      vi.restoreAllMocks();expect(await db.campaignDelivery.findUniqueOrThrow({where:{id:delivery.id}})).toMatchObject({status:"sending",attempt:2});
      await db.job.update({where:{id:job.id},data:{status:"dead",leaseOwner:null,leaseUntil:null}});await cleanupCampaigns();
    }
    const rows=await db.ledgerTransaction.findMany({where:{tenantId:fx.company.id,sourceKind:"campaign_delivery",sourceId:{startsWith:delivery.id}}});
    expect(rows.map(r=>r.kind).sort()).toEqual(["capture","reserve"]);expect(rows.every(r=>r.sourceId===delivery.id)).toBe(true);
    expect(await account(fx.company.id)).toMatchObject({available:BigInt(50),held:BigInt(0)});
    expect(await db.campaignDelivery.findUniqueOrThrow({where:{id:delivery.id}})).toMatchObject({status:"local_delivered",attempt:2});
    await cleanupCampaigns();expect(await account(fx.company.id)).toMatchObject({available:BigInt(50),held:BigInt(0)});
  }finally {vi.restoreAllMocks();}
});
