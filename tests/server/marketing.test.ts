import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import type { Role } from "@/generated/prisma/client";
import { decrypt } from "@/server/crypto";
import { cleanupMarketingJobs } from "@/server/marketing-jobs";
import { marketingContactHash, withMarketingDelivery } from "@/server/marketing";
import { enqueueMarketingMail, enqueueMail, enqueueServiceMail, runOneJob } from "@/server/jobs";
import { runOneDestruction } from "@/server/destruction-worker";
import type { FormRecord, FormContent, Paged } from "@/contracts/forms";
import type { MarketingRecord, MarketingSource, MarketingSummary } from "@/contracts/marketing";
import { GET, POST, PATCH, DELETE } from "@/app/api/v1/marketing/[...segments]/route";
import { POST as templateCreate } from "@/app/api/v1/templates/route";
import { POST as templateUse } from "@/app/api/v1/templates/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as formAction, PATCH as formEdit } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as subAction, PATCH as subEdit } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as destructionAction } from "@/app/api/v1/destruction-requests/[...segments]/route";
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), other = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? who, ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> {
  expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json();
}
async function signup(name: string, tenantId: string, role: Role) {
  await db.rateLimit.deleteMany(); const email = name + "@marketing.local.test", password = "Marketing-test-password!123";
  await ok(await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password })));
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } }); members[name] = member.id;
  for (const serviceId of tenantId === tenant ? (role === "owner" ? [service, second] : [service]) : [other]) await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "SubjectAccessRequest" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: "마케팅 QA", policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [other, foreign]]) await db.service.create({ data: { id, tenantId, name: id, externalName: "수신동의 서비스" } });
  for (const [name, role] of [["owner", "owner"], ["privacy", "privacy"], ["sender", "sender"], ["viewer", "viewer"]] as [string, Role][]) await signup(name, tenant, role);
  await signup("foreign", foreign, "owner");
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });
async function fixture(configured = true, serviceId = service, who = "owner") {
  const name = randomUUID(), email = randomUUID(), phone = randomUUID(), note = randomUUID();
  const content: FormContent = { body: "합성 검증", consentPurpose: "서비스 신청", consentRequired: true, retentionDays: 30, maxResponses: 100,
    questions: [{ id: name, label: "이름", type: "단문형 답변", required: true, subjectRole: "name" }, { id: email, label: "이메일", type: "단문형 답변", required: true, subjectRole: "email" }, { id: phone, label: "연락처", type: "단문형 답변", required: false }, { id: note, label: "기타", type: "단문형 답변", required: false }],
    ...(configured ? { marketing: { purpose: "소식과 행사 안내", nameQuestionId: name, emailQuestionId: email, smsQuestionId: phone } } : {}) };
  const form = await ok<FormRecord>(await formCreate(req("/forms", "POST", who, { serviceId, title: "마케팅 " + randomUUID(), content }, { "idempotency-key": randomUUID() })), 201);
  const pub = await ok<{ token: string }>(await formAction(req(`/forms/${form.id}/publish`, "POST", who, { version: form.version }, { "idempotency-key": randomUUID() })), 201);
  return { form, token: pub.token, name, email, phone, note, serviceId, who, contact: { name: "합성 " + randomUUID(), email: randomUUID() + "@marketing.local.test", phone: "+8210" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function submit(f: Fixture, channels: ("email" | "sms")[] = ["email", "sms"], contact = f.contact) {
  return ok<{ id: string }>(await publicPost(req(`/public/forms/${f.token}/submissions`, "POST", "anonymous", { answers: { [f.name]: contact.name, [f.email]: contact.email, [f.phone]: contact.phone, [f.note]: "기타 답변" }, consent: true, marketingChannels: channels }, { "idempotency-key": randomUUID() })), 201);
}
const list = (extra: Record<string, string> = {}, who = "owner") => GET(req("/marketing/preferences?" + new URLSearchParams({ serviceId: service, ...extra }), "GET", who));
const record = (id: string, who = "owner") => GET(req("/marketing/preferences/" + id, "GET", who));
async function stored(submissionId: string, channel = "email") { return db.marketingPreference.findFirstOrThrow({ where: { sourceSubmissionId: submissionId, channel } }); }
const withdraw = (rows: { id: string; version: number }[], serviceId = service, who = "owner") => POST(req("/marketing/preferences/withdrawals", "POST", who, { serviceId, items: rows.map(r => ({ id: r.id, version: r.version })) }));
async function drain(id: string) {
  for (let i = 0; i < 100; i++) { const job = await db.job.findUniqueOrThrow({ where: { id } }); if (["done", "cancelled", "dead"].includes(job.status)) return job; await runOneJob("marketing-tests"); }
  throw new Error("job did not finish");
}
const mail = (f: Fixture) => ({ to: f.contact.email, subject: "합성 마케팅 발송", text: "선택 동의한 소식" });
const scope = (f: Fixture, channel: "email" | "sms" = "email") => ({ tenantId: f.who === "foreign" ? foreign : tenant, serviceId: f.serviceId, channel, contact: channel === "email" ? f.contact.email : f.contact.phone });
const manual = (f: Fixture, subId: string) => ({ serviceId: f.serviceId, submissionId: subId, channel: "email", nameQuestionId: f.name, contactQuestionId: f.email, grantedAt: new Date(Date.now() - 1000).toISOString(), purpose: "별도 마케팅 목적", reference: "합성 수신동의 기록 01", attested: true });
describe("marketing preferences, lifecycle and dispatch with real PostgreSQL", () => {
  test("only a separate selected channel creates consent; general consent and old boolean never grant", async () => {
    const f = await fixture(); const no = await submit(f, []); expect(await db.marketingPreference.count({ where: { sourceSubmissionId: no.id } })).toBe(0);
    const one = await submit(f, ["email"]); expect((await stored(one.id)).channel).toBe("email"); expect(await db.marketingPreference.count({ where: { sourceSubmissionId: one.id } })).toBe(1);
    const g = await fixture(false);
    expect((await publicPost(req(`/public/forms/${g.token}/submissions`, "POST", "anonymous", { answers: { [g.name]: g.contact.name, [g.email]: g.contact.email }, consent: true, marketingConsent: true }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    expect((await publicPost(req(`/public/forms/${g.token}/submissions`, "POST", "anonymous", { answers: { [g.name]: g.contact.name, [g.email]: g.contact.email }, consent: true, marketingChannels: ["email"] }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  });
  test("invalid contact or configured question is rejected atomically and published config cannot change", async () => {
    const f = await fixture();
    const bad = await publicPost(req(`/public/forms/${f.token}/submissions`, "POST", "anonymous", { answers: { [f.name]: f.contact.name, [f.email]: f.contact.email, [f.phone]: "not-phone" }, consent: true, marketingChannels: ["email", "sms"] }, { "idempotency-key": randomUUID() })); expect(bad.status).toBe(422);
    expect(await db.submission.count({ where: { formVersion: { formId: f.form.id } } })).toBe(0);
    const published = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "published" } });
    await expect(db.formVersion.update({ where: { id: published.id }, data: { marketing: {} } })).rejects.toThrow();
    expect((await formEdit(req(`/forms/${f.form.id}`, "PATCH", "owner", { version: f.form.version + 1, content: { ...f.form.content, marketing: { purpose: "목적", nameQuestionId: f.name, emailQuestionId: f.name } } }))).status).toBe(422);
  });
  test("one contact has independent channels, services and companies with no unauthorized reads", async () => {
    const f = await fixture(), g = await fixture(true, second), h = await fixture(true, other, "foreign");
    const a = await submit(f); const b = await submit(g, ["email"], f.contact); const c = await submit(h, ["email"], f.contact);
    expect(new Set([(await stored(a.id)).id, (await stored(b.id)).id, (await stored(c.id)).id]).size).toBe(3);
    const result = await ok<Paged<MarketingRecord>>(await list({ search: f.contact.email })); expect(result.total).toBe(1); expect(result.items[0].sourceSubmissionId).toBe(a.id);
    expect((await record((await stored(c.id)).id)).status).toBe(404); expect((await list({ serviceId: other })).status).toBe(404);
    expect((await list({ serviceId: second }, "privacy")).status).toBe(403); expect((await list({}, "viewer")).status).toBe(403);
    expect((await record((await stored(a.id)).id, "sender")).status).toBe(200); expect((await withdraw([await stored(a.id)], service, "sender")).status).toBe(403);
  });
  test("current grants and role are rechecked, sources require access to response data", async () => {
    const f = await fixture(); const sub = await submit(f), p = await stored(sub.id);
    const source = await ok<Paged<MarketingSource>>(await GET(req("/marketing/sources?" + new URLSearchParams({ serviceId: service, search: f.form.title }), "GET", "privacy"))); expect(source.items[0].id).toBe(sub.id);
    expect((await GET(req("/marketing/sources?serviceId=" + service, "GET", "sender"))).status).toBe(403);
    await db.serviceGrant.updateMany({ where: { memberId: members.privacy }, data: { capabilities: ["service.read"] } });
    try { expect((await record(p.id, "privacy")).status).toBe(403); expect((await withdraw([p], service, "privacy")).status).toBe(403); } finally { await db.serviceGrant.updateMany({ where: { memberId: members.privacy }, data: { capabilities: [...roleCapabilities("privacy")] } }); }
  });
  test("manual evidence registration is idempotent; guessed fields, future dates and missing evidence fail", async () => {
    const f = await fixture(false), sub = await submit(f, []), input = manual(f, sub.id), key = randomUUID();
    for (const patch of [{ attested: false }, { reference: "" }, { grantedAt: new Date(Date.now() + 100000).toISOString() }, { contactQuestionId: randomUUID() }, { serviceId: second }]) {
      const res = await POST(req("/marketing/preferences", "POST", "privacy", { ...input, ...patch }, { "idempotency-key": randomUUID() })); expect(res.status).toBeGreaterThanOrEqual(400);
    }
    const a = await ok<{ id: string; version: number }>(await POST(req("/marketing/preferences", "POST", "privacy", input, { "idempotency-key": key })), 201);
    expect(await ok(await POST(req("/marketing/preferences", "POST", "privacy", input, { "idempotency-key": key })), 201)).toEqual(a);
    expect(await db.marketingEvent.count({ where: { preferenceId: a.id } })).toBe(1);
    const row = await stored(sub.id); expect(row.contactCipher).not.toContain(f.contact.email); expect(row.evidenceCipher).not.toContain(input.reference);
    expect((await ok<MarketingRecord>(await record(row.id))).evidence).toMatchObject({ reference: input.reference, purpose: input.purpose });
    expect((await POST(req("/marketing/preferences", "POST", "privacy", { ...input, purpose: "다른 근거" }, { "idempotency-key": key }))).status).toBe(409);
  });
  test("search is normalized exact match, pages are disjoint and CSV neutralizes formulas", async () => {
    const f = await fixture(); f.contact.name = "=HYPERLINK(합성)"; const sub = await submit(f);
    const one = await ok<Paged<MarketingRecord>>(await list({ search: f.contact.name, pageSize: "1" })), two = await ok<Paged<MarketingRecord>>(await list({ search: f.contact.name, pageSize: "1", page: "2" }));
    expect(one.total).toBe(2); expect(one.items[0].id).not.toBe(two.items[0].id);
    expect((await ok<Paged<MarketingRecord>>(await list({ search: f.contact.email.toUpperCase() }))).total).toBe(1);
    expect((await ok<Paged<MarketingRecord>>(await list({ search: f.contact.email.slice(0, 8) }))).total).toBe(0);
    const csv = await GET(req("/marketing/preferences/export?" + new URLSearchParams({ serviceId: service, search: f.contact.name, channel: "email" })));
    expect(csv.status).toBe(200); const text = await csv.text(); expect(text).toContain('"\'=HYPERLINK(합성)"'); expect(text).toContain(f.contact.email); expect(text).not.toContain(f.contact.phone); expect(text).not.toContain("contactHash");
    expect((await stored(sub.id)).nameHash).toHaveLength(64);
  });
  test("exclusion is channel-specific with optimistic versions and append-only history", async () => {
    const f = await fixture(), sub = await submit(f), p = await stored(sub.id);
    const excluded = await ok<MarketingRecord>(await PATCH(req("/marketing/preferences/" + p.id, "PATCH", "privacy", { version: p.version, excluded: true }))); expect(excluded.eligible).toBe(false);
    expect((await PATCH(req("/marketing/preferences/" + p.id, "PATCH", "privacy", { version: 1, excluded: false }))).status).toBe(409);
    expect(await withMarketingDelivery(scope(f, "sms"), async () => true)).toBe(true);
    const included = await ok<MarketingRecord>(await PATCH(req("/marketing/preferences/" + p.id, "PATCH", "privacy", { version: excluded.version, excluded: false }))); expect(included.eligible).toBe(true); expect(included.events?.map(e => e.kind)).toEqual(["included", "excluded", "granted"]);
    const evt = await db.marketingEvent.findFirstOrThrow({ where: { preferenceId: p.id } }); await expect(db.marketingEvent.delete({ where: { id: evt.id } })).rejects.toThrow();
  });
  test("bulk withdrawal is atomic, handles repeated requests and refuses stale reconsented rows", async () => {
    const f = await fixture(), sub = await submit(f), rows = await db.marketingPreference.findMany({ where: { sourceSubmissionId: sub.id } });
    const g = await fixture(true, second), foreignSub = await submit(g, ["email"]);
    expect((await withdraw([rows[0], await stored(foreignSub.id)])).status).toBe(404); expect((await stored(sub.id)).status).toBe("granted");
    const results = await Promise.all([withdraw(rows), withdraw(rows)]); for (const r of results) await ok(r);
    for (const row of rows) expect(await db.marketingEvent.count({ where: { preferenceId: row.id, kind: "withdrawn" } })).toBe(1);
    await submit(f, ["email"]); expect((await withdraw([rows.find(r => r.channel === "email")!])).status).toBe(409);
  });
  test("new consent needs a newer timestamp and cannot remove channel exclusion or subject suppression", async () => {
    const f = await fixture(), sub = await submit(f, ["email"]), p = await stored(sub.id);
    const excluded = await ok<MarketingRecord>(await PATCH(req("/marketing/preferences/" + p.id, "PATCH", "owner", { version: p.version, excluded: true })));
    await ok(await withdraw([excluded]));
    expect((await POST(req("/marketing/preferences", "POST", "owner", { ...manual(f, sub.id), grantedAt: p.grantedAt.toISOString() }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    const renewed = await submit(f, ["email"]), current = await stored(renewed.id); expect(current.id).toBe(p.id); expect(current.excluded).toBe(true);
    await ok(await PATCH(req("/marketing/preferences/" + p.id, "PATCH", "owner", { version: current.version, excluded: false })));
    await ok(await subAction(req(`/submissions/${renewed.id}/withdraw`, "POST", "owner", { version: 1, reason: "정보주체 철회" })));
    await submit(f, ["email"]); expect(await withMarketingDelivery(scope(f), async () => true)).toBeNull();
  });
  test("worker delivers only the consented current version and cancels queued mail after exclusion", async () => {
    const f = await fixture(); expect(await enqueueMarketingMail(mail(f), scope(f))).toEqual({ id: null, suppressed: true });
    const sub = await submit(f, ["email"]), p = await stored(sub.id);
    const first = await enqueueMarketingMail(mail(f), scope(f)); expect((await drain(first.id!)).status).toBe("done");
    const delivered = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, first.id + ".json"), "utf8")); expect(delivered.to).toBe(f.contact.email); expect(delivered).not.toHaveProperty("marketing");
    const queued = await enqueueMarketingMail(mail(f), scope(f));
    const changed = await ok<MarketingRecord>(await PATCH(req("/marketing/preferences/" + p.id, "PATCH", "owner", { version: p.version, excluded: true })));
    await ok(await PATCH(req("/marketing/preferences/" + p.id, "PATCH", "owner", { version: changed.version, excluded: false })));
    expect((await drain(queued.id!))).toMatchObject({ status: "cancelled", lastError: "SUPPRESSED" }); await expect(access(resolve(env.LOCAL_MAIL_DIR, queued.id + ".json"))).rejects.toThrow();
  });
  test("future marketing mail stays queued and a withdrawal before due time cancels delivery", async () => {
    const f = await fixture(), sub = await submit(f, ["email"]), p = await stored(sub.id);
    const queued = await enqueueMarketingMail(mail(f), scope(f), randomUUID(), new Date(Date.now() + 3600000));
    await runOneJob("marketing-tests"); expect((await db.job.findUniqueOrThrow({ where: { id: queued.id! } })).status).toBe("queued");
    await ok(await withdraw([p])); await db.job.update({ where: { id: queued.id! }, data: { dueAt: new Date() } });
    expect((await drain(queued.id!)).status).toBe("cancelled"); await expect(access(resolve(env.LOCAL_MAIL_DIR, queued.id + ".json"))).rejects.toThrow();
  });
  test("withdrawn marketing blocks business follow-up but authentication mail stays separate", async () => {
    const f = await fixture(), sub = await submit(f, ["email"]), p = await stored(sub.id), queued = await enqueueMarketingMail(mail(f), scope(f));
    await ok(await withdraw([p])); expect((await drain(queued.id!)).status).toBe("cancelled");
    expect(await enqueueServiceMail(mail(f), scope(f))).toEqual({ id: null, suppressed: true });
    const required = await enqueueMail({ ...mail(f), subject: "필수 인증 메일" }); expect((await drain(required.id)).status).toBe("done");
  });
  test("source withdrawal updates all its channels; changing a contact cannot transfer consent", async () => {
    const f = await fixture(), sub = await submit(f), p = await stored(sub.id), sms = await stored(sub.id, "sms");
    await ok(await subEdit(req(`/submissions/${sub.id}`, "PATCH", "owner", { version: 1, reason: "기타 정정", answers: { [f.note]: "새 기타 답변" } })));
    expect((await stored(sub.id)).status).toBe("granted");
    await ok(await subEdit(req(`/submissions/${sub.id}`, "PATCH", "owner", { version: 2, reason: "이메일 정정", answers: { [f.email]: "changed-" + f.contact.email } })));
    expect(await db.marketingPreference.findUnique({ where: { id: p.id } })).toMatchObject({ status: "erased", contactCipher: null, evidenceCipher: null, nameHash: null });
    expect((await stored(sub.id, "sms")).status).toBe("granted");
    await ok(await subAction(req(`/submissions/${sub.id}/withdraw`, "POST", "owner", { version: 3, reason: "원본 철회" })));
    expect(await db.marketingPreference.findUnique({ where: { id: sms.id } })).toMatchObject({ status: "withdrawn" });
    expect(await withMarketingDelivery({ ...scope(f), contact: "changed-" + f.contact.email }, async () => true)).toBeNull();
  });
  test("retention expiry and archived service deny delivery and never expose expired plaintext", async () => {
    const f = await fixture(), sub = await submit(f), p = await stored(sub.id), queued = await enqueueMarketingMail(mail(f), scope(f));
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    expect(await ok<MarketingRecord>(await record(p.id))).toMatchObject({ name: null, contact: null, evidence: null, eligible: false });
    expect((await drain(queued.id!)).status).toBe("cancelled");
    const g = await fixture(); await submit(g); await db.service.update({ where: { id: service }, data: { status: "archived" } });
    try { expect(await withMarketingDelivery(scope(g, "sms"), async () => true)).toBeNull(); } finally { await db.service.update({ where: { id: service }, data: { status: "active" } }); }
  });
  test("deletion erases contact and evidence but preserves denial, history and original response", async () => {
    const f = await fixture(), sub = await submit(f, ["email"]), p = await stored(sub.id), input = { serviceId: service, version: p.version };
    for (let i = 0; i < 2; i++) await ok(await DELETE(req("/marketing/preferences/" + p.id, "DELETE", "privacy", input)));
    const row = await stored(sub.id); expect(row).toMatchObject({ status: "erased", contactCipher: null, evidenceCipher: null, nameHash: null });
    expect(await db.marketingEvent.count({ where: { preferenceId: p.id, kind: "erased" } })).toBe(1);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("submitted");
    expect(await withMarketingDelivery(scope(f), async () => true)).toBeNull();
    await expect(db.marketingPreference.delete({ where: { id: p.id } })).rejects.toThrow();
  });
  test("approved destruction erases marketing data before issuing a certificate", async () => {
    const f = await fixture(), sub = await submit(f), p = await stored(sub.id);
    const sent = await enqueueMarketingMail(mail(f), scope(f)); expect((await drain(sent.id!)).status).toBe("done");
    const pending = await enqueueMarketingMail(mail(f), scope(f));
    const request = await ok<{ destructionId: string }>(await subAction(req(`/submissions/${sub.id}/destruction-request`, "POST", "owner", { version: 1, reason: "합성 응답 삭제" })));
    const job = await db.destructionRequest.findUniqueOrThrow({ where: { id: request.destructionId } });
    await ok(await destructionAction(req(`/destruction-requests/${job.id}/approve`, "POST", "owner", { version: job.version, reason: "확인" })));
    expect(await runOneDestruction("marketing-tests")).toBe(true);
    expect(await db.submission.findUnique({ where: { id: sub.id } })).toMatchObject({ status: "destroyed" });
    expect(await db.marketingPreference.findUnique({ where: { id: p.id } })).toMatchObject({ status: "erased", contactCipher: null, evidenceCipher: null });
    const certificate = await db.destructionCertificate.findFirstOrThrow({ where: { submissionId: sub.id } }); expect(certificate.counts).toMatchObject({ marketingPreferences: 2, marketingJobs: 2 });
    for (const job of [sent, pending]) { const erased = await db.job.findUniqueOrThrow({ where: { id: job.id! } }); expect(decrypt(erased.payloadCipher)).toEqual({ erased: true }); expect(erased.payloadErasedAt).not.toBeNull(); await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow(); }
  });
  test("manual deletion and contact correction erase pending and delivered local copies", async () => {
    const f = await fixture(), sub = await submit(f, ["email"]), p = await stored(sub.id);
    const sent = await enqueueMarketingMail(mail(f), scope(f)); await drain(sent.id!);
    await ok(await DELETE(req("/marketing/preferences/" + p.id, "DELETE", "owner", { serviceId: service, version: p.version })));
    expect(decrypt((await db.job.findUniqueOrThrow({ where: { id: sent.id! } })).payloadCipher)).toEqual({ erased: true });
    await expect(access(resolve(env.LOCAL_MAIL_DIR, sent.id + ".json"))).rejects.toThrow();
    const g = await fixture(), otherSub = await submit(g, ["email"]), queued = await enqueueMarketingMail(mail(g), scope(g));
    await ok(await subEdit(req(`/submissions/${otherSub.id}`, "PATCH", "owner", { version: 1, reason: "연락처 정정", answers: { [g.email]: "updated-" + g.contact.email } })));
    expect(await db.job.findUnique({ where: { id: queued.id! } })).toMatchObject({ status: "cancelled", lastError: "DATA_ERASED" });
    const h = await fixture(), expiring = await submit(h, ["email"]), expiringMail = await enqueueMarketingMail(mail(h), scope(h));
    await db.submission.update({ where: { id: expiring.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    await cleanupMarketingJobs(); expect((await db.job.findUniqueOrThrow({ where: { id: expiringMail.id! } })).payloadErasedAt).not.toBeNull();
  });
  test("pending destruction only suspends sending; cancellation preserves original consent", async () => {
    const f = await fixture(), sub = await submit(f, ["email"]), p = await stored(sub.id);
    const requested = await ok<{ destructionId: string }>(await subAction(req(`/submissions/${sub.id}/destruction-request`, "POST", "owner", { version: 1, reason: "취소 검증" })));
    expect((await stored(sub.id)).status).toBe("granted"); expect(await withMarketingDelivery(scope(f), async () => true)).toBeNull();
    const job = await db.destructionRequest.findUniqueOrThrow({ where: { id: requested.destructionId } });
    await ok(await destructionAction(req(`/destruction-requests/${job.id}/cancel`, "POST", "owner", { version: job.version, reason: "파기 요청 취소" })));
    expect((await stored(sub.id)).version).toBe(p.version); expect(await withMarketingDelivery(scope(f), async () => true)).toBe(true);
  });
  test("template instantiation maps all marketing contact fields to the new question IDs", async () => {
    const f = await fixture();
    const template = await ok<{ id: string; version: number }>(await templateCreate(req("/templates", "POST", "owner", { serviceId: service, title: "마케팅 템플릿", category: "마케팅", content: f.form.content }, { "idempotency-key": randomUUID() })), 201);
    const form = await ok<FormRecord>(await templateUse(req(`/templates/${template.id}/use`, "POST", "owner", { serviceId: service, version: template.version }, { "idempotency-key": randomUUID() })), 201);
    const m = form.content.marketing!; expect(m.nameQuestionId).not.toBe(f.name); expect(m.nameQuestionId).toBe(form.content.questions[0].id); expect(m.emailQuestionId).toBe(form.content.questions[1].id); expect(m.smsQuestionId).toBe(form.content.questions[2].id);
    await ok(await formAction(req(`/forms/${form.id}/publish`, "POST", "owner", { version: form.version }, { "idempotency-key": randomUUID() })), 201);
  });
  test("database rejects unrecorded changes, cross-service bindings and deleted evidence restoration", async () => {
    const f = await fixture(), sub = await submit(f), p = await stored(sub.id), g = await fixture(true, second), extra = await submit(g);
    await expect(db.marketingPreference.update({ where: { id: p.id }, data: { excluded: true, version: { increment: 1 } } })).rejects.toThrow();
    await expect(db.marketingPreference.update({ where: { id: p.id }, data: { sourceSubmissionId: extra.id, version: { increment: 1 } } })).rejects.toThrow();
    await expect(db.marketingPreference.update({ where: { id: p.id }, data: { contactCipher: null, version: { increment: 1 } } })).rejects.toThrow();
    expect((await record(p.id)).status).toBe(200);
  });
  test("a delivery lock serializes withdrawal; a committed withdrawal prevents the next callback", async () => {
    const f = await fixture(), sub = await submit(f, ["email"]), p = await stored(sub.id);
    let open!: () => void, ready!: () => void;
    const release = new Promise<void>(r => { open = r; }), started = new Promise<void>(r => { ready = r; });
    const sending = withMarketingDelivery(scope(f), async () => { ready(); await release; return "delivered"; }); await started;
    let finished = false; const stopping = withdraw([p]).then(r => { finished = true; return r; });
    try { await new Promise(r => setTimeout(r, 60)); expect(finished).toBe(false); } finally { open(); }
    expect(await sending).toBe("delivered"); await ok(await stopping); expect(await withMarketingDelivery(scope(f), async () => "unexpected")).toBeNull();
  });
  test("summary uses real service scoped state and audit trails contain no contacts or evidence text", async () => {
    const f = await fixture(), sub = await submit(f), p = await stored(sub.id); await ok(await withdraw([p]));
    const summary = await ok<MarketingSummary>(await GET(req("/marketing/summary", "GET", "privacy"))); expect(summary.items.map(s => s.id)).toEqual([service]);
    const koreaDate = new Date(new Date(summary.asOf).getTime() + 9 * 3600000);
    expect(summary.period.from).toBe(new Date(Date.UTC(koreaDate.getUTCFullYear(), koreaDate.getUTCMonth(), 1) - 9 * 3600000).toISOString());
    const filtered = await ok<MarketingSummary>(await GET(req("/marketing/summary?serviceId=" + service, "GET", "privacy")));
    expect(filtered.items.map(s => s.id)).toEqual([service]);
    expect((await GET(req("/marketing/summary?serviceId=" + second, "GET", "privacy"))).status).toBe(404);
    expect((await GET(req("/marketing/summary?serviceId=" + other))).status).toBe(404);
    expect((await GET(req("/marketing/summary?serviceId=invalid"))).status).toBe(422);
    const counts = summary.items[0]; expect(counts.total).toBe(await db.marketingPreference.count({ where: { tenantId: tenant, serviceId: service } })); expect(counts.withdrawn).toBeGreaterThan(0);
    const logs = JSON.stringify(await db.auditEvent.findMany({ where: { resource: "marketing", resourceId: p.id } })); expect(logs).not.toContain(f.contact.email); expect(logs).not.toContain(f.contact.name);
    const ciphertext = (await stored(sub.id)).contactCipher!; expect(decrypt(ciphertext)).toMatchObject({ contact: f.contact.email }); expect(marketingContactHash("sms", "010-1234-5678")).toBe(marketingContactHash("sms", "+82 10 1234 5678"));
    expect((await POST(req("/marketing/preferences/withdrawals", "POST", "owner", { serviceId: service, items: [{ id: p.id, version: p.version }] }, { origin: "https://invalid.local.test" }))).status).toBe(403);
  });
  test("summary uses one period snapshot for consent and withdrawal history", async () => {
    const from = new Date(Date.now() - 2000).toISOString();
    const f = await fixture(), sub = await submit(f, ["email"]), preference = await stored(sub.id);
    const to = new Date(Date.now() + 86400000).toISOString();
    const path = "/marketing/summary?" + new URLSearchParams({ serviceId: service, from, to });
    const response = await GET(req(path, "GET", "privacy"));
    const initial = await ok<MarketingSummary>(response);
    expect(initial.period.from).toBe(from); expect(initial.period.to).toBe(initial.asOf);
    const events = await db.marketingEvent.count({ where: { tenantId: tenant, preference: { serviceId: service },
      kind: { in: ["granted", "reconsented"] }, createdAt: { gte: new Date(from), lt: new Date(initial.period.to) } } });
    expect(initial.items[0].periodGrants).toBe(events);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { requestId: response.headers.get("x-request-id")! } });
    expect(audit).toMatchObject({ action: "marketing.summary_viewed", tenantId: tenant, serviceId: service });
    const grantEvent = await db.marketingEvent.findFirstOrThrow({ where: { preferenceId: preference.id, kind: "granted" } });
    const edge = await ok<MarketingSummary>(await GET(req("/marketing/summary?" + new URLSearchParams({
      serviceId: service, from, to: grantEvent.createdAt.toISOString(),
    }), "GET", "privacy")));
    expect(edge.items[0].periodGrants).toBe(initial.items[0].periodGrants - 1);
    await ok(await withdraw([preference]));
    const withdrawn = await ok<MarketingSummary>(await GET(req(path, "GET", "privacy")));
    expect(withdrawn.items[0].periodWithdrawals).toBe(initial.items[0].periodWithdrawals + 1);
    expect(withdrawn.items[0].eligible).toBe(initial.items[0].eligible - 1);
  });
});
