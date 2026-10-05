import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/v1/email-unsubscribe/[token]/route";
import { POST as feedbackPost } from "@/app/api/v1/email-feedback/route";
import { GET as suppressionGet } from "@/app/api/v1/email-suppressions/route";
import { unsubscribeToken, unsubscribeJobId } from "@/server/email-policy";
import { createHmac } from "node:crypto";
import { withEmailPolicy } from "@/server/email-policy";
import { PUT as uploadPut, POST as uploadPost } from "@/app/api/v1/uploads/[...segments]/route";
import { GET as fileGet } from "@/app/api/v1/files/[...segments]/route";
import { privateFiles } from "@/server/file-storage";
import { sha256 } from "@/server/file-validation";
import { cleanupExpiredFiles } from "@/server/files";
import type { FileInfo } from "@/contracts/files";
import { GET as templateGet, POST as templatePost, PATCH as templatePatch, DELETE as templateDelete } from "@/app/api/v1/message-templates/[[...segments]]/route";
import { POST as contentPreview } from "@/app/api/v1/message-content/preview/route";
import type { MessageTemplateRecord } from "@/contracts/message-templates";
import { randomUUID } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { readFile, access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import nodemailer from "nodemailer";
import type { Role } from "@/generated/prisma/client";
import type { CampaignRecord, CampaignPreview, DeliveryRecord } from "@/contracts/campaigns";
import type { Paged, FormRecord } from "@/contracts/forms";
import type { SenderRecord } from "@/contracts/senders";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { encrypt, decrypt } from "@/server/crypto";
import { roleCapabilities } from "@/server/permissions";
import { GET, POST, PATCH, DELETE } from "@/app/api/v1/campaigns/[[...segments]]/route";
import { GET as senderGet, POST as senderPost } from "@/app/api/v1/senders/[[...segments]]/route";
import { POST as formPost } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as marketingPost, PATCH as marketingPatch, DELETE as marketingDelete } from "@/app/api/v1/marketing/[...segments]/route";
import { GET as marketingGet } from "@/app/api/v1/marketing/[...segments]/route";
import type { MarketingSummary } from "@/contracts/marketing";
import * as mailer from "@/server/jobs";
import { cleanupCampaigns, runCampaignJob } from "@/server/campaign-worker";
import { cleanupMarketingJobs } from "@/server/marketing-jobs";
import { requireContext } from "@/server/context";
import { readCampaign } from "@/server/campaigns";
import { POST as subAction } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as destructionAction } from "@/app/api/v1/destruction-requests/[...segments]/route";
import { runOneDestruction } from "@/server/destruction-worker";
import { certificateDigest } from "@/server/destruction";
import { localSenderDns } from "../helpers/sender-dns";
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), other = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
const records = new Map<string, string>(); let dns: Awaited<ReturnType<typeof localSenderDns>>, sender: SenderRecord;
const original = { feedback: env.EMAIL_FEEDBACK_SECRET, oneClick: env.SMTP_LIST_UNSUBSCRIBE_DKIM_SIGNED, origin: env.BETTER_AUTH_URL, dns: env.SENDER_DNS_SERVER, mail: env.MAIL_TRANSPORT, dir: env.LOCAL_MAIL_DIR, host: env.SMTP_HOST, domains: env.SMTP_SENDER_DOMAINS };
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? who, ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> { expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json(); }
async function signup(name: string, tenantId: string, role: Role) {
  await db.rateLimit.deleteMany(); const email = name + "@campaigns.local.test", password = "Campaign-synthetic-password-2026!";
  await ok(await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password })));
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } }); members[name] = member.id;
  await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId: tenantId === tenant ? service : other, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200);
  cookies[name] = response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
}
async function verifiedSender() {
  const address = "sender@" + randomUUID() + (env.MAIL_TRANSPORT === "smtp" ? ".example.com" : ".test");
  if (env.MAIL_TRANSPORT === "smtp") env.SMTP_SENDER_DOMAINS = address.split("@")[1];
  const created = await ok<{ id: string }>(await senderPost(req("/senders", "POST", "owner", { serviceId: service, channel: "email", address, label: "캠페인 합성 발신자", description: "" }, { "idempotency-key": randomUUID() })), 201);
  let row = await ok<SenderRecord>(await senderGet(req("/senders/" + created.id)));
  await ok(await senderPost(req("/senders/" + row.id + "/dns", "POST", "owner", { version: row.version })), 201);
  row = await ok<SenderRecord>(await senderGet(req("/senders/" + row.id))); const proof = row.verifications!.find(p => p.method === "dns")!; records.set(proof.recordName!, proof.recordValue!);
  await ok(await senderPost(req("/senders/" + row.id + "/check", "POST", "owner", { version: row.version })));
  row = await ok<SenderRecord>(await senderGet(req("/senders/" + row.id)));
  const sent = await ok<{ id: string }>(await senderPost(req("/senders/" + row.id + "/request-email", "POST", "owner", { version: row.version })), 202);
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sender-verification:" + sent.id } });
  await drain(job.id); const code = /인증번호: (\d{6})/.exec(decrypt<{ text: string }>(job.payloadCipher).text)![1];
  row = await ok<SenderRecord>(await senderGet(req("/senders/" + row.id)));
  await ok(await senderPost(req("/senders/" + row.id + "/confirm-email", "POST", "owner", { version: row.version, verificationId: sent.id, code })));
  row = await ok<SenderRecord>(await senderGet(req("/senders/" + row.id))); expect(row.status).toBe("verified"); return row;
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "SubjectAccessRequest" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: "캠페인 QA", policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [other, foreign]]) await db.service.create({ data: { id, tenantId, name: id, externalName: "캠페인 검증" } });
  for (const [name, role] of [["owner", "owner"], ["sender", "sender"], ["viewer", "viewer"]] as [string, Role][]) await signup(name, tenant, role);
  await signup("foreign", foreign, "owner"); await db.job.updateMany({ where: { status: "queued" }, data: { status: "cancelled" } });
  dns = await localSenderDns(records); env.SENDER_DNS_SERVER = dns.server; sender = await verifiedSender();
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterEach(() => { env.EMAIL_FEEDBACK_SECRET = original.feedback; env.SMTP_LIST_UNSUBSCRIBE_DKIM_SIGNED = original.oneClick; env.BETTER_AUTH_URL = original.origin; vi.restoreAllMocks(); vi.useRealTimers(); env.MAIL_TRANSPORT = original.mail; env.LOCAL_MAIL_DIR = original.dir; env.SMTP_HOST = original.host; env.SMTP_SENDER_DOMAINS = original.domains; env.SENDER_DNS_SERVER = dns.server; });
afterAll(async () => { for (const file of await db.fileObject.findMany({ where: { tenantId: tenant, campaignId: { not: null } }, select: { storageKey: true } })) await privateFiles.remove(file.storageKey); await dns.close(); env.SENDER_DNS_SERVER = original.dns; await db.$disconnect(); });
async function recipient(nameValue = "합성 수신자", channel: "email" | "sms" = "email") {
  const name = randomUUID(), email = randomUUID(), phone = randomUUID(), contact = "recipient-" + randomUUID() + "@campaigns.local.test";
  const form = await ok<FormRecord>(await formPost(req("/forms", "POST", "owner", { serviceId: service, title: "캠페인 근거 " + randomUUID(), content: { body: "합성", consentPurpose: "시험", consentRequired: true, retentionDays: 30, maxResponses: 20,
    questions: [{ id: name, label: "이름", type: "단문형 답변", required: true }, { id: email, label: "이메일", type: "단문형 답변", required: true }, { id: phone, label: "전화번호", type: "단문형 답변", required: true }],
    marketing: { purpose: "소식 안내", nameQuestionId: name, emailQuestionId: email, smsQuestionId: phone } } }, { "idempotency-key": randomUUID() })), 201);
  const pub = await ok<{ token: string }>(await formAction(req("/forms/" + form.id + "/publish", "POST", "owner", { version: form.version }, { "idempotency-key": randomUUID() })), 201);
  const sms = "010" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
  const sub = await ok<{ id: string }>(await publicPost(req("/public/forms/" + pub.token + "/submissions", "POST", "anonymous", { answers: { [name]: nameValue, [email]: contact, [phone]: sms }, consent: true, marketingChannels: [channel] }, { "idempotency-key": randomUUID() })), 201);
  const pref = await db.marketingPreference.findFirstOrThrow({ where: { sourceSubmissionId: sub.id, channel } }); return { contact: channel === "email" ? contact : sms, pref, sub, form };
}
const content = { format: "text", subject: "{{name}} 님 소식", text: "{{name}} 님, {{contact}}의 신청 내용을 확인했습니다." };
const read = (id: string) => GET(req("/campaigns/" + id)).then(r => ok<CampaignRecord>(r));
const deliveries = (id: string) => GET(req("/campaigns/" + id + "/deliveries?pageSize=100")).then(r => ok<Paged<DeliveryRecord>>(r));
async function create(extra: object = {}) {
  const out = await ok<{ id: string }>(await POST(req("/campaigns", "POST", "owner", { serviceId: service, channel: "email", source: "direct", title: "합성 캠페인 " + randomUUID(), senderId: sender.id, content, ...extra }, { "idempotency-key": randomUUID() })), 201); return read(out.id);
}
async function targets(c: CampaignRecord, contacts: string[]) { await ok(await POST(req("/campaigns/" + c.id + "/recipients", "POST", "owner", { mode: "direct", version: c.version, contacts }))); return read(c.id); }
async function schedule(c: CampaignRecord, extra: object = {}, who = "owner", key = randomUUID()) {
  await ok(await POST(req("/campaigns/" + c.id + "/schedule", "POST", who, { version: c.version, at: null, ...extra }, { "idempotency-key": key })), 202); return read(c.id);
}
async function jobFor(id: string) { return db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: id } }, orderBy: { createdAt: "desc" } }); }
async function drain(id: string) {
  for (let i = 0; i < 30; i++) { await mailer.runOneJob("campaign-test-" + randomUUID()); const row = await db.job.findUniqueOrThrow({ where: { id } }); if (["done", "cancelled", "dead"].includes(row.status)) return row; }
  throw new Error("job did not finish");
}
async function ready(extra: object = {}) { const target = await recipient(); return { target, campaign: await targets(await create(extra), [target.contact]) }; }
describe("persistent campaign CRUD, privacy and delivery", () => {
  test("strict, idempotent drafts support search, versioned update, deletion and immutable history", async () => {
    const input = { serviceId: service, channel: "email", source: "direct", title: "캠페인 검색 " + randomUUID(), content }, key = randomUUID();
    const a = await ok<{ id: string }>(await POST(req("/campaigns", "POST", "owner", input, { "idempotency-key": key })), 201);
    expect(await ok(await POST(req("/campaigns", "POST", "owner", input, { "idempotency-key": key })), 201)).toMatchObject(a);
    expect((await POST(req("/campaigns", "POST", "owner", { ...input, status: "completed" }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await POST(req("/campaigns", "POST", "owner", { ...input, title: "변경" }, { "idempotency-key": key }))).status).toBe(409);
    const list = await ok<Paged<CampaignRecord>>(await GET(req("/campaigns?" + new URLSearchParams({ serviceId: service, channel: "email", search: input.title })))); expect(list.items.map(r => r.id)).toEqual([a.id]);
    await ok(await PATCH(req("/campaigns/" + a.id, "PATCH", "owner", { version: 1, title: "변경", senderId: sender.id, content })));
    expect((await PATCH(req("/campaigns/" + a.id, "PATCH", "owner", { version: 1, title: "충돌", senderId: sender.id, content }))).status).toBe(409);
    expect((await read(a.id)).events!.map(e => e.kind)).toEqual(["updated", "created"]);
    await ok(await DELETE(req("/campaigns/" + a.id, "DELETE", "owner", { version: 2 }))); expect(await read(a.id)).toMatchObject({ status: "deleted", title: "", content: null });
    await expect(db.campaignEvent.deleteMany({ where: { campaignId: a.id } })).rejects.toThrow();
  });
  test("authentication, role, current grant, cross-company and cross-service boundaries apply", async () => {
    const c = await create(); expect((await GET(req("/campaigns/" + c.id, "GET", "anonymous"))).status).toBe(401);
    expect((await GET(req("/campaigns/" + c.id, "GET", "viewer"))).status).toBe(403); expect((await GET(req("/campaigns/" + c.id, "GET", "foreign"))).status).toBe(404);
    expect((await GET(req("/campaigns?serviceId=" + second + "&channel=email", "GET", "sender"))).status).toBe(403);
    await db.serviceGrant.updateMany({ where: { memberId: members.sender }, data: { capabilities: ["service.read"] } });
    try { expect((await GET(req("/campaigns/" + c.id, "GET", "sender"))).status).toBe(403); }
    finally { await db.serviceGrant.updateMany({ where: { memberId: members.sender }, data: { capabilities: [...roleCapabilities("sender")] } }); }
    expect((await POST(req("/campaigns/" + c.id + "/preview", "POST", "owner", { version: c.version }, { origin: "https://invalid.test" }))).status).toBe(403);
  });
  test("CSV normalizes and deduplicates contacts, preserves invalid reasons and encrypts stored values", async () => {
    const r = await recipient(), c = await create();
    const result = await ok<{ total: number; duplicatesRemoved: number }>(await POST(req("/campaigns/" + c.id + "/recipients", "POST", "owner", { version: c.version, mode: "csv", csv: "email\r\n" + r.contact + "\r\n" + r.contact.toUpperCase() + "\r\ninvalid\r\nunknown@campaigns.local.test" })));
    expect(result).toMatchObject({ total: 3, duplicatesRemoved: 1 }); const row = await read(c.id);
    const preview = await ok<CampaignPreview>(await POST(req("/campaigns/" + c.id + "/preview", "POST", "owner", { version: row.version }))); expect(preview).toMatchObject({ total: 3, eligible: 1, excluded: 2, senderReady: true, transportReady: true });
    expect(preview.items.map(i => i.reason)).toEqual([null, "INVALID_CONTACT", "CONSENT_REQUIRED"]); expect(preview.sample!.subject).toBe("합성 수신자 님 소식");
    const stored = JSON.stringify(await db.campaignDelivery.findMany({ where: { campaignId: c.id } })); expect(stored).not.toContain(r.contact); expect(stored).not.toContain("합성 수신자");
    expect((await POST(req("/campaigns/" + c.id + "/recipients", "POST", "owner", { version: row.version, mode: "csv", csv: "a,b" }))).status).toBe(422);
  });
  test("form selection uses explicit same-service consent IDs and exposes no full submission", async () => {
    const r = await recipient(), c = await create({ source: "form" });
    const sources = await ok<Paged<{ id: string }>>(await GET(req("/campaigns/sources?" + new URLSearchParams({ serviceId: service, channel: "email", formId: r.form.id, pageSize: "1" }), "GET", "sender")));
    expect(sources.total).toBe(1); expect(sources.items[0].id).toBe(r.pref.id); expect(JSON.stringify(sources)).not.toContain("answers");
    await ok(await POST(req("/campaigns/" + c.id + "/recipients", "POST", "sender", { version: c.version, mode: "selection", preferenceIds: [r.pref.id] })));
    expect((await deliveries(c.id)).items[0].contact).toBe(r.contact);
    expect((await POST(req("/campaigns/" + c.id + "/recipients", "POST", "owner", { version: 2, mode: "selection", preferenceIds: [randomUUID()] }))).status).toBe(404);
    expect((await POST(req("/campaigns/" + c.id + "/recipients", "POST", "owner", { version: 2, mode: "direct", contacts: [r.contact] }))).status).toBe(422);
  });
  test("exclusions require explicit confirmation and a repeated request creates one frozen outbox", async () => {
    const { target, campaign: initial } = await ready(), c = await targets(initial, [target.contact, "unknown@campaigns.local.test"]), key = randomUUID();
    expect((await POST(req("/campaigns/" + c.id + "/schedule", "POST", "owner", { version: c.version, at: null }, { "idempotency-key": key }))).status).toBe(409);
    await schedule(c, { excludeInvalid: true, at: new Date(Date.now() + 3600000).toISOString() }, "owner", key);
    await schedule(c, { excludeInvalid: true, at: (await read(c.id)).scheduledAt }, "owner", key);
    expect(await db.job.count({ where: { campaignDelivery: { campaignId: c.id } } })).toBe(1);
    const frozen = await read(c.id); expect((await PATCH(req("/campaigns/" + c.id, "PATCH", "owner", { version: frozen.version, title: "변경", senderId: sender.id, content }))).status).toBe(409);
    expect((await DELETE(req("/campaigns/" + c.id, "DELETE", "owner", { version: frozen.version }))).status).toBe(409);
    await ok(await POST(req("/campaigns/" + c.id + "/cancel", "POST", "owner", { version: frozen.version })));
  });
  test("two workers deliver one personalized local message with the verified From", async () => {
    const { target, campaign } = await ready(); await schedule(campaign); const job = await jobFor(campaign.id);
    expect(decrypt(job.payloadCipher)).toMatchObject({ campaignId: campaign.id, deliveryId: job.campaignDeliveryId, attempt: 1, transport: "local" });
    await Promise.all([mailer.runOneJob("campaign-a"), mailer.runOneJob("campaign-b")]); expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("done");
    const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); expect(mail.to).toBe(target.contact); expect(mail.from).toEqual({ name: sender.label, address: sender.address }); expect(mail.subject).toBe("합성 수신자 님 소식"); expect(mail.text).toContain(target.contact);
    expect((await deliveries(campaign.id)).items[0].status).toBe("local_delivered"); expect((await read(campaign.id)).status).toBe("completed");
    const delivery = (await deliveries(campaign.id)).items[0];
    expect(await db.auditEvent.count({ where: { resourceId: delivery.id, requestId: job.id, action: "campaign.delivery_local_delivered" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { resourceId: campaign.id, action: "campaign.settled", actorId: null } })).toBe(1);
    const current = await read(campaign.id); await ok(await POST(req("/campaigns/" + campaign.id + "/archive", "POST", "owner", { version: current.version })));
    expect((await read(campaign.id)).archivedAt).not.toBeNull();
  });
  test("campaign receipt audit failure rolls back delivery, job and attempt and recovers the actual local receipt", async () => {
    const { campaign } = await ready(); await schedule(campaign);
    const queued = await jobFor(campaign.id), job = await mailer.claimJob("audit-receipt", { tenantId: tenant, jobId: queued.id });
    expect(job).toBeDefined();
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qa_campaign_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='campaign.delivery_local_delivered' THEN RAISE EXCEPTION 'synthetic receipt audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER qa_campaign_receipt_fault BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_campaign_receipt_fault()');
    try {
      await expect(runCampaignJob(job!, "audit-receipt")).rejects.toThrow();
      expect(await db.job.findUnique({ where: { id: job!.id } })).toMatchObject({ status: "leased" });
      expect(await db.jobAttempt.findUnique({ where: { id: job!.attemptId } })).toMatchObject({ outcome: "leased" });
      expect(await db.campaignDelivery.findUnique({ where: { id: job!.campaignDeliveryId! } })).toMatchObject({ status: "sending" });
      expect(await db.auditEvent.count({ where: { requestId: job!.id, action: "campaign.delivery_local_delivered" } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_campaign_receipt_fault ON "AuditEvent"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_campaign_receipt_fault()');
    }
    await runCampaignJob(job!, "audit-receipt");
    expect(await db.job.findUnique({ where: { id: job!.id } })).toMatchObject({ status: "done" });
    expect(await db.jobAttempt.findUnique({ where: { id: job!.attemptId } })).toMatchObject({ outcome: "delivered" });
    expect(await db.auditEvent.count({ where: { requestId: job!.id, action: "campaign.delivery_local_delivered" } })).toBe(1);
  });
  test("schedule bounds and unavailable SMS transport are explicit", async () => {
    const { campaign } = await ready();
    for (const at of [new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 31 * 86400000).toISOString()]) expect((await POST(req("/campaigns/" + campaign.id + "/schedule", "POST", "owner", { version: campaign.version, at }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    const sms = await create({ channel: "sms", senderId: null, content: { format: "text", subject: "문자", text: "내용" } });
    const preview = await ok<CampaignPreview>(await POST(req("/campaigns/" + sms.id + "/preview", "POST", "owner", { version: sms.version }))); expect(preview.transportReady).toBe(false); expect(preview.estimate.amount).toBeNull();
    expect((await POST(req("/campaigns/" + sms.id + "/schedule", "POST", "owner", { version: sms.version, at: null }, { "idempotency-key": randomUUID() }))).status).toBe(503);
  });
  test("rescheduling moves the job and cancellation persists without creating a mail file", async () => {
    const { campaign } = await ready(); let c = await schedule(campaign, { at: new Date(Date.now() + 3600000).toISOString() });
    const at = new Date(Date.now() + 7200000).toISOString(); await ok(await POST(req("/campaigns/" + c.id + "/reschedule", "POST", "owner", { version: c.version, at })));
    const job = await jobFor(c.id); expect(job.dueAt.toISOString()).toBe(at); c = await read(c.id);
    await ok(await POST(req("/campaigns/" + c.id + "/cancel", "POST", "owner", { version: c.version })));
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled"); expect((await deliveries(c.id)).items[0].status).toBe("cancelled");
    await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
  });
  test("withdrawal committed before dispatch blocks the recorded consent", async () => {
    const { target, campaign } = await ready(); await schedule(campaign);
    await ok(await marketingPost(req("/marketing/preferences/withdrawals", "POST", "owner", { serviceId: service, items: [{ id: target.pref.id, version: target.pref.version }] })));
    const job = await jobFor(campaign.id); expect((await drain(job.id)).status).toBe("cancelled");
    expect((await deliveries(campaign.id)).items[0].reason).toBe("CONSENT_CHANGED"); await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
  });
  test("mixed outcomes settle the campaign as partial_failed with per-recipient truth", async () => {
    const first = await recipient(), second = await recipient();
    const campaign = await targets(await create(), [first.contact, second.contact]); await schedule(campaign);
    await ok(await marketingPost(req("/marketing/preferences/withdrawals", "POST", "owner", { serviceId: service, items: [{ id: second.pref.id, version: second.pref.version }] })));
    const jobs = await db.job.findMany({ where: { campaignDelivery: { campaignId: campaign.id } } }); expect(jobs.length).toBe(2);
    for (const job of jobs) await drain(job.id);
    const rows = (await deliveries(campaign.id)).items.sort((a, b) => a.status.localeCompare(b.status));
    expect(rows.map(row => row.status).sort()).toEqual(["cancelled", "local_delivered"]);
    expect(rows.find(row => row.status === "cancelled")?.reason).toBe("CONSENT_CHANGED");
    const final = await read(campaign.id); expect(final.status).toBe("partial_failed");
  });
  test("re-including a contact cannot silently replace the scheduled consent version", async () => {
    const { target, campaign } = await ready(); await schedule(campaign);
    await ok(await marketingPatch(req("/marketing/preferences/" + target.pref.id, "PATCH", "owner", { version: 1, excluded: true })));
    await ok(await marketingPatch(req("/marketing/preferences/" + target.pref.id, "PATCH", "owner", { version: 2, excluded: false })));
    const job = await jobFor(campaign.id); await drain(job.id); expect((await deliveries(campaign.id)).items[0].reason).toBe("CONSENT_CHANGED");
  });
  test("the actual requester, rather than the draft creator, must retain their service grant", async () => {
    const { campaign } = await ready(); await schedule(campaign, {}, "sender");
    await db.serviceGrant.updateMany({ where: { memberId: members.sender }, data: { capabilities: ["service.read"] } });
    try { const job = await jobFor(campaign.id); await drain(job.id); expect((await deliveries(campaign.id)).items[0].reason).toBe("PERMISSION_REVOKED"); }
    finally { await db.serviceGrant.updateMany({ where: { memberId: members.sender }, data: { capabilities: [...roleCapabilities("sender")] } }); }
  });
  test("a disabled sender cannot send an already requested campaign", async () => {
    const ownSender = await verifiedSender(), { campaign } = await ready({ senderId: ownSender.id }); await schedule(campaign);
    await ok(await senderPost(req("/senders/" + ownSender.id + "/disable", "POST", "owner", { version: ownSender.version })));
    const job = await jobFor(campaign.id); await drain(job.id); expect((await deliveries(campaign.id)).items[0].reason).toBe("SENDER_UNAVAILABLE");
  });
  test("privacy erasure removes draft contacts, requested contacts and actual local mail bytes", async () => {
    const { target, campaign } = await ready(), draft = await targets(await create(), [target.contact]); await schedule(campaign); const job = await jobFor(campaign.id); await drain(job.id);
    await ok(await marketingDelete(req("/marketing/preferences/" + target.pref.id, "DELETE", "owner", { serviceId: service, version: target.pref.version })));
    for (const id of [campaign.id, draft.id]) { const rows = await deliveries(id); expect(rows.items[0].contact).toBeNull(); expect(rows.items[0].erasedAt).not.toBeNull(); }
    await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
    expect(decrypt((await db.job.findUniqueOrThrow({ where: { id: job.id } })).payloadCipher)).toEqual({ erased: true });
    expect((await GET(req("/campaigns/" + campaign.id + "/export"))).status).toBe(200);
    const csv = await (await GET(req("/campaigns/" + campaign.id + "/export"))).text(); expect(csv).not.toContain(target.contact);
  });
  test("retention cleanup includes unscheduled contact copies and campaign expiry", async () => {
    const { target, campaign } = await ready(), unknown = await targets(await create({ content: { format: "text", subject: "합성", text: "개인 보관 내용" } }), ["unknown@expiry.local.test"]);
    const ctx = await requireContext(req("/").headers); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 31 * 86400000);
    await cleanupMarketingJobs(); expect((await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: campaign.id } })).contactCipher).toBeNull();
    await cleanupCampaigns(); expect((await db.campaign.findUniqueOrThrow({ where: { id: unknown.id } })).contentCipher).toBeNull();
    expect((await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: unknown.id } })).contactCipher).toBeNull();
    await expect(readCampaign(ctx, campaign.id, randomUUID())).rejects.toMatchObject({ status: 401 });
    vi.useRealTimers();
    expect((await readCampaign(ctx, campaign.id, randomUUID())).status).toBe("expired"); void target;
  });
  test("a known local storage failure can be retried without editing the original request", async () => {
    const { campaign } = await ready(); await schedule(campaign); const job = await jobFor(campaign.id);
    await db.job.update({ where: { id: job.id }, data: { maxAttempts: 1 } }); env.LOCAL_MAIL_DIR = "/dev/null/campaign-mail";
    await drain(job.id); env.LOCAL_MAIL_DIR = original.dir; let c = await read(campaign.id); expect(c.status).toBe("failed");
    const row = (await deliveries(c.id)).items[0]; expect(row.status).toBe("failed");
    await ok(await POST(req("/campaigns/" + c.id + "/retry", "POST", "owner", { version: c.version, ids: [row.id] }, { "idempotency-key": randomUUID() })), 202);
    await cleanupCampaigns(); expect((await deliveries(c.id)).items[0].status).toBe("queued");
    const retried = await jobFor(c.id); expect(retried.id).not.toBe(job.id); await drain(retried.id); c = await read(c.id); expect(c.status).toBe("completed");
    expect((await deliveries(c.id)).items[0].attempt).toBe(2);
  });
  test("an interrupted local write recovers its existing receipt without changing file bytes", async () => {
    const { campaign, target } = await ready(); await schedule(campaign); const job = await mailer.claimJob("interrupted");
    expect(job!.campaignDeliveryId).toBe((await jobFor(campaign.id)).campaignDeliveryId);
    await db.campaignDelivery.update({ where: { id: job!.campaignDeliveryId! }, data: { status: "sending" } });
    await mailer.deliverMail(job!, { to: target.contact, subject: "합성", text: "중단 전 로컬 전달" }, { name: sender.label, address: sender.address! });
    const file = resolve(env.LOCAL_MAIL_DIR, job!.id + ".json"), before = await readFile(file), mtime = (await stat(file)).mtimeMs;
    await db.job.update({ where: { id: job!.id }, data: { leaseUntil: new Date(Date.now() - 1000) } }); await drain(job!.id);
    expect(await readFile(file)).toEqual(before); expect((await stat(file)).mtimeMs).toBe(mtime); expect((await deliveries(campaign.id)).items[0].status).toBe("local_delivered");
  });
  test("uncertain SMTP responses are never automatically resent or user-retried", async () => {
    env.MAIL_TRANSPORT = "smtp"; env.SMTP_HOST = "synthetic.local.test";
    // Contract-only provider simulation; no real domain, mailbox or external connection is used.
    env.SENDER_DNS_SERVER = undefined;
    vi.spyOn(Resolver.prototype, "resolveTxt").mockImplementation(async name => [[records.get(name) ?? ""]]);
    const send = vi.fn(async (mail: { to: string }) => ({ accepted: [mail.to] }));
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail: send } as never);
    const external = await verifiedSender(), { campaign } = await ready({ senderId: external.id }); await schedule(campaign);
    send.mockRejectedValueOnce(new Error("synthetic socket failure with private content"));
    const job = await jobFor(campaign.id); await drain(job.id); expect((await deliveries(campaign.id)).items[0]).toMatchObject({ status: "unknown", reason: "DELIVERY_UNCERTAIN" });
    const calls = send.mock.calls.length; await mailer.runOneJob("later"); expect(send.mock.calls.length).toBe(calls);
    const c = await read(campaign.id), row = (await deliveries(c.id)).items[0];
    expect((await POST(req("/campaigns/" + c.id + "/retry", "POST", "owner", { version: c.version, ids: [row.id] }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).lastError).toBe("DELIVERY_UNCERTAIN");
  });
  test("cancellation during one real delivery keeps its receipt and prevents the next send", async () => {
    const a = await recipient(), b = await recipient(); const c = await schedule(await targets(await create(), [a.contact, b.contact]));
    const originalDeliver = mailer.deliverMail;
    let started!: () => void, resume!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
    vi.spyOn(mailer, "deliverMail").mockImplementationOnce(async (...args) => { started(); await gate; return originalDeliver(...args); });
    const sending = mailer.runOneJob("concurrent-delivery"); await entered;
    const inProgress = await read(c.id); let cancelled = false;
    const stopping = POST(req("/campaigns/" + c.id + "/cancel", "POST", "owner", { version: inProgress.version })).then(response => { cancelled = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 80)); expect(cancelled).toBe(false); resume(); await sending;
    const result = await ok<{ accepted: number; cancelled: number }>(await stopping); expect(result).toMatchObject({ accepted: 1, cancelled: 1 });
    const rows = (await deliveries(c.id)).items; expect(rows.map(r => r.status).sort()).toEqual(["cancelled", "local_delivered"]);
    const cancelledJob = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: c.id, status: "cancelled" } } });
    await expect(access(resolve(env.LOCAL_MAIL_DIR, cancelledJob.id + ".json"))).rejects.toThrow();
  });
  test("approved source destruction certifies the removal of every campaign contact copy", async () => {
    const { target, campaign } = await ready(); const draft = await targets(await create(), [target.contact]);
    await schedule(campaign); const sent = await jobFor(campaign.id); await drain(sent.id);
    const pending = await schedule(await targets(await create(), [target.contact]), { at: new Date(Date.now() + 3600000).toISOString() });
    const request = await ok<{ destructionId: string }>(await subAction(req("/submissions/" + target.sub.id + "/destruction-request", "POST", "owner", { version: 1, reason: "합성 캠페인 파기" })));
    const destruction = await db.destructionRequest.findUniqueOrThrow({ where: { id: request.destructionId } });
    await ok(await destructionAction(req("/destruction-requests/" + destruction.id + "/approve", "POST", "owner", { version: destruction.version, reason: "확인" })));
    expect(await runOneDestruction("campaign-destruction")).toBe(true);
    const certificate = await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: target.sub.id } }); expect(certificate.digest).toBe(certificateDigest(certificate)); expect(certificate.counts).toMatchObject({ campaignRecipients: 3, marketingJobs: 2 });
    for (const id of [campaign.id, draft.id, pending.id]) expect((await deliveries(id)).items[0]).toMatchObject({ contact: null });
    await expect(access(resolve(env.LOCAL_MAIL_DIR, sent.id + ".json"))).rejects.toThrow(); await cleanupCampaigns(); expect((await read(pending.id)).status).toBe("failed");
  });
  test("expiry cannot recopy an erased source and CSV formulas remain inert", async () => {
    const target = await recipient("=SUM(1,2)"), c = await targets(await create(), [target.contact]);
    const exported = await (await GET(req("/campaigns/" + c.id + "/export"))).text(); expect(exported).toContain("\"'=SUM(1,2)\"");
    await ok(await marketingDelete(req("/marketing/preferences/" + target.pref.id, "DELETE", "owner", { serviceId: service, version: 1 })));
    const fresh = await targets(await create(), [target.contact]); const row = (await deliveries(fresh.id)).items[0]; expect(row.contact).toBeNull(); expect(row.erasedAt).not.toBeNull();
    const before = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: fresh.id } });
    await expect(db.campaignDelivery.update({ where: { id: before.id }, data: { contactCipher: "fake", erasedAt: null } })).rejects.toThrow();
  });
  test("database rejects missing events, cross-service copies, mutable receipts and duplicate attempts", async () => {
    const { campaign } = await ready(); await expect(db.campaign.update({ where: { id: campaign.id }, data: { title: "no event", version: { increment: 1 } } })).rejects.toThrow();
    const target = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: campaign.id } });
    await expect(db.campaignDelivery.update({ where: { id: target.id }, data: { serviceId: second } })).rejects.toThrow();
    await schedule(campaign); const job = await jobFor(campaign.id);
    await expect(db.job.create({ data: { tenantId: job.tenantId, type: job.type, campaignDeliveryId: job.campaignDeliveryId, senderId: job.senderId, marketingPreferenceId: job.marketingPreferenceId, marketingSubmissionId: job.marketingSubmissionId, payloadCipher: job.payloadCipher, dedupeKey: randomUUID() } })).rejects.toThrow();
    await drain(job.id); await expect(db.campaignDelivery.update({ where: { id: target.id }, data: { status: "queued", attempt: { increment: 1 } } })).rejects.toThrow();
    await expect(db.job.update({ where: { id: job.id }, data: { type: "mail" } })).rejects.toThrow();
  });
  test("cancelling an interrupted sending attempt preserves uncertainty instead of claiming it was unsent", async () => {
    const { campaign } = await ready(); let c = await schedule(campaign); const job = await mailer.claimJob("interrupted-cancel");
    expect(job!.campaignDeliveryId).toBe((await jobFor(c.id)).campaignDeliveryId);
    await db.campaignDelivery.update({ where: { id: job!.campaignDeliveryId! }, data: { status: "sending" } });
    c = await read(c.id); const result = await ok<{ unknown: number; cancelled: number }>(await POST(req("/campaigns/" + c.id + "/cancel", "POST", "owner", { version: c.version })));
    expect(result).toMatchObject({ unknown: 1, cancelled: 0 }); expect((await deliveries(c.id)).items[0].status).toBe("unknown");
    expect((await db.job.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("dead");
  });
  test("a last-attempt worker exit is reconciled using its actual local receipt", async () => {
    const { campaign, target } = await ready(); await schedule(campaign); const job = await mailer.claimJob("last-attempt");
    await db.campaignDelivery.update({ where: { id: job!.campaignDeliveryId! }, data: { status: "sending" } });
    await mailer.deliverMail(job!, { to: target.contact, subject: "합성", text: "마지막 시도" });
    await db.job.update({ where: { id: job!.id }, data: { leaseUntil: new Date(Date.now() - 1000), maxAttempts: 1 } });
    await mailer.runOneJob("reconciler"); await cleanupCampaigns();
    expect((await db.job.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("done"); expect((await read(campaign.id)).status).toBe("completed");
  });
  test("1000 targets remain fully pageable and maximum-sized scheduling is atomic", async () => {
    const target = await recipient(), contacts = [target.contact, ...Array.from({ length: 999 }, (_, i) => "unknown-" + i + "@scale.local.test")];
    const c = await targets(await create(), contacts);
    const last = await ok<Paged<DeliveryRecord>>(await GET(req("/campaigns/" + c.id + "/deliveries?page=10&pageSize=100"))); expect(last.total).toBe(1000); expect(last.items).toHaveLength(100); expect(last.items[99].position).toBe(1000);
    expect((await POST(req("/campaigns/" + c.id + "/recipients", "POST", "owner", { version: c.version, mode: "direct", contacts: [...contacts, "one-too-many@example.com"] }))).status).toBe(422);
    const scheduled = await schedule(c, { excludeInvalid: true, at: new Date(Date.now() + 3600000).toISOString() });
    expect(scheduled.counts).toMatchObject({ queued: 1, excluded: 999 }); expect(await db.job.count({ where: { campaignDelivery: { campaignId: c.id } } })).toBe(1);
    await ok(await POST(req("/campaigns/" + c.id + "/cancel", "POST", "owner", { version: scheduled.version })));
  });
  test("SMS form selection uses real same-service consent but cannot fabricate provider delivery or pricing", async () => {
    const target = await recipient("문자 합성", "sms"), c = await create({ channel: "sms", source: "form", senderId: null });
    await ok(await POST(req("/campaigns/" + c.id + "/recipients", "POST", "owner", { version: c.version, mode: "selection", preferenceIds: [target.pref.id] })));
    const current = await read(c.id), preview = await ok<CampaignPreview>(await POST(req("/campaigns/" + c.id + "/preview", "POST", "owner", { version: current.version })));
    expect(preview).toMatchObject({ eligible: 1, excluded: 0, transportReady: false, estimate: { amount: null } }); expect(preview.sample!.text).toContain(target.contact.startsWith("+82") ? target.contact : "+82" + target.contact.slice(1));
    expect((await POST(req("/campaigns/" + c.id + "/schedule", "POST", "owner", { version: current.version, at: null }, { "idempotency-key": randomUUID() }))).status).toBe(503);
    expect(await db.job.count({ where: { campaignDelivery: { campaignId: c.id } } })).toBe(0);
  });
});

const templateRead = (id: string) => templateGet(req("/message-templates/" + id)).then(r => ok<MessageTemplateRecord>(r));
async function templateCreate(extra: object = {}, who = "owner") {
  const out = await ok<{ id: string }>(await templatePost(req("/message-templates", "POST", who, { serviceId: service, channel: "email", name: "템플릿 " + randomUUID(), content, ...extra }, { "idempotency-key": randomUUID() })), 201); return templateRead(out.id);
}
describe("message templates and HTML delivery", () => {
  test("template CRUD preserves immutable revisions, version conflicts, archive and complete erasure", async () => {
    const input = { serviceId: service, channel: "email", name: "이메일 재사용 검증", content }, key = randomUUID();
    const first = await ok<{ id: string }>(await templatePost(req("/message-templates", "POST", "owner", input, { "idempotency-key": key })), 201);
    expect(await ok(await templatePost(req("/message-templates", "POST", "owner", input, { "idempotency-key": key })), 201)).toMatchObject(first);
    expect((await templatePost(req("/message-templates", "POST", "owner", { ...input, name: "다른 이름" }, { "idempotency-key": key }))).status).toBe(409);
    let t = await templateRead(first.id); expect(t.content).toEqual(content);
    await ok(await templatePatch(req("/message-templates/" + t.id, "PATCH", "owner", { version: t.version, name: "변경한 템플릿", content: { ...content, text: "새 본문" } })));
    expect((await templatePatch(req("/message-templates/" + t.id, "PATCH", "owner", { version: t.version, name: "충돌", content }))).status).toBe(409);
    expect(await ok(await templateGet(req("/message-templates/" + t.id + "/revisions/1")))).toMatchObject({ name: input.name, content });
    await expect(db.messageTemplateRevision.update({ where: { templateId_version: { templateId: t.id, version: 1 } }, data: { name: "tamper" } })).rejects.toThrow();
    t = await templateRead(t.id); await ok(await templatePost(req("/message-templates/" + t.id + "/archive", "POST", "owner", { version: t.version })));
    t = await templateRead(t.id); expect(t.status).toBe("archived");
    expect((await templatePatch(req("/message-templates/" + t.id, "PATCH", "owner", { version: t.version, name: "불가", content }))).status).toBe(409);
    await ok(await templatePost(req("/message-templates/" + t.id + "/restore", "POST", "owner", { version: t.version }))); t = await templateRead(t.id);
    expect(t.revisions?.map(r => r.kind)).toEqual(["restored", "archived", "updated", "created"]);
    await ok(await templateDelete(req("/message-templates/" + t.id, "DELETE", "owner", { version: t.version })));
    expect(await templateRead(t.id)).toMatchObject({ status: "deleted", name: "", content: null });
    expect(await db.messageTemplateRevision.count({ where: { templateId: t.id, OR: [{ contentCipher: { not: null } }, { name: { not: "" } }] } })).toBe(0);
    expect((await templateGet(req("/message-templates/" + t.id + "/revisions/1"))).status).toBe(410);
    expect((await templatePost(req("/message-templates/" + t.id + "/restore", "POST", "owner", { version: t.version + 1 }))).status).toBe(410);
  });
  test("current role, grant, tenant, service, channel and request origin protect templates and preview", async () => {
    const t = await templateCreate();
    expect((await templateGet(req("/message-templates/" + t.id, "GET", "anonymous"))).status).toBe(401);
    expect((await templateGet(req("/message-templates/" + t.id, "GET", "viewer"))).status).toBe(403);
    expect((await templateGet(req("/message-templates/" + t.id, "GET", "foreign"))).status).toBe(404);
    expect((await templateGet(req("/message-templates?serviceId=" + second + "&channel=email", "GET", "sender"))).status).toBe(403);
    const c = await create(), wrong = await templateCreate({ serviceId: second });
    expect((await POST(req("/campaigns/" + c.id + "/apply-template", "POST", "owner", { version: c.version, templateId: wrong.id, templateVersion: wrong.version }))).status).toBe(404);
    expect((await templatePatch(req("/message-templates/" + t.id, "PATCH", "owner", { version: t.version, name: "변경", content }, { origin: "https://invalid.test" }))).status).toBe(403);
    const payload = { serviceId: service, channel: "email", content };
    await db.serviceGrant.updateMany({ where: { memberId: members.sender }, data: { capabilities: ["service.read"] } });
    try { expect((await templateGet(req("/message-templates/" + t.id, "GET", "sender"))).status).toBe(403); expect((await contentPreview(req("/message-content/preview", "POST", "sender", payload))).status).toBe(403); }
    finally { await db.serviceGrant.updateMany({ where: { memberId: members.sender }, data: { capabilities: [...roleCapabilities("sender")] } }); }
    expect((await templatePost(req("/message-templates", "POST", "owner", { ...payload, name: "invalid", status: "active" }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  });
  test("server search and pagination return every template once without exposing content in lists", async () => {
    const prefix = "페이지 검증 " + randomUUID();
    const ids = []; for (let i = 0; i < 4; i++) ids.push((await templateCreate({ name: prefix + " " + i })).id);
    const found: string[] = [];
    for (let page = 1; page <= 2; page++) {
      const list = await ok<Paged<MessageTemplateRecord>>(await templateGet(req("/message-templates?" + new URLSearchParams({ serviceId: service, channel: "email", search: prefix, page: String(page), pageSize: "2" }))));
      expect(list.total).toBe(4); expect(list.items.every(r => r.content === null)).toBe(true); found.push(...list.items.map(r => r.id));
    }
    expect(found.sort()).toEqual(ids.sort());
  });
  test("template application copies an exact version; later edits and deletion cannot change scheduled mail", async () => {
    const target = await recipient(); const t = await templateCreate({ content: { format: "html", subject: "원본 제목", text: "원본 {{name}}", html: "<p>원본 <strong>{{name}}</strong></p>" } });
    let c = await targets(await create(), [target.contact]);
    expect((await POST(req("/campaigns/" + c.id + "/apply-template", "POST", "owner", { version: c.version, templateId: t.id, templateVersion: t.version + 1 }))).status).toBe(409);
    await ok(await POST(req("/campaigns/" + c.id + "/apply-template", "POST", "owner", { version: c.version, templateId: t.id, templateVersion: t.version }))); c = await read(c.id);
    expect(c).toMatchObject({ messageTemplateId: t.id, messageTemplateVersion: 1, content: t.content }); c = await schedule(c);
    await ok(await templatePatch(req("/message-templates/" + t.id, "PATCH", "owner", { version: t.version, name: "변경", content: { ...content, text: "나중 내용" } })));
    await ok(await templateDelete(req("/message-templates/" + t.id, "DELETE", "owner", { version: t.version + 1 })));
    expect((await read(c.id)).content).toEqual(t.content);
    expect((await POST(req("/campaigns/" + c.id + "/apply-template", "POST", "owner", { version: c.version, templateId: (await templateCreate()).id, templateVersion: 1 }))).status).toBe(409);
    const job = await jobFor(c.id); expect(job.type).toBe("mail.campaign.v3"); await drain(job.id);
    const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); expect(mail.subject).toBe("원본 제목"); expect(mail.html).toContain("<strong>"); expect(mail.html).not.toContain("{{name}}"); expect(mail.text).toContain("원본");
    await expect(db.job.update({ where: { id: job.id }, data: { type: "mail.campaign.v1" } })).rejects.toThrow();
  });
  test("HTML sanitizer, escaped recipient values and plaintext fallback match actual delivered bytes", async () => {
    const person = '<b>합성</b> & "수신자"', target = await recipient(person);
    const dirty = { format: "html", subject: "HTML 안내", text: "{{name}} 님 {{contact}}", html: '<p onclick="alert(1)">{{name}} 님 <strong>{{contact}}</strong></p><img src="https://track.example/pixel"><script>alert(1)</script>' };
    const preview = await ok<{ sanitized: boolean; content: object }>(await contentPreview(req("/message-content/preview", "POST", "owner", { serviceId: service, channel: "email", content: dirty })));
    expect(preview.sanitized).toBe(true);
    let c = await targets(await create({ content: dirty }), [target.contact]); expect(c.content).toEqual(preview.content);
    const sample = await ok<CampaignPreview>(await POST(req("/campaigns/" + c.id + "/preview", "POST", "owner", { version: c.version })));
    expect(sample.sample?.html).toContain("&lt;b&gt;합성&lt;/b&gt; &amp; &quot;수신자&quot;");
    c = await schedule(c); const job = await jobFor(c.id); await drain(job.id);
    const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); expect(mail.html).toBe(withEmailPolicy(job.id, sample.sample!).html); expect(mail.text).toBe(withEmailPolicy(job.id, sample.sample!).text); expect(mail.html).not.toMatch(/<(script|img)/);
    const audits = await db.auditEvent.findMany({ where: { resourceId: c.id } }); expect(JSON.stringify(audits)).not.toContain(person);
  });
  test("SMS and template state rules reject unsupported HTML and archived application", async () => {
    const html = { format: "html", subject: "안내", text: "대체", html: "<p>내용</p>" };
    expect((await templatePost(req("/message-templates", "POST", "owner", { serviceId: service, channel: "sms", name: "불가", content: html }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await POST(req("/campaigns", "POST", "owner", { serviceId: service, channel: "sms", source: "direct", title: "불가", senderId: null, content: html }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    const c = await create(), t = await templateCreate(); await ok(await templatePost(req("/message-templates/" + t.id + "/archive", "POST", "owner", { version: t.version })));
    expect((await POST(req("/campaigns/" + c.id + "/apply-template", "POST", "owner", { version: c.version, templateId: t.id, templateVersion: t.version + 1 }))).status).toBe(409);
    const sms = await templateCreate({ channel: "sms" }); expect((await POST(req("/campaigns/" + c.id + "/apply-template", "POST", "owner", { version: c.version, templateId: sms.id, templateVersion: sms.version }))).status).toBe(404);
  });
  test("database guards reject missing snapshots, nullable bindings and protocol downgrade", async () => {
    const t = await templateCreate(), c = await create();
    await expect(db.messageTemplate.update({ where: { id: t.id }, data: { version: { increment: 1 }, name: "no snapshot" } })).rejects.toThrow();
    await expect(db.messageTemplate.delete({ where: { id: t.id } })).rejects.toThrow();
    await expect(db.messageTemplateRevision.deleteMany({ where: { templateId: t.id } })).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "Campaign" SET "messageTemplateId"=${t.id},version=version+1 WHERE id=${c.id}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "Campaign" SET "mailProtocol"='mail.campaign.v1',version=version+1 WHERE id=${c.id}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "MessageTemplate" SET "contentHash"=NULL,version=version+1 WHERE id=${t.id}`).rejects.toThrow();
  });
});

const attachmentBytes = Buffer.from("합성 이메일 첨부 검증 자료\n원문 바이트 보존\n", "utf8");
async function initAttachment(c: CampaignRecord, bytes = attachmentBytes, extra: object = {}, who = "owner") {
  return ok<FileInfo>(await POST(req("/campaigns/" + c.id + "/files", "POST", who, { version: c.version, name: "합성-안내.txt", mime: "text/plain", size: bytes.length, sha256: sha256(bytes), ...extra }, { "idempotency-key": randomUUID() })), 201);
}
function attachmentRequest(id: string, bytes: Buffer, who = "owner") {
  return new Request(origin + "/api/v1/uploads/" + id + "/content", { method: "PUT", headers: { origin, cookie: cookies[who], "Content-Type": "text/plain" }, body: new Uint8Array(bytes) });
}
async function attachFile(c: CampaignRecord, bytes = attachmentBytes) {
  const file = await initAttachment(c, bytes);
  await ok(await uploadPut(attachmentRequest(file.id, bytes)));
  await ok(await uploadPost(req("/uploads/" + file.id + "/complete", "POST")));
  await ok(await POST(req("/campaigns/" + c.id + "/files/" + file.id + "/attach", "POST", "owner", { version: c.version })));
  return { file: (await read(c.id)).files.find(f => f.id === file.id)!, c: await read(c.id) };
}
describe("campaign attachment lifecycle", () => {
  test("real scanner, private download and actual local mail retain exact bytes and frozen metadata", async () => {
    const target = await recipient(); const attachment = await attachFile(await targets(await create(), [target.contact]));
    let c = attachment.c; const f = attachment.file;
    const stored = await db.fileObject.findUniqueOrThrow({ where: { id: f.id } }); expect(stored).toMatchObject({ status: "attached", scanStatus: "clean", ownerKind: "campaign", campaignId: c.id }); expect(stored.scanEngine).toMatch(/^ClamAV /);
    expect(await privateFiles.read(stored.storageKey)).toEqual(attachmentBytes);
    const response = await GET(req("/campaigns/" + c.id + "/files/" + f.id + "/download")); expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(attachmentBytes);
    expect((await fileGet(req("/files/" + f.id + "/download"))).status).toBe(404);
    expect((await GET(req("/campaigns/" + c.id + "/files/" + f.id + "/download", "GET", "foreign"))).status).toBe(404);
    c = await schedule(c); expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).attachmentSnapshot).toEqual([{ id: f.id, sha256: stored.sha256, size: stored.size, mime: stored.mime }]);
    expect((await DELETE(req("/campaigns/" + c.id + "/files/" + f.id, "DELETE", "owner", { version: c.version }))).status).toBe(409);
    await expect(db.fileObject.update({ where: { id: f.id }, data: { status: "deleting", version: { increment: 1 } } })).rejects.toThrow();
    await expect(db.fileObject.delete({ where: { id: f.id } })).rejects.toThrow();
    const job = await jobFor(c.id); await drain(job.id);
    const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); expect(mail.attachments[0]).toMatchObject({ filename: "합성-안내.txt", size: attachmentBytes.length, mime: "text/plain", sha256: sha256(attachmentBytes) }); expect(Buffer.from(mail.attachments[0].contentBase64, "base64")).toEqual(attachmentBytes);
    await ok(await marketingDelete(req("/marketing/preferences/" + target.pref.id, "DELETE", "owner", { serviceId: service, version: target.pref.version })));
    await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
    expect(await privateFiles.read(stored.storageKey)).toEqual(attachmentBytes); // Campaign-owned original has its own 30-day lifetime.
  });
  test("unfinished or mismatched files block preview and scheduling, and upload owners are enforced", async () => {
    const target = await recipient(), c = await targets(await create(), [target.contact]), file = await initAttachment(c);
    expect((await uploadPut(attachmentRequest(file.id, attachmentBytes, "sender"))).status).toBe(404);
    expect((await uploadPut(attachmentRequest(file.id, Buffer.from("wrong")))).status).toBe(422);
    const preview = await ok<CampaignPreview>(await POST(req("/campaigns/" + c.id + "/preview", "POST", "owner", { version: c.version }))); expect(preview.attachmentsReady).toBe(false);
    expect((await POST(req("/campaigns/" + c.id + "/schedule", "POST", "owner", { version: c.version, at: null }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    expect(await db.job.count({ where: { campaignDelivery: { campaignId: c.id } } })).toBe(0);
    await ok(await DELETE(req("/campaigns/" + c.id + "/files/" + file.id, "DELETE", "owner", { version: c.version })));
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("deleted");
  });
  test("actual EICAR rejection and unavailable scanner never create sendable attachments", async () => {
    const c = await create(), virus = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"), file = await initAttachment(c, virus);
    await ok(await uploadPut(attachmentRequest(file.id, virus))); expect((await uploadPost(req("/uploads/" + file.id + "/complete", "POST"))).status).toBe(422);
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("rejected");
    expect((await POST(req("/campaigns/" + c.id + "/files/" + file.id + "/attach", "POST", "owner", { version: c.version }))).status).toBe(409);
    const socket = env.CLAMAV_SOCKET; env.CLAMAV_SOCKET = "/tmp/catchsecu-missing-scanner-" + randomUUID();
    try { expect((await POST(req("/campaigns/" + c.id + "/files", "POST", "owner", { version: c.version, name: "safe.txt", mime: "text/plain", size: attachmentBytes.length, sha256: sha256(attachmentBytes) }, { "idempotency-key": randomUUID() }))).status).toBe(503); } finally { env.CLAMAV_SOCKET = socket; }
  });
  test("parallel reservations enforce five files, twenty MB, service scope and SMS restrictions", async () => {
    const c = await create(); for (let i = 0; i < 4; i++) await initAttachment(c, attachmentBytes, { name: "file-" + i + ".txt" });
    const input = { version: c.version, name: "race.txt", mime: "text/plain", size: attachmentBytes.length, sha256: sha256(attachmentBytes) };
    const results = await Promise.all([1, 2].map(() => POST(req("/campaigns/" + c.id + "/files", "POST", "owner", input, { "idempotency-key": randomUUID() })))); expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const large = await create(); for (let i = 0; i < 2; i++) await initAttachment(large, attachmentBytes, { size: 10485760 });
    expect((await POST(req("/campaigns/" + large.id + "/files", "POST", "owner", { ...input, version: large.version }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    const sms = await create({ channel: "sms", senderId: null }); expect((await POST(req("/campaigns/" + sms.id + "/files", "POST", "owner", { ...input, version: sms.version }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    const foreignFile = await initAttachment(await create({ serviceId: second, senderId: null }));
    expect((await POST(req("/campaigns/" + c.id + "/files/" + foreignFile.id + "/attach", "POST", "owner", { version: c.version }))).status).toBe(404);
  });
  test("storage deletion failure blocks downloads and is retried; draft deletion removes the remaining originals", async () => {
    let { file, c } = await attachFile(await create()); const stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    const remove = vi.spyOn(privateFiles, "remove").mockRejectedValueOnce(new Error("synthetic deletion error"));
    const result = await ok<{ cleanupPending: boolean }>(await DELETE(req("/campaigns/" + c.id + "/files/" + file.id, "DELETE", "owner", { version: c.version }))); expect(result.cleanupPending).toBe(true); remove.mockRestore();
    expect((await GET(req("/campaigns/" + c.id + "/files/" + file.id + "/download"))).status).toBe(409);
    await cleanupExpiredFiles(); await expect(privateFiles.read(stored.storageKey)).rejects.toThrow();
    c = await read(c.id); ({ file, c } = await attachFile(c)); const replacement = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    await ok(await DELETE(req("/campaigns/" + c.id, "DELETE", "owner", { version: c.version }))); expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("deleted"); await expect(privateFiles.read(replacement.storageKey)).rejects.toThrow();
  });
  test("tampered stored bytes are rejected before any provider I/O", async () => {
    const target = await recipient(); const attachment = await attachFile(await targets(await create(), [target.contact])); const file = attachment.file; const c = await schedule(attachment.c);
    const stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } }); await privateFiles.write(stored.storageKey, Buffer.from("changed bytes"));
    const job = await jobFor(c.id); await drain(job.id); expect((await deliveries(c.id)).items[0]).toMatchObject({ status: "failed", reason: "ATTACHMENT_UNAVAILABLE" }); await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
  });
  test("actual elapsed campaign expiry deletes encrypted attachment bytes", async () => {
    vi.useRealTimers();
    const seed = await create(), seedRow = await db.campaign.findUniqueOrThrow({ where: { id: seed.id } }), id = randomUUID(), expiresAt = new Date(Date.now() + 4500);
    await db.$transaction(async tx => { await tx.campaign.create({ data: { id, tenantId: tenant, serviceId: service, creatorId: seedRow.creatorId, channel: "email", source: "direct", title: "짧은 보관 시험", contentCipher: encrypt(content), senderId: sender.id, createdAt: new Date(Date.now() - 86400000), expiresAt } }); await tx.campaignEvent.create({ data: { tenantId: tenant, campaignId: id, version: 1, kind: "created" } }); });
    const { file } = await attachFile(await read(id)), stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 150)));
    const observed = new Date(); expect(observed.getTime(), JSON.stringify({ observed, expiresAt })).toBeGreaterThan(expiresAt.getTime());
    await cleanupCampaigns(); expect((await read(id)).status).toBe("expired"); expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("deleted"); await expect(privateFiles.read(stored.storageKey)).rejects.toThrow();
  });
});
test("SMTP adapter receives sanitized HTML and attachment buffers with path and URL access disabled", async () => {
  env.MAIL_TRANSPORT = "smtp"; env.SMTP_HOST = "synthetic.local.test"; env.SENDER_DNS_SERVER = undefined;
  vi.spyOn(Resolver.prototype, "resolveTxt").mockImplementation(async name => [[records.get(name) ?? ""]]);
  const send = vi.fn(async (mail: { to: string; html?: string; attachments?: { content: Buffer; filename: string }[]; disableFileAccess?: boolean; disableUrlAccess?: boolean }) => ({ accepted: [mail.to] }));
  vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail: send } as never);
  const external = await verifiedSender(), target = await recipient();
  const { c } = await attachFile(await targets(await create({ senderId: external.id, content: { format: "html", subject: "SMTP 첨부 계약", text: "첨부 안내", html: "<p>첨부 안내</p>" } }), [target.contact]));
  await schedule(c); const job = await jobFor(c.id); await drain(job.id);
  const mail = send.mock.calls.at(-1)![0]; expect(mail).toMatchObject({ html: withEmailPolicy(job.id, { text: "첨부 안내", html: "<p>첨부 안내</p>" }).html, disableFileAccess: true, disableUrlAccess: true }); expect(mail.attachments?.[0].content).toEqual(attachmentBytes); expect(mail.attachments?.[0]).not.toHaveProperty("path"); expect(mail.attachments?.[0]).not.toHaveProperty("href");
  expect((await deliveries(c.id)).items[0].status).toBe("accepted");
});
const feedbackTestKey = "Synthetic-email-feedback-secret-not-for-production-2026";
function relayRequest(input: unknown, extra: Record<string, string> = {}, rawOverride?: string) {
  env.EMAIL_FEEDBACK_SECRET = feedbackTestKey;
  const raw = rawOverride ?? JSON.stringify(input), timestamp = String(Math.floor(Date.now() / 1000));
  const signature = "v1=" + createHmac("sha256", feedbackTestKey).update(timestamp + "." + raw).digest("hex");
  return new Request(origin + "/api/v1/email-feedback", { method: "POST", headers: { "content-type": "application/json", "x-email-timestamp": timestamp, "x-email-signature": signature, ...extra }, body: raw });
}
const relayInput = (jobId: string, type = "hard_bounce", occurredAt = new Date().toISOString()) => ({ eventId: randomUUID(), jobId, type, occurredAt });
const unsubscribeRequest = (token: string, method = "GET", input?: unknown) => new Request(origin + "/api/v1/email-unsubscribe/" + token, { method,
  ...(input === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }) });
async function sentFor(target?: Awaited<ReturnType<typeof recipient>>) {
  target ??= await recipient(); const campaign = await schedule(await targets(await create(), [target.contact])), job = await jobFor(campaign.id); await drain(job.id);
  return { target, campaign, job: await db.job.findUniqueOrThrow({ where: { id: job.id } }) };
}
test("unsubscribe credentials bind the job and one-click advertisement requires HTTPS and DKIM configuration", async () => {
  const id = randomUUID(), token = unsubscribeToken(id); expect(unsubscribeJobId(token)).toBe(id);
  expect(() => unsubscribeJobId(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"))).toThrow(); expect(() => unsubscribeJobId(randomUUID() + token.slice(36))).toThrow();
  let policy = withEmailPolicy(id, { text: "안내", html: "<p>안내</p>" }); expect(policy.text).toContain("/email/unsubscribe/" + token); expect(policy.headers).not.toHaveProperty("List-Unsubscribe-Post");
  env.SMTP_LIST_UNSUBSCRIBE_DKIM_SIGNED = "true"; policy = withEmailPolicy(id, { text: "안내", html: "<p>안내</p>" }); expect(policy.headers).not.toHaveProperty("List-Unsubscribe-Post");
  env.BETTER_AUTH_URL = "https://email.example.com"; policy = withEmailPolicy(id, { text: "안내", html: "<p>안내</p>" }); expect(policy.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click"); expect(policy.html).toContain("https://email.example.com/email/unsubscribe/");
});
test("real local mail includes a bound unsubscribe link; GET is read-only and repeated anonymous POST is idempotent", async () => {
  const { job, target } = await sentFor(), token = unsubscribeToken(job.id), scope = { tenantId: tenant, serviceId: service, contactHash: target.pref.contactHash };
  const before = await ok<MarketingSummary>(await marketingGet(req("/marketing/summary?serviceId=" + service)));
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); expect(mail.headers["List-Unsubscribe"]).toContain(token); expect(mail.text).toContain(token);
  expect(await ok(await unsubscribeGet(unsubscribeRequest(token)))).toMatchObject({ unsubscribed: false }); expect(await db.emailSuppression.count({ where: scope })).toBe(0);
  for (let i = 0; i < 2; i++) expect(await ok(await unsubscribePost(unsubscribeRequest(token, "POST", { confirm: true })))).toEqual({ unsubscribed: true });
  expect(await db.emailFeedback.count({ where: { jobId: job.id } })).toBe(1); expect(await db.emailSuppression.count({ where: scope })).toBe(1);
  expect(await ok(await unsubscribeGet(unsubscribeRequest(token)))).toMatchObject({ unsubscribed: true });
  const after = await ok<MarketingSummary>(await marketingGet(req("/marketing/summary?serviceId=" + service)));
  expect(after.items[0].suppressed).toBe(before.items[0].suppressed + 1);
  expect(after.items[0].eligible).toBe(before.items[0].eligible - 1);
  const event = await db.emailFeedback.findFirstOrThrow({ where: { jobId: job.id } }); expect(await db.auditEvent.count({ where: { resourceId: event.id } })).toBe(1);
});
test("forged, expired, unconfirmed and oversized unsubscribe requests cannot mutate data", async () => {
  const { job } = await sentFor(), token = unsubscribeToken(job.id), forged = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  expect((await unsubscribePost(unsubscribeRequest(forged, "POST", { confirm: true }))).status).toBe(404);
  expect((await unsubscribePost(unsubscribeRequest(token, "POST", { confirm: false }))).status).toBe(422);
  expect((await unsubscribePost(unsubscribeRequest(token, "POST", { confirm: true, contact: "attacker@example.com" }))).status).toBe(422);
  expect((await unsubscribePost(unsubscribeRequest(token, "POST", { data: "x".repeat(4097) }))).status).toBe(413);
  await db.job.update({ where: { id: job.id }, data: { createdAt: new Date(Date.now() - 90 * 86400000 - 1000) } });
  expect((await unsubscribeGet(unsubscribeRequest(token))).status).toBe(410); expect((await unsubscribePost(unsubscribeRequest(token, "POST", { confirm: true }))).status).toBe(410);
  expect(await db.emailFeedback.count({ where: { jobId: job.id } })).toBe(0);
});
test("RFC form posts work without cookies or Origin, and duplicate multipart posts keep one receipt", async () => {
  const { job } = await sentFor(), token = unsubscribeToken(job.id), url = origin + "/api/v1/email-unsubscribe/" + token;
  await ok(await unsubscribePost(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" })));
  const form = new FormData(); form.set("List-Unsubscribe", "One-Click"); await ok(await unsubscribePost(new Request(url, { method: "POST", body: form })));
  expect((await unsubscribePost(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click&List-Unsubscribe=One-Click" }))).status).toBe(422);
  expect(await db.emailFeedback.count({ where: { jobId: job.id } })).toBe(1);
});
test("unsubscribe blocks new business mail, draft preview and a previously queued campaign at its final delivery check", async () => {
  const { job, target } = await sentFor(); const queued = await schedule(await targets(await create(), [target.contact])), queuedJob = await jobFor(queued.id);
  await ok(await unsubscribePost(unsubscribeRequest(unsubscribeToken(job.id), "POST", { confirm: true })));
  await drain(queuedJob.id); expect((await deliveries(queued.id)).items[0]).toMatchObject({ status: "cancelled", reason: "EMAIL_SUPPRESSED" }); await expect(access(resolve(env.LOCAL_MAIL_DIR, queuedJob.id + ".json"))).rejects.toThrow();
  const draft = await targets(await create(), [target.contact]), preview = await ok<CampaignPreview>(await POST(req("/campaigns/" + draft.id + "/preview", "POST", "owner", { version: draft.version })));
  expect(preview.eligible).toBe(0); expect(preview.items[0].reason).toBe("EMAIL_SUPPRESSED");
  expect((await POST(req("/campaigns/" + draft.id + "/schedule", "POST", "owner", { version: draft.version, at: null }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  const message = { to: target.contact, subject: "차단 시험", text: "보내지 않음" }, scope = { tenantId: tenant, serviceId: service };
  expect((await mailer.enqueueServiceMail(message, scope)).suppressed).toBe(true); expect((await mailer.enqueueMarketingMail(message, scope)).suppressed).toBe(true);
  expect((await mailer.enqueueServiceMail(message, { ...scope, serviceId: second })).suppressed).toBe(false);
});
test("relay authentication rejects missing configuration, forged signatures, replay windows and oversized or malformed bodies", async () => {
  const input = relayInput(randomUUID()), missing = relayRequest(input); env.EMAIL_FEEDBACK_SECRET = undefined; expect((await feedbackPost(missing)).status).toBe(503);
  expect((await feedbackPost(relayRequest(input, { "x-email-signature": "v1=" + "0".repeat(64) }))).status).toBe(401);
  for (const seconds of [-301, 301]) expect((await feedbackPost(relayRequest(input, { "x-email-timestamp": String(Math.floor(Date.now() / 1000) + seconds) }))).status).toBe(401);
  expect((await feedbackPost(relayRequest(input, {}, "x".repeat(16385)))).status).toBe(413);
  expect((await feedbackPost(relayRequest(input, {}, "invalid json"))).status).toBe(400);
  expect((await feedbackPost(relayRequest({ ...input, tenantId: foreign }))).status).toBe(422);
  expect((await feedbackPost(relayRequest(input, { "content-type": "text/plain" }))).status).toBe(415);
});
test("signed relay receipts derive recipient scope from the sent job and preserve original acceptance and private audit fields", async () => {
  const { job, campaign, target } = await sentFor(), input = relayInput(job.id);
  expect(await ok(await feedbackPost(relayRequest(input)), 202)).toMatchObject({ duplicate: false });
  expect(await ok(await feedbackPost(relayRequest(input)), 202)).toMatchObject({ duplicate: true });
  const event = await db.emailFeedback.findFirstOrThrow({ where: { jobId: job.id } }); expect(event).toMatchObject({ tenantId: tenant, serviceId: service, contactHash: target.pref.contactHash, kind: "hard_bounce" });
  const row = (await deliveries(campaign.id)).items[0]; expect(row.status).toBe("local_delivered"); expect(row.feedback).toMatchObject({ outcome: "hard_bounce", source: "relay", count: 1 });
  const audit = await db.auditEvent.findMany({ where: { resourceId: event.id } }); expect(JSON.stringify([event, audit])).not.toContain(target.contact); expect(JSON.stringify(audit)).not.toContain(feedbackTestKey);
  expect(await db.emailSuppression.count({ where: { contactHash: target.pref.contactHash, reason: "hard_bounce" } })).toBe(1);
});
test("simultaneous duplicate events produce one effect and event ID reuse with another body conflicts", async () => {
  const { job } = await sentFor(), input = relayInput(job.id, "complaint");
  const responses = await Promise.all(Array.from({ length: 3 }, () => feedbackPost(relayRequest(input)))); expect(responses.map(r => r.status)).toEqual([202, 202, 202]);
  expect(await db.emailFeedback.count({ where: { eventKey: "relay:" + input.eventId } })).toBe(1);
  expect((await feedbackPost(relayRequest({ ...input, type: "delivered" }))).status).toBe(409);
  const next = await sentFor(); expect((await feedbackPost(relayRequest({ ...input, jobId: next.job.id }))).status).toBe(409);
});
test("out-of-order delivery reports never override complaint or remove a permanent block", async () => {
  const { job, campaign, target } = await sentFor();
  for (const kind of ["complaint", "hard_bounce", "delivered", "soft_bounce"]) await ok(await feedbackPost(relayRequest(relayInput(job.id, kind))), 202);
  expect((await deliveries(campaign.id)).items[0].feedback).toMatchObject({ outcome: "complaint", count: 4 });
  expect(await db.emailSuppression.count({ where: { contactHash: target.pref.contactHash } })).toBe(2);
});
test("soft bounce threshold counts distinct sent jobs, not repeated events for one job", async () => {
  const first = await sentFor(), secondMail = await sentFor(first.target), third = await sentFor(first.target), scope = { tenantId: tenant, serviceId: service, contactHash: first.target.pref.contactHash };
  for (let i = 0; i < 3; i++) await ok(await feedbackPost(relayRequest(relayInput(first.job.id, "soft_bounce"))), 202);
  expect(await db.emailSuppression.count({ where: scope })).toBe(0);
  await ok(await feedbackPost(relayRequest(relayInput(secondMail.job.id, "soft_bounce"))), 202); expect(await db.emailSuppression.count({ where: scope })).toBe(0);
  await ok(await feedbackPost(relayRequest(relayInput(third.job.id, "soft_bounce"))), 202); expect(await db.emailSuppression.count({ where: { ...scope, reason: "soft_bounce" } })).toBe(1);
});
test("soft bounce policy excludes events outside seven days and jobs subsequently confirmed delivered", async () => {
  const first = await sentFor(), mails = [first, await sentFor(first.target), await sentFor(first.target), await sentFor(first.target), await sentFor(first.target)];
  await db.job.update({ where: { id: first.job.id }, data: { createdAt: new Date(Date.now() - 8 * 86400000) } });
  await ok(await feedbackPost(relayRequest(relayInput(first.job.id, "soft_bounce", new Date(Date.now() - 7 * 86400000 - 1000).toISOString()))), 202);
  for (const i of [1, 2]) await ok(await feedbackPost(relayRequest(relayInput(mails[i].job.id, "soft_bounce"))), 202);
  const where = { contactHash: first.target.pref.contactHash }; expect(await db.emailSuppression.count({ where })).toBe(0);
  await ok(await feedbackPost(relayRequest(relayInput(mails[1].job.id, "delivered"))), 202);
  await ok(await feedbackPost(relayRequest(relayInput(mails[3].job.id, "soft_bounce"))), 202); expect(await db.emailSuppression.count({ where })).toBe(0);
  await db.job.update({ where: { id: mails[4].job.id }, data: { createdAt: new Date(Date.now() - 8 * 86400000) } });
  await ok(await feedbackPost(relayRequest(relayInput(mails[4].job.id, "soft_bounce", new Date(Date.now() - 7 * 86400000 + 30000).toISOString()))), 202); expect(await db.emailSuppression.count({ where })).toBe(1);
});
test("unknown, unsent, impossibly dated jobs are rejected and raw SQL cannot forge scope or mutate feedback", async () => {
  const { campaign } = await ready(), queued = await schedule(campaign), job = await jobFor(queued.id);
  expect((await feedbackPost(relayRequest(relayInput(job.id)))).status).toBe(409); expect((await feedbackPost(relayRequest(relayInput(randomUUID())))).status).toBe(404);
  await drain(job.id);
  for (const stamp of [Date.now() + 301000, job.createdAt.getTime() - 301000]) expect((await feedbackPost(relayRequest(relayInput(job.id, "hard_bounce", new Date(stamp).toISOString())))).status).toBe(422);
  await ok(await feedbackPost(relayRequest(relayInput(job.id))), 202);
  const record = await db.emailFeedback.findFirstOrThrow({ where: { jobId: job.id } });
  await expect(db.emailFeedback.create({ data: { ...record, id: randomUUID(), eventKey: "relay:" + randomUUID(), serviceId: other } })).rejects.toThrow();
  await expect(db.emailFeedback.update({ where: { id: record.id }, data: { kind: "delivered" } })).rejects.toThrow();
  await expect(db.emailFeedback.delete({ where: { id: record.id } })).rejects.toThrow();
  const block = await db.emailSuppression.findFirstOrThrow({ where: { sourceEventId: record.id } });
  await expect(db.emailSuppression.update({ where: { id: block.id }, data: { reason: "soft_bounce" } })).rejects.toThrow();
  await expect(db.emailSuppression.delete({ where: { id: block.id } })).rejects.toThrow();
  await expect(db.emailSuppression.create({ data: { ...block, id: randomUUID(), reason: "complaint" } })).rejects.toThrow();
});
test("suppression lists enforce tenant, service, role, exact address search and server pagination", async () => {
  const { job, target } = await sentFor(); await ok(await feedbackPost(relayRequest(relayInput(job.id))), 202);
  const path = "/email-suppressions?" + new URLSearchParams({ serviceId: service, search: target.contact, pageSize: "1" });
  const one = await ok<{ total: number; items: { contact: string }[] }>(await suppressionGet(req(path))); expect(one.total).toBe(1); expect(one.items[0].contact).toBe(target.contact);
  const two = await ok<{ total: number; page: number; items: { contact: string }[] }>(await suppressionGet(req(path + "&page=2")));
  expect(two).toMatchObject({ total: 1, page: 1 }); expect(two.items.map(row => row.contact)).toEqual([target.contact]);
  expect((await suppressionGet(req(path, "GET", "viewer"))).status).toBe(403); expect([403, 404]).toContain((await suppressionGet(req(path, "GET", "foreign"))).status);
  await ok(await suppressionGet(req(path, "GET", "sender")));
  await db.serviceGrant.deleteMany({ where: { memberId: members.sender, serviceId: service } }); expect((await suppressionGet(req(path, "GET", "sender"))).status).toBe(403);
  await db.serviceGrant.create({ data: { tenantId: tenant, memberId: members.sender, serviceId: service, capabilities: [...roleCapabilities("sender")] } });
});
test("erasing consent removes mail and contact copies while retaining minimum suppression and valid unsubscribe capability", async () => {
  const { job, target } = await sentFor(); await ok(await feedbackPost(relayRequest(relayInput(job.id))), 202);
  await ok(await marketingDelete(req("/marketing/preferences/" + target.pref.id, "DELETE", "owner", { serviceId: service, version: target.pref.version })));
  await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
  await ok(await unsubscribePost(unsubscribeRequest(unsubscribeToken(job.id), "POST", { confirm: true })));
  const result = await ok<{ items: { contact: string | null }[] }>(await suppressionGet(req("/email-suppressions?" + new URLSearchParams({ serviceId: service, search: target.contact }))));
  expect(result.items).toHaveLength(2); expect(result.items.every(r => r.contact === null)).toBe(true);
  expect((await db.campaignDelivery.findUniqueOrThrow({ where: { id: job.campaignDeliveryId! } })).contactCipher).toBeNull();
});
test("the exact advertised one-click URL redirects only GET and accepts receiver POST without redirects", async () => {
  const { job } = await sentFor(); env.BETTER_AUTH_URL = origin.replace(/^http:/, "https:"); env.SMTP_LIST_UNSUBSCRIBE_DKIM_SIGNED = "true";
  const policy = withEmailPolicy(job.id, { text: "한 번에 수신거부" }), advertised = policy.headers["List-Unsubscribe"].slice(1, -1);
  expect(new URL(advertised).pathname).toBe("/api/v1/email-unsubscribe/" + unsubscribeToken(job.id));
  const landing = await unsubscribeGet(new Request(advertised)); expect(landing.status).toBe(302); expect(landing.headers.get("location")).toContain("/email/unsubscribe/");
  expect(await db.emailFeedback.count({ where: { jobId: job.id } })).toBe(0);
  const confirmed = await unsubscribePost(new Request(advertised, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  expect(confirmed.status).toBe(200); expect(confirmed.headers.get("location")).toBeNull(); expect(await confirmed.json()).toEqual({ unsubscribed: true });
});
