import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { decrypt, tokenHash } from "@/server/crypto";
import { sha256 } from "@/server/file-validation";
import type { FormRecord } from "@/contracts/forms";
import type { ShareRecord, ShareOptions, SharedPage, SharedSubmission } from "@/contracts/sharing";
import { GET as shareList, POST as shareCreate } from "@/app/api/v1/share-grants/route";
import { GET as shareGet, POST as shareAction, PATCH as shareEdit, DELETE as shareDelete } from "@/app/api/v1/share-grants/[...segments]/route";
import { GET as viewerGet, POST as viewerPost } from "@/app/api/v1/viewer/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as formAction, PATCH as formEdit } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as uploadPost, PUT as uploadPut } from "@/app/api/v1/uploads/[...segments]/route";
import { POST as subAction, PATCH as subEdit } from "@/app/api/v1/submissions/[...segments]/route";
import { PATCH as memberEdit } from "@/app/api/v1/members/[...segments]/route";
import { GET as privateFile } from "@/app/api/v1/files/[...segments]/route";
import { withViewer } from "@/server/viewer";
import { runOneJob } from "@/server/jobs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
const cookieOf = (response: Response) => response.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
function req(path: string, method = "GET", who = "owner", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? who,
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function ok<T = Record<string, unknown>>(response: Response, status = 200): Promise<T> {
  expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status); return response.json();
}
async function signup(name: string, role: Role, tenantId = tenant) {
  await db.rateLimit.deleteMany(); const email = name + "@sharing.local.test", password = "Sharing-test-password!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } }); members[name] = member.id;
  if (tenantId === tenant) await db.serviceGrant.create({ data: { tenantId, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200); cookies[name] = cookieOf(response);
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: "공유 QA 회사", policy: { create: {} } } });
  for (const id of [service, second]) await db.service.create({ data: { id, tenantId: tenant, name: id, externalName: "공유 QA" } });
  for (const role of ["owner", "admin", "privacy", "editor", "viewer", "sender", "auditor"] as Role[]) await signup(role, role);
  await signup("foreign", "owner", foreign);
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });
const bytes = Buffer.from("공유 첨부파일 합성 검증\n");
async function fixture(serviceId = service) {
  const name = randomUUID(), secret = randomUUID(), fileQuestion = randomUUID();
  const form = await ok<FormRecord>(await formCreate(req("/forms", "POST", "owner", { serviceId, title: "외부 공유 " + randomUUID(),
    content: { body: "합성 공유 검증", consentRequired: true, consentPurpose: "공유 테스트", retentionDays: 30, maxResponses: 100,
      questions: [{ id: name, label: "공유 이름", type: "단문형 답변", required: true }, { id: secret, label: "미공유 비밀", type: "단문형 답변", required: true }, { id: fileQuestion, label: "선택 첨부", type: "파일 업로드", required: false }] } }, { "idempotency-key": randomUUID() })), 201);
  const pub = await ok<{ token: string }>(await formAction(req(`/forms/${form.id}/publish`, "POST", "owner", { version: form.version }, { "idempotency-key": randomUUID() })), 201);
  const options = await ok<ShareOptions>(await shareGet(req(`/share-grants/options?formId=${form.id}`)));
  return { form, token: pub.token, name, secret, fileQuestion, versionId: options.versions[0].id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
test.each(["share.list_viewed", "share.viewed"])("외부 열람자 이메일 접근은 %s를 요청 ID로 감사하고 감사 실패는 원문을 반환하지 않는다", async action => {
  const f = await fixture(), row = await grant(f), read = () => action === "share.viewed" ? shareGet(req("/share-grants/" + row.id)) : shareList(req("/share-grants?formId=" + f.form.id));
  const response = await read(); expect(response.status).toBe(200);
  const events = await db.auditEvent.findMany({ where: { requestId: response.headers.get("x-request-id")! } });
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ tenantId: tenant, serviceId: service, action, detail: { changedFields: [] } });
  expect(JSON.stringify(events)).not.toContain(row.email);
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_share_read_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'synthetic read audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_share_read_fault BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_share_read_fault()');
  try { const denied = await read(); expect(denied.status).toBe(500); expect(await denied.text()).not.toContain(row.email); expect(await db.auditEvent.count({ where: { requestId: denied.headers.get("x-request-id")! } })).toBe(0); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER qa_share_read_fault ON "AuditEvent"'); await db.$executeRawUnsafe('DROP FUNCTION qa_share_read_fault()'); }
});
async function attachment(f: Fixture, body = bytes) {
  const file = await ok<{ id: string; uploadToken: string }>(await publicPost(req(`/public/forms/${f.token}/uploads`, "POST", "anonymous",
    { questionId: f.fileQuestion, name: "공유자료.txt", mime: "text/plain", size: body.length, sha256: sha256(body) }, { "idempotency-key": randomUUID() })), 201);
  const request = new Request(`${origin}/api/v1/uploads/${file.id}/content`, { method: "PUT", headers: { origin, "content-type": "text/plain", "x-upload-token": file.uploadToken }, body: new Uint8Array(body) });
  expect((await uploadPut(request)).status).toBe(200); await ok(await uploadPost(req(`/uploads/${file.id}/complete`, "POST", "anonymous", undefined, { "x-upload-token": file.uploadToken })));
  return file;
}
async function submit(f: Fixture, file?: Awaited<ReturnType<typeof attachment>>) {
  return ok<{ id: string; version: number }>(await publicPost(req(`/public/forms/${f.token}/submissions`, "POST", "anonymous", {
    answers: { [f.name]: "허용된 응답", [f.secret]: "이 응답은 공유하면 안 됩니다", ...(file ? { [f.fileQuestion]: file.id } : {}) }, consent: true,
    ...(file ? { attachments: { [f.fileQuestion]: { fileId: file.id, token: file.uploadToken } } } : {}) }, { "idempotency-key": randomUUID() })), 201);
}
const createInput = (f: Fixture, patch = {}) => ({ formId: f.form.id, formVersionId: f.versionId, email: randomUUID() + "@viewer.local.test", questionIds: [f.name], expiresAt: new Date(Date.now() + 86400000).toISOString(), ...patch });
async function invitation(grant: ShareRecord) {
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${grant.id}:invite:${grant.version}` } });
  const mail = decrypt<{ to: string; text: string }>(job.payloadCipher);
  return { formCode: grant.formId, invitationCode: mail.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], email: mail.to, consent: true };
}
async function grant(f: Fixture, patch = {}, who = "owner") {
  return ok<ShareRecord>(await shareCreate(req("/share-grants", "POST", who, createInput(f, patch), { "idempotency-key": randomUUID() })), 201);
}
async function challenge(g: ShareRecord) {
  const response = await viewerPost(req("/viewer/challenges", "POST", "anonymous", await invitation(g)));
  const value = await ok<{ id: string; expiresAt: string }>(response, 202), cookie = cookieOf(response);
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${g.id}:challenge:${value.id}` } });
  const mail = decrypt<{ text: string }>(job.payloadCipher), code = mail.text.match(/인증코드: (\d{6})/)![1];
  return { ...value, cookie, code, job };
}
const verify = (c: Awaited<ReturnType<typeof challenge>>, code = c.code, cookie = c.cookie) => viewerPost(req(`/viewer/challenges/${c.id}/verify`, "POST", cookie, { code }));
async function login(g: ShareRecord) { const c = await challenge(g), response = await verify(c); await ok(response); return cookieOf(response); }
const viewerList = (cookie = "anonymous", query = "") => viewerGet(req("/viewer/submissions" + query, "GET", cookie));
const download = (cookie: string, submissionId: string, questionId: string, fileId: string, action = "/download") => viewerGet(req(`/viewer/files/${fileId}${action}?submissionId=${submissionId}&questionId=${questionId}`, "GET", cookie));

describe("external sharing with PostgreSQL, local mail and private attachments", () => {
  test("creates one encrypted grant and one mail on retry; validates version and selected fields", async () => {
    const f = await fixture(), input = createInput(f), key = randomUUID();
    const [a, b] = await Promise.all([shareCreate(req("/share-grants", "POST", "owner", input, { "idempotency-key": key })), shareCreate(req("/share-grants", "POST", "owner", input, { "idempotency-key": key }))]);
    const first = await ok<ShareRecord>(a, 201), again = await ok<ShareRecord>(b, 201); expect(first.id).toBe(again.id);
    const stored = await db.shareGrant.findUniqueOrThrow({ where: { id: first.id } }); expect(stored.emailCipher).not.toContain(input.email); expect(decrypt(stored.emailCipher)).toBe(input.email);
    expect(stored.emailHash).toBe(tokenHash(input.email)); expect(JSON.stringify(first)).not.toMatch(/codeHash|emailHash|Cipher|invitationCode/);
    expect(await db.job.count({ where: { dedupeKey: `mail:share:${first.id}:invite:1` } })).toBe(1);
    expect((await shareCreate(req("/share-grants", "POST", "owner", { ...input, email: "else@viewer.local.test" }, { "idempotency-key": key }))).status).toBe(409);
    for (const patch of [{ questionIds: [] }, { questionIds: [f.name, f.name] }, { questionIds: [randomUUID()] }, { expiresAt: new Date(0).toISOString() }, { expiresAt: new Date(Date.now() + 91 * 86400000).toISOString() }])
      expect((await shareCreate(req("/share-grants", "POST", "owner", { ...input, ...patch }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  });
  test("role, tenant and current service grants protect all manager endpoints", async () => {
    const f = await fixture(), g = await grant(f);
    for (const who of ["editor", "viewer", "sender", "auditor"]) {
      expect((await shareList(req(`/share-grants?formId=${f.form.id}`, "GET", who))).status).toBe(403);
      expect((await shareGet(req(`/share-grants/${g.id}`, "GET", who))).status).toBe(403);
      expect((await shareCreate(req("/share-grants", "POST", who, createInput(f), { "idempotency-key": randomUUID() }))).status).toBe(403);
    }
    expect((await shareGet(req(`/share-grants/${g.id}`, "GET", "foreign"))).status).toBe(404);
    const hidden = await fixture(second);
    expect((await shareCreate(req("/share-grants", "POST", "privacy", createInput(hidden), { "idempotency-key": randomUUID() }))).status).toBe(403);
    await grant(f, {}, "privacy"); await grant(f, {}, "admin");
    expect((await shareCreate(req("/share-grants", "POST", "owner", createInput(f, { formVersionId: hidden.versionId }), { "idempotency-key": randomUUID() }))).status).toBe(404);
  });
  test("invalid combinations produce the same challenge shape without mail or a session", async () => {
    const f = await fixture(), g = await grant(f), invite = await invitation(g), before = await db.job.count();
    for (const patch of [{ email: "unknown@viewer.local.test" }, { formCode: randomUUID() }, { invitationCode: "x".repeat(43) }]) {
      const response = await viewerPost(req("/viewer/challenges", "POST", "anonymous", { ...invite, ...patch }));
      const value = await ok<{id:string;expiresAt:string}>(response, 202); expect(Object.keys(value).sort()).toEqual(["expiresAt", "id"]);
      expect(await db.viewerChallenge.findUnique({ where: { id: value.id } })).toBeNull();
      expect((await viewerPost(req(`/viewer/challenges/${value.id}/verify`, "POST", cookieOf(response), { code: "123456" }))).status).toBe(422);
    }
    expect(await db.job.count()).toBe(before); expect((await viewerList()).status).toBe(401);
    expect((await viewerPost(req("/viewer/challenges", "POST", "anonymous", { ...invite, consent: false }))).status).toBe(422);
  });
  test("local worker delivers a real authentication mail; cookie is HttpOnly and token never in JSON", async () => {
    const f = await fixture(), g = await grant(f), c = await challenge(g);
    for (let i = 0; i < 200 && (await db.job.findUniqueOrThrow({ where: { id: c.job.id } })).status !== "done"; i++) await runOneJob("sharing-test");
    const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, c.job.id + ".json"), "utf8")); expect(mail.to).toBe(g.email); expect(mail.text).toContain(c.code);
    const response = await verify(c), value = await ok(response); expect(value).toHaveProperty("expiresAt"); expect(value).not.toHaveProperty("token");
    expect(response.headers.getSetCookie().find(c => c.startsWith("cs_viewer="))).toMatch(/HttpOnly; SameSite=Strict/);
    const session = await db.viewerSession.findFirstOrThrow({ where: { challengeId: c.id } }); expect(session.tokenHash).toHaveLength(64);
    expect(await ok(await viewerGet(req("/viewer/session", "GET", cookieOf(response))))).toHaveProperty("questions");
  });
  test("only the requesting browser can verify and five failures persist", async () => {
    const c = await challenge(await grant(await fixture()));
    expect((await verify(c, c.code, "anonymous")).status).toBe(422);
    expect((await db.viewerChallenge.findUniqueOrThrow({ where: { id: c.id } })).attempts).toBe(0);
    const bad = c.code === "000000" ? "999999" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify(c, bad)).status).toBe(422);
    expect((await db.viewerChallenge.findUniqueOrThrow({ where: { id: c.id } })).attempts).toBe(5);
    expect((await verify(c)).status).toBe(422);
  });
  test("concurrent verification consumes the challenge exactly once", async () => {
    const c = await challenge(await grant(await fixture())), responses = await Promise.all([verify(c), verify(c)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 422]); expect(await db.viewerSession.count({ where: { challengeId: c.id } })).toBe(1);
    expect((await verify(c)).status).toBe(422);
  });
  test("a new challenge replaces the old one and expiry prevents verification", async () => {
    const g = await grant(await fixture()), first = await challenge(g), second = await challenge(g);
    expect((await verify(first)).status).toBe(422);
    await db.viewerChallenge.update({ where: { id: second.id }, data: { createdAt: new Date(Date.now() - 700000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await verify(second)).status).toBe(422);
  });
  test("only selected fields are returned and new published versions remain outside the grant", async () => {
    const f = await fixture(), sub = await submit(f), g = await grant(f), cookie = await login(g);
    const rows = await ok<SharedPage>(await viewerList(cookie)); expect(rows.items).toHaveLength(1); expect(rows.items[0].values).toEqual({ [f.name]: "허용된 응답" });
    expect(rows.viewer.questions.map(q => q.id)).toEqual([f.name]); expect(JSON.stringify(rows)).not.toContain("이 응답은 공유하면 안 됩니다"); expect(JSON.stringify(rows)).not.toContain("미공유 비밀");
    const detail = await ok<SharedSubmission>(await viewerGet(req(`/viewer/submissions/${sub.id}`, "GET", cookie))); expect(detail).not.toHaveProperty("receipts"); expect(detail).not.toHaveProperty("notes");
    const changed = await ok<FormRecord>(await formEdit(req(`/forms/${f.form.id}`, "PATCH", "owner", { version: f.form.version + 1, content: { ...f.form.content, body: "두 번째 게시본" } })));
    const pub = await ok<{token:string}>(await formAction(req(`/forms/${f.form.id}/publish`, "POST", "owner", { version: changed.version }, { "idempotency-key": randomUUID() })), 201);
    const later = await submit({ ...f, token: pub.token }); expect((await viewerGet(req(`/viewer/submissions/${later.id}`, "GET", cookie))).status).toBe(404);
    expect((await ok<SharedPage>(await viewerList(cookie))).total).toBe(1);
  });
  test("updates, resend and revoke invalidate old cookies and invitation codes immediately", async () => {
    const f = await fixture(); await submit(f); let g = await grant(f); const oldInvite = await invitation(g), oldCookie = await login(g);
    g = await ok<ShareRecord>(await shareEdit(req(`/share-grants/${g.id}`, "PATCH", "owner", { version: g.version, email: g.email, expiresAt: g.expiresAt, questionIds: [f.secret] })));
    expect((await viewerList(oldCookie)).status).toBe(401);
    const invalid = await ok<{id:string}>(await viewerPost(req("/viewer/challenges", "POST", "anonymous", oldInvite)), 202); expect(await db.viewerChallenge.findUnique({ where: { id: invalid.id } })).toBeNull();
    const updatedCookie = await login(g), data = await ok<SharedPage>(await viewerList(updatedCookie)); expect(data.items[0].values).toEqual({ [f.secret]: "이 응답은 공유하면 안 됩니다" });
    expect((await shareDelete(req(`/share-grants/${g.id}`, "DELETE", "owner", undefined, { "if-match": "1" }))).status).toBe(409);
    g = await ok<ShareRecord>(await shareAction(req(`/share-grants/${g.id}/resend`, "POST", "owner", { version: g.version })));
    expect((await viewerList(updatedCookie)).status).toBe(401); const resentCookie = await login(g);
    g = await ok<ShareRecord>(await shareDelete(req(`/share-grants/${g.id}`, "DELETE", "owner", undefined, { "if-match": String(g.version) })));
    expect(g.status).toBe("revoked"); expect((await viewerList(resentCookie)).status).toBe(401);
    expect((await shareAction(req(`/share-grants/${g.id}/resend`, "POST", "owner", { version: g.version }))).status).toBe(409);
  });
  test("changing recipient invalidates old email and session and invites the new email", async () => {
    const f = await fixture(), g = await grant(f), oldCookie = await login(g), oldInvite = await invitation(g);
    const changed = await ok<ShareRecord>(await shareEdit(req(`/share-grants/${g.id}`, "PATCH", "owner", { version: g.version, email: "new-recipient@viewer.local.test", expiresAt: g.expiresAt, questionIds: g.questionIds })));
    const next = await invitation(changed); expect(next.email).toBe("new-recipient@viewer.local.test"); expect((await viewerList(oldCookie)).status).toBe(401);
    const invalid = await ok<{id:string}>(await viewerPost(req("/viewer/challenges", "POST", "anonymous", { ...next, email: oldInvite.email })), 202);
    expect(await db.viewerChallenge.findUnique({ where: { id: invalid.id } })).toBeNull(); expect((await viewerList(await login(changed))).status).toBe(200);
  });
  test("expired grant, expired session and logout deny a captured cookie", async () => {
    const f = await fixture(), g = await grant(f), cookie = await login(g);
    const token = cookie.match(/cs_viewer=([^;]+)/)![1], s = await db.viewerSession.findUniqueOrThrow({ where: { tokenHash: tokenHash(token) } });
    await db.viewerSession.update({ where: { id: s.id }, data: { createdAt: new Date(Date.now() - 20000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await viewerList(cookie)).status).toBe(401);
    const next = await login(g); expect((await viewerPost(req("/viewer/logout", "POST", next))).status).toBe(204); expect((await viewerList(next)).status).toBe(401);
    const last = await login(g); await db.shareGrant.update({ where: { id: g.id }, data: { createdAt: new Date(Date.now() - 20000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await viewerList(last)).status).toBe(401); expect((await shareGet(req(`/share-grants/${g.id}`)).then(r => ok<ShareRecord>(r))).status).toBe("expired");
  });
  test("creator service capability and member suspension block already authenticated sessions", async () => {
    const f = await fixture(), g = await grant(f, {}, "privacy"), cookie = await login(g);
    const serviceGrant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.privacy, serviceId: service } } });
    await db.serviceGrant.update({ where: { id: serviceGrant.id }, data: { capabilities: serviceGrant.capabilities.filter(c => c !== "share.manage") } });
    expect((await viewerList(cookie)).status).toBe(401);
    await db.serviceGrant.update({ where: { id: serviceGrant.id }, data: { capabilities: serviceGrant.capabilities } });
    const member = await db.membership.findUniqueOrThrow({ where: { id: members.privacy } });
    await ok(await memberEdit(req(`/members/${member.id}`, "PATCH", "owner", { version: member.version, status: "suspended" })));
    expect((await viewerList(cookie)).status).toBe(401);
    await ok(await memberEdit(req(`/members/${member.id}`, "PATCH", "owner", { version: member.version + 1, status: "active" })));
  });
  test("withdrawn, pending destruction and expired responses including legal hold are hidden", async () => {
    const f = await fixture(), a = await submit(f), b = await submit(f), c = await submit(f), g = await grant(f), cookie = await login(g);
    await ok(await subAction(req(`/submissions/${a.id}/withdraw`, "POST", "owner", { version: 1, reason: "공유 철회 검증" })));
    await ok(await subAction(req(`/submissions/${b.id}/destruction-request`, "POST", "owner", { version: 1, reason: "공유 파기 검증" })));
    await db.submission.update({ where: { id: c.id }, data: { retentionUntil: new Date(Date.now() - 1000), legalHold: true } });
    expect((await ok<SharedPage>(await viewerList(cookie))).items).toEqual([]);
    for (const sub of [a,b,c]) expect((await viewerGet(req(`/viewer/submissions/${sub.id}`, "GET", cookie))).status).toBe(410);
  });
  test("files require selected question, current answer, exact binding and fresh grant", async () => {
    const f = await fixture(), file = await attachment(f), sub = await submit(f, file), g = await grant(f, { questionIds: [f.name, f.fileQuestion] }), cookie = await login(g);
    const response = await download(cookie, sub.id, f.fileQuestion, file.id); expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("content-disposition")).toContain("filename*");
    expect((await download(cookie, sub.id, f.secret, file.id)).status).toBe(404); expect((await download(cookie, randomUUID(), f.fileQuestion, file.id)).status).toBe(404);
    const restricted = await login(await grant(f)); expect((await download(restricted, sub.id, f.fileQuestion, file.id)).status).toBe(404);
    expect((await privateFile(req(`/files/${file.id}/download?submissionId=${sub.id}&questionId=${f.fileQuestion}`, "GET", cookie))).status).toBe(401);
    await ok(await subEdit(req(`/submissions/${sub.id}`, "PATCH", "owner", { version: 1, reason: "파일 정정", answers: { [f.fileQuestion]: "" } })));
    expect((await download(cookie, sub.id, f.fileQuestion, file.id)).status).toBe(404);
    expect((await ok<SharedPage>(await viewerList(cookie))).items[0].attachments).toEqual([]);
    await ok(await shareDelete(req(`/share-grants/${g.id}`, "DELETE", "owner", undefined, { "if-match": String(g.version) })));
    expect((await download(cookie, sub.id, f.fileQuestion, file.id)).status).toBe(401);
  });
  test("DB foreign keys reject cross-version fields, cross-grant sessions and revived revoked grants", async () => {
    const a = await fixture(), b = await fixture(), ga = await grant(a), gb = await grant(b), c = await challenge(ga);
    const otherQuestion = await db.question.findFirstOrThrow({ where: { formVersionId: b.versionId } });
    await expect(db.shareField.create({ data: { tenantId: tenant, grantId: ga.id, formVersionId: a.versionId, questionId: otherQuestion.id } })).rejects.toThrow();
    await expect(db.viewerSession.create({ data: { tenantId: tenant, grantId: gb.id, grantVersion: gb.version, challengeId: c.id, tokenHash: tokenHash(randomUUID()), expiresAt: new Date(Date.now() + 60000) } })).rejects.toThrow();
    await ok(await shareDelete(req(`/share-grants/${ga.id}`, "DELETE", "owner", undefined, { "if-match": String(ga.version) })));
    await expect(db.shareGrant.update({ where: { id: ga.id }, data: { revokedAt: null } })).rejects.toThrow();
  });
  test("pagination, filters and audit events use server data without secret values", async () => {
    const f = await fixture(); await submit(f); const g = await grant(f); await grant(f);
    const cookie = await login(g); await ok(await viewerList(cookie));
    const list = await ok<{total:number;items:ShareRecord[]}>(await shareList(req(`/share-grants?formId=${f.form.id}&page=1&pageSize=1&status=active`))); expect(list.total).toBe(2); expect(list.items).toHaveLength(1);
    const events = await ok<{total:number;items:unknown[]}>(await shareGet(req(`/share-grants/${g.id}/events?pageSize=100`))); expect(events.total).toBeGreaterThanOrEqual(4);
    const serialized = JSON.stringify(events); expect(serialized).toContain("share.responses_viewed"); expect(serialized).not.toContain(g.email); expect(serialized).not.toContain("허용된 응답"); expect(serialized).not.toContain((await invitation(g)).invitationCode);
  });
  test("origin and method validation prevent CSRF or unsupported mutations", async () => {
    const f = await fixture(), g = await grant(f), c = await challenge(g);
    expect((await shareEdit(req(`/share-grants/${g.id}`, "PATCH", "owner", { version: 1, email: g.email, questionIds: g.questionIds, expiresAt: g.expiresAt }, { origin: "https://foreign.example" }))).status).toBe(403);
    expect((await viewerPost(req(`/viewer/challenges/${c.id}/verify`, "POST", c.cookie, { code: c.code }, { origin: "https://foreign.example" }))).status).toBe(403);
    expect((await viewerPost(req("/viewer/logout/extra", "POST", "anonymous"))).status).toBe(404);
    expect((await viewerGet(req("/viewer/submissions/extra/extra", "GET", "anonymous"))).status).toBe(404);
    expect((await shareAction(req(`/share-grants/${g.id}/resend/extra`, "POST", "owner", { version: 1 }))).status).toBe(404);
  });
  test("grant revocation waits for an authorized read and then rejects the next read", async () => {
    const g = await grant(await fixture()), cookie = await login(g), token = cookie.match(/cs_viewer=([^;]+)/)![1];
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const reading = withViewer(token, async () => { entered(); await gate; return "authorized"; });
    await ready;
    let completed = false;
    const revoking = shareDelete(req(`/share-grants/${g.id}`, "DELETE", "owner", undefined, { "if-match": String(g.version) })).then(response => { completed = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 80)); expect(completed).toBe(false);
    release(); expect(await reading).toBe("authorized"); await ok(await revoking);
    expect((await viewerList(cookie)).status).toBe(401);
  });
  test("email lookup is normalized; archived services and missing file capability block access", async () => {
    const f = await fixture(), g = await grant(f, { email: "  EXACT@viewer.local.test  " });
    const list = await ok<{total:number}>(await shareList(req(`/share-grants?formId=${f.form.id}&search=EXACT%40viewer.local.test`))); expect(list.total).toBe(1);
    const shared = await grant(f, { questionIds: [f.fileQuestion] }, "admin"), cookie = await login(shared);
    await db.service.update({ where: { id: service }, data: { status: "archived" } });
    expect((await viewerList(cookie)).status).toBe(401);
    await db.service.update({ where: { id: service }, data: { status: "active" } });
    expect((await viewerList(cookie)).status).toBe(200);
    expect(g.email).toBe("exact@viewer.local.test");
    await signup("filemanager", "privacy");
    const fileGrant = await grant(f, { questionIds: [f.fileQuestion] }, "filemanager"), fileCookie = await login(fileGrant);
    const bound = await db.serviceGrant.findFirstOrThrow({ where: { memberId: members.filemanager, serviceId: service } });
    await db.serviceGrant.update({ where: { id: bound.id }, data: { capabilities: bound.capabilities.filter(c => c !== "file.read") } });
    expect((await viewerList(fileCookie)).status).toBe(401);
    expect((await shareCreate(req("/share-grants", "POST", "filemanager", createInput(f, { questionIds: [f.fileQuestion] }), { "idempotency-key": randomUUID() }))).status).toBe(403);
  });
  test("five challenge requests per address are allowed and the sixth is throttled", async () => {
    const f = await fixture(), g = await grant(f), input = await invitation(g);
    for (let i=0; i<5; i++) expect((await viewerPost(req("/viewer/challenges", "POST", "anonymous", input))).status).toBe(202);
    const blocked = await viewerPost(req("/viewer/challenges", "POST", "anonymous", input));
    expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBe("60");
  });

});
