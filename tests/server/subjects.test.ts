import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { decrypt } from "@/server/crypto";
import { subjectHashes } from "@/server/subject-identity";
import { cleanupSubjectAccess, withSubject, subjectConsents } from "@/server/subjects";
import { enqueueMail, enqueueServiceMail, runOneJob } from "@/server/jobs";
import { runOneDestruction } from "@/server/destruction-worker";
import type { FormRecord, FormContent } from "@/contracts/forms";
import type { SubjectConsent, SubjectEvent, SubjectPage, SubjectSessionInfo, SubjectWithdrawalRecord } from "@/contracts/subjects";
import { GET as subjectGet, POST as subjectPost } from "@/app/api/v1/subjects/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as formAction, PATCH as formEdit } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as subAction, PATCH as subEdit } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as destructionAction } from "@/app/api/v1/destruction-requests/[...segments]/route";
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), otherService = randomUUID();
const cookies: Record<string, string> = {};
const cookieOf = (r: Response) => r.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? who,
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> {
  expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json();
}
async function signup(name: string, tenantId: string) {
  await db.rateLimit.deleteMany(); const email = name + "@subjects.local.test", password = "Subject-testing-password!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role: "owner" } });
  for (const serviceId of tenantId === tenant ? [service, second] : [otherService]) await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId, capabilities: [...roleCapabilities("owner")] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200); cookies[name] = cookieOf(response);
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "SubjectAccessRequest" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: "정보주체 QA " + id, policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [otherService, foreign]]) await db.service.create({ data: { id, tenantId, name: id, externalName: "정보주체 서비스" } });
  await signup("owner", tenant); await signup("foreign", foreign);
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });
async function draft(roles = true, serviceId: string = service, who = "owner", patch: Partial<FormContent> = {}) {
  const name = randomUUID(), email = randomUUID(), secret = randomUUID();
  const form = await ok<FormRecord>(await formCreate(req("/forms", "POST", who, { serviceId, title: "동의 이력 " + randomUUID(), content: { body: "합성 테스트", consentPurpose: "상담 신청 처리", consentRequired: true, retentionDays: 30, maxResponses: 100,
    questions: [{ id: name, label: "이름", required: true, type: "단문형 답변", ...(roles ? { subjectRole: "name" } : {}) }, { id: email, label: "이메일", required: true, type: "단문형 답변", ...(roles ? { subjectRole: "email" } : {}) },
      { id: secret, label: "비공개 응답", type: "장문형 답변", required: false }], ...patch } }, { "idempotency-key": randomUUID() })), 201);
  return { form, name, email, secret, serviceId, who };
}
async function fixture(roles = true, serviceId: string = service, who = "owner") {
  const d = await draft(roles, serviceId, who), pub = await ok<{ token: string }>(await formAction(req(`/forms/${d.form.id}/publish`, "POST", who, { version: d.form.version }, { "idempotency-key": randomUUID() })), 201);
  return { ...d, token: pub.token, contact: { name: "합성 " + randomUUID(), email: randomUUID() + "@subject.local.test" } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function submit(f: Fixture, contact = f.contact) {
  const r = await ok<{ id: string }>(await publicPost(req(`/public/forms/${f.token}/submissions`, "POST", "anonymous", { answers: { [f.name]: contact.name, [f.email]: contact.email, [f.secret]: "PRIVATE-ANSWER" }, consent: true }, { "idempotency-key": randomUUID() })), 201);
  return db.submission.findUniqueOrThrow({ where: { id: r.id } });
}
async function accessRequest(contact: Fixture["contact"], browser = "anonymous") {
  const before = await db.subjectAccessRequest.findMany({ select: { id: true } });
  const r = await subjectPost(req("/subjects/access-requests", "POST", browser, { ...contact, consent: true })); await ok(r.clone(), 202);
  const access = await db.subjectAccessRequest.findFirst({ where: { id: { notIn: before.map(v => v.id) } } });
  return { response: r, cookie: cookieOf(r), access };
}
async function drainMail(id: string) {
  for (let count = 0; count < 200; count++) {
    const row = await db.job.findUniqueOrThrow({ where: { id } });
    if (["done", "cancelled", "dead"].includes(row.status)) return row;
    if (!await runOneJob("subjects-tests")) break;
  }
  throw new Error("mail did not settle");
}
async function mailToken(accessId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + accessId } });
  expect((await drainMail(job.id)).status).toBe("done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8"));
  expect(mail.to).toBe(decrypt<{ to: string }>(job.payloadCipher).to);
  const token = /\/infoOwner\/agree-history\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1]; if (!token) throw new Error("link missing"); return token;
}
async function login(contact: Fixture["contact"]) {
  const access = await accessRequest(contact), token = await mailToken(access.access!.id);
  const r = await subjectPost(req("/subjects/sessions", "POST", access.cookie, { token })), data = await ok<SubjectSessionInfo>(r, 201);
  return { ...data, cookie: cookieOf(r), access, token };
}
type Login = Awaited<ReturnType<typeof login>>;
const subjectReq = (login: Pick<Login, "cookie" | "id">, path: string, method = "GET", input?: unknown) => req("/subjects" + path, method, login.cookie, input, { "x-subject-session": login.id });
const history = (s: Login) => subjectGet(subjectReq(s, "/me/consents"));
async function startWithdrawal(s: Login, sub: { id: string; version: number }) { return ok<SubjectWithdrawalRecord>(await subjectPost(subjectReq(s, "/me/withdrawals", "POST", { submissionId: sub.id, version: sub.version })), 201); }
async function destroy(sub: { id: string; version: number }) {
  const result = await ok<{ destructionId: string }>(await subAction(req(`/submissions/${sub.id}/destruction-request`, "POST", "owner", { version: sub.version, reason: "합성 검증 완료" })));
  const row = await db.destructionRequest.findUniqueOrThrow({ where: { id: result.destructionId } });
  await ok(await destructionAction(req(`/destruction-requests/${row.id}/approve`, "POST", "owner", { version: row.version, reason: "정리 확인" })));
  await runOneDestruction("subjects-tests"); expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("destroyed");
}
describe("explicit subject identity and real PostgreSQL access", () => {
  test("titles never infer identity; only paired required short text roles can publish", async () => {
    const f = await fixture(false), sub = await submit(f); expect(sub.subjectId).toBeNull();
    const d = await draft(), single = { ...d.form.content, questions: d.form.content.questions.map(q => q.subjectRole === "email" ? { ...q, subjectRole: undefined } : q) };
    const edited = await ok<FormRecord>(await formEdit(req(`/forms/${d.form.id}`, "PATCH", "owner", { version: d.form.version, content: single })));
    expect((await formAction(req(`/forms/${d.form.id}/publish`, "POST", "owner", { version: edited.version }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    for (const change of [{ subjectRole: "name" }, { required: false }, { type: "장문형 답변" }]) {
      const questions = d.form.content.questions.map((q, i) => i === 1 ? { ...q, ...change } : q);
      expect((await formEdit(req(`/forms/${d.form.id}`, "PATCH", "owner", { version: edited.version, content: { ...d.form.content, questions } }))).status).toBe(422);
    }
  });
  test("invalid name/email are rejected before writing; normalized identity deduplicates", async () => {
    const f = await fixture();
    for (const [name, email] of [["x".repeat(101), f.contact.email], [f.contact.name, "invalid"], ["통제\u0001문자", f.contact.email]]) {
      expect((await publicPost(req(`/public/forms/${f.token}/submissions`, "POST", "anonymous", { answers: { [f.name]: name, [f.email]: email }, consent: true }, { "idempotency-key": randomUUID() }))).status).toBe(422);
    }
    expect(await db.submission.count({ where: { formVersion: { formId: f.form.id } } })).toBe(0);
    const first = await submit(f, { name: "가 나", email: f.contact.email }), second = await submit(f, { name: "  가  나 ".normalize("NFD"), email: f.contact.email.toUpperCase() });
    expect(second.subjectId).toBe(first.subjectId);
    const subject = await db.dataSubject.findUniqueOrThrow({ where: { id: first.subjectId! } }); expect(subject.contactCipher).not.toContain(f.contact.email);
    expect(decrypt(subject.contactCipher)).toEqual({ name: "가 나", email: f.contact.email });
    const questions = await db.question.findMany({ where: { formVersionId: first.formVersionId } });
    await expect(db.question.update({ where: { id: questions[0].id }, data: { subjectRole: null } })).rejects.toThrow();
  });
  test("same contact remains separate across services and companies; verified person can see all their fixed scopes", async () => {
    const f = await fixture(), g = await fixture(true, second), h = await fixture(true, otherService, "foreign");
    const rows = await Promise.all([submit(f), submit(g, f.contact), submit(h, f.contact)]);
    expect(new Set(rows.map(r => r.subjectId)).size).toBe(3);
    const session = await login(f.contact), records = await ok<SubjectPage<SubjectConsent>>(await history(session)); expect(records.total).toBe(3);
    const later = await fixture(); await submit(later, { ...f.contact, name: f.contact.name + " 다른 이름" });
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(3);
    const newService = await db.service.create({ data: { tenantId: tenant, name: randomUUID(), externalName: "신규" } });
    const newF = await fixture(true, newService.id); await submit(newF, f.contact);
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(3);
  });
  test("existence gets identical 202 response and browser cookie, consent and CSRF are required", async () => {
    const f = await fixture(); await submit(f);
    const found = await accessRequest(f.contact), absent = await accessRequest({ ...f.contact, name: "없는 사람" });
    expect(await found.response.json()).toEqual(await absent.response.json()); expect(absent.access).toBeNull();
    for (const r of [found.response, absent.response]) expect(r.headers.get("set-cookie")).toMatch(/Path=\/api\/v1\/subjects; HttpOnly; SameSite=Strict; Max-Age=600/);
    expect((await subjectPost(req("/subjects/access-requests", "POST", "anonymous", { ...f.contact, consent: false }))).status).toBe(422);
    expect((await subjectPost(req("/subjects/access-requests", "POST", "anonymous", { ...f.contact, consent: true }, { origin: "https://attacker.example" }))).status).toBe(403);
  });
  test("mail token binds to request browser, GET never consumes it, POST can consume once even concurrently", async () => {
    const f = await fixture(); await submit(f); const request = await accessRequest(f.contact), token = await mailToken(request.access!.id);
    expect((await subjectGet(req("/subjects/sessions?token=" + token, "GET", request.cookie))).status).toBe(404);
    expect((await db.subjectAccessRequest.findUniqueOrThrow({ where: { id: request.access!.id } })).consumedAt).toBeNull();
    expect((await subjectPost(req("/subjects/sessions", "POST", "anonymous", { token }))).status).toBe(422);
    const results = await Promise.all([0, 1].map(() => subjectPost(req("/subjects/sessions", "POST", request.cookie, { token }))));
    expect(results.map(r => r.status).sort()).toEqual([201, 422]);
    const response = results.find(r => r.status === 201)!, setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly; SameSite=Strict; Max-Age=\d+/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)![1]), current = await db.subjectSession.findUniqueOrThrow({ where: { requestId: request.access!.id } });
    expect(maxAge).toBeGreaterThan(0); expect(maxAge).toBeLessThanOrEqual(1800);
    expect(maxAge).toBeLessThanOrEqual(Math.ceil((current.expiresAt.getTime() - Date.now()) / 1000));
    expect((await db.subjectSession.count({ where: { requestId: request.access!.id } }))).toBe(1);
  });
  test("expired and foreign links fail; only URL session matching its cookie reads; logout revokes", async () => {
    const f = await fixture(); await submit(f); const expired = await accessRequest(f.contact), token = await mailToken(expired.access!.id);
    await db.subjectAccessRequest.update({ where: { id: expired.access!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await subjectPost(req("/subjects/sessions", "POST", expired.cookie, { token }))).status).toBe(422);
    const one = await login(f.contact), two = await login(f.contact);
    expect((await subjectGet(subjectReq({ ...one, id: two.id }, "/me/consents"))).status).toBe(401);
    expect((await subjectGet(req("/subjects/me/consents", "GET", one.cookie))).status).toBe(401);
    await subjectPost(subjectReq(one, "/logout", "POST")); expect((await history(one)).status).toBe(401);
    await db.subjectSession.update({ where: { id: two.id }, data: { expiresAt: new Date(Date.now() - 1000) } }); expect((await history(two)).status).toBe(401);
  });
  test("reads expose only consents/events, paginate, and cannot see another person's response", async () => {
    const f = await fixture(), first = await submit(f); await submit(f); const other = await submit(f, { ...f.contact, name: "남의 응답" }), session = await login(f.contact);
    const firstPage = await ok<SubjectPage<SubjectConsent>>(await subjectGet(subjectReq(session, "/me/consents?pageSize=1&page=1")));
    const nextPage = await ok<SubjectPage<SubjectConsent>>(await subjectGet(subjectReq(session, "/me/consents?pageSize=1&page=2"))); expect(firstPage.total).toBe(2); expect(firstPage.items[0].id).not.toBe(nextPage.items[0].id);
    const serialized = JSON.stringify(firstPage); for (const word of ["PRIVATE-ANSWER", f.contact.email, "valueCipher", "tokenHash", "contactCipher"]) expect(serialized).not.toContain(word);
    const events = await ok<SubjectPage<SubjectEvent>>(await subjectGet(subjectReq(session, "/me/events"))); expect(events.items.map(e => e.type)).toEqual(["granted", "granted"]);
    expect((await subjectPost(subjectReq(session, "/me/withdrawals", "POST", { submissionId: other.id, version: other.version }))).status).toBe(404);
    expect(firstPage.items.concat(nextPage.items).map(s => s.id)).toContain(first.id);
  });
  test("correction rebinds one response, removes orphan contact and stale authentication scope", async () => {
    const f = await fixture(), a = await submit(f), b = await submit(f), session = await login(f.contact);
    await ok(await subEdit(req(`/submissions/${a.id}`, "PATCH", "owner", { version: 1, reason: "합성 정정", answers: { [f.email]: "changed-" + f.contact.email } })));
    expect((await db.submission.findUniqueOrThrow({ where: { id: a.id } })).subjectId).not.toBe(a.subjectId);
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).items.map(s => s.id)).toEqual([b.id]);
    await ok(await subEdit(req(`/submissions/${b.id}`, "PATCH", "owner", { version: 1, reason: "마지막 정정", answers: { [f.email]: "changed-" + f.contact.email } })));
    expect(await db.dataSubject.findUnique({ where: { id: a.subjectId! } })).toBeNull(); expect(await db.subjectAccessScope.count({ where: { subjectId: a.subjectId! } })).toBe(0);
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(0);
  });
  test("approved destruction removes identity only after the last response and removes scopes", async () => {
    const f = await fixture(), a = await submit(f), b = await submit(f), session = await login(f.contact);
    await destroy(a); expect(await db.dataSubject.findUnique({ where: { id: a.subjectId! } })).not.toBeNull();
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).items.map(s => s.id)).toEqual([b.id]);
    await destroy(b); expect(await db.dataSubject.findUnique({ where: { id: b.subjectId! } })).toBeNull();
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(0);
  });
  test("retention expiry and inactive company/service immediately remove accessible records", async () => {
    const f = await fixture(), sub = await submit(f), session = await login(f.contact);
    await db.service.update({ where: { id: service }, data: { status: "archived" } });
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(0);
    await db.service.update({ where: { id: service }, data: { status: "active" } });
    await db.company.update({ where: { id: tenant }, data: { status: "suspended" } }); expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(0);
    await db.company.update({ where: { id: tenant }, data: { status: "active" } });
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(0);
  });
  test("withdrawal cancel leaves consent intact; confirmation is atomic and idempotent", async () => {
    const f = await fixture(), sub = await submit(f), session = await login(f.contact), cancelled = await startWithdrawal(session, sub);
    expect((await ok<SubjectWithdrawalRecord>(await subjectGet(subjectReq(session, "/me/withdrawals/" + cancelled.id)))).status).toBe("requested");
    await ok(await subjectPost(subjectReq(session, `/me/withdrawals/${cancelled.id}/cancel`, "POST")));
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("submitted");
    expect((await subjectPost(subjectReq(session, `/me/withdrawals/${cancelled.id}/confirm`, "POST"))).status).toBe(409);
    const flow = await startWithdrawal(session, sub); expect(flow.id).not.toBe(cancelled.id);
    const results = await Promise.all([0, 1].map(() => subjectPost(subjectReq(session, `/me/withdrawals/${flow.id}/confirm`, "POST"))));
    for (const r of results) expect((await ok<SubjectWithdrawalRecord>(r)).status).toBe("completed");
    const current = await db.submission.findUniqueOrThrow({ where: { id: sub.id } }); expect(current).toMatchObject({ status: "withdrawn", version: 2 });
    expect(await db.consentEvent.count({ where: { receipt: { submissionId: sub.id }, type: "withdrawn" } })).toBe(1);
    const suppression = await db.suppression.findFirstOrThrow({ where: { sourceSubmissionId: sub.id } }); expect(suppression.emailHash).toBe(subjectHashes(f.contact.name, f.contact.email).emailHash);
    expect((await ok<SubjectPage<SubjectEvent>>(await subjectGet(subjectReq(session, "/me/events")))).items.map(e => e.type)).toEqual(["withdrawn", "granted"]);
  });
  test("another authenticated session cannot confirm a flow; stale correction blocks confirmation", async () => {
    const f = await fixture(), sub = await submit(f), a = await login(f.contact), b = await login(f.contact), flow = await startWithdrawal(a, sub);
    expect((await subjectPost(subjectReq(b, `/me/withdrawals/${flow.id}/confirm`, "POST"))).status).toBe(404);
    await ok(await subEdit(req(`/submissions/${sub.id}`, "PATCH", "owner", { version: 1, reason: "정정 경합", answers: { [f.secret]: "다른 답변" } })));
    expect((await subjectPost(subjectReq(a, `/me/withdrawals/${flow.id}/confirm`, "POST"))).status).toBe(409);
    const next = await startWithdrawal(a, { id: sub.id, version: 2 }); expect(next.id).not.toBe(flow.id);
    expect((await db.subjectWithdrawal.findUniqueOrThrow({ where: { id: flow.id } })).status).toBe("cancelled");
  });
  test("administrator withdrawal suppresses scheduled and future business mail, transaction mail still works", async () => {
    const f = await fixture(), sub = await submit(f), mail = { to: f.contact.email, subject: "후속 안내", text: "합성 발송" };
    const queued = await enqueueServiceMail(mail, { tenantId: tenant, serviceId: service });
    await ok(await subAction(req(`/submissions/${sub.id}/withdraw`, "POST", "owner", { version: 1, reason: "요청에 따른 철회" })));
    expect((await drainMail(queued.id!))).toMatchObject({ status: "cancelled", lastError: "SUPPRESSED" });
    await expect(access(resolve(env.LOCAL_MAIL_DIR, queued.id + ".json"))).rejects.toThrow();
    expect(await enqueueServiceMail(mail, { tenantId: tenant, serviceId: service })).toEqual({ id: null, suppressed: true });
    const other = await enqueueServiceMail(mail, { tenantId: tenant, serviceId: second }); expect((await drainMail(other.id!)).status).toBe("done");
    const authMail = await enqueueMail({ ...mail, subject: "필수 이메일 인증" }); expect((await drainMail(authMail.id)).status).toBe("done");
  });
  test("database rejects cross-service bindings, scope extension after verification and invalid suppression", async () => {
    const f = await fixture(), sub = await submit(f), g = await fixture(true, second), other = await submit(g, f.contact), session = await login(f.contact);
    await expect(db.submission.update({ where: { id: sub.id }, data: { subjectId: other.subjectId } })).rejects.toThrow();
    await expect(db.subjectAccessScope.create({ data: { requestId: session.access.access!.id, subjectId: sub.subjectId!, tenantId: foreign } })).rejects.toThrow();
    const h = await fixture(), extra = await submit(h); await expect(db.subjectAccessScope.create({ data: { requestId: session.access.access!.id, subjectId: extra.subjectId!, tenantId: tenant } })).rejects.toThrow();
    await expect(db.suppression.create({ data: { tenantId: tenant, serviceId: second, emailHash: subjectHashes(f.contact.name, f.contact.email).emailHash, reason: "subject_withdrawal", sourceSubmissionId: sub.id } })).rejects.toThrow();
  });
  test("rate limits have no existence exception, old auth material is cleaned without erasing consent", async () => {
    const f = await fixture(), sub = await submit(f); for (let i = 0; i < 5; i++) await accessRequest({ ...f.contact, name: "없는 사람" });
    expect((await subjectPost(req("/subjects/access-requests", "POST", "anonymous", { ...f.contact, consent: true }))).status).toBe(429);
    await db.apiRateLimit.deleteMany(); const session = await login(f.contact);
    await db.subjectAccessRequest.update({ where: { id: session.access.access!.id }, data: { expiresAt: new Date(Date.now() - 86500000) } });
    const mail = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + session.access.access!.id } });
    await cleanupSubjectAccess();
    const erased = await db.job.findUniqueOrThrow({ where: { id: mail.id } }); expect(erased.status).toBe("cancelled"); expect(decrypt(erased.payloadCipher)).toEqual({ erased: true });
    await expect(access(resolve(env.LOCAL_MAIL_DIR, mail.id + ".json"))).rejects.toThrow();
    expect(await db.subjectSession.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await db.consentReceipt.count({ where: { submissionId: sub.id } })).toBe(1);
  });
  test("worker drops an expired authentication mail before creating an outbox file", async () => {
    const f = await fixture(); await submit(f); const request = await accessRequest(f.contact);
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + request.access!.id } });
    await db.subjectAccessRequest.update({ where: { id: request.access!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await drainMail(job.id)).status).toBe("cancelled");
    await expect(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
  });
  test("a read holds the current response stable until a concurrent correction finishes", async () => {
    const f = await fixture(), sub = await submit(f), session = await login(f.contact);
    const token = session.cookie.split("=")[1]; let unlock!: () => void, ready!: () => void;
    const release = new Promise<void>(r => { unlock = r; }), locked = new Promise<void>(r => { ready = r; });
    const reading = withSubject(token, session.id, async (tx, current) => { const result = await subjectConsents(tx, current, 1, 20, randomUUID()); ready(); await release; return result; });
    await locked; let finished = false;
    const writing = subEdit(req(`/submissions/${sub.id}`, "PATCH", "owner", { version: 1, reason: "동시 정정", answers: { [f.email]: "moved-" + f.contact.email } })).then(r => { finished = true; return r; });
    try { await new Promise(r => setTimeout(r, 50)); expect(finished).toBe(false); } finally { unlock(); }
    expect((await reading).items[0].id).toBe(sub.id); await ok(await writing);
    expect((await ok<SubjectPage<SubjectConsent>>(await history(session))).total).toBe(0);
  });
});
