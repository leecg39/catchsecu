import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { decrypt } from "@/server/crypto";
import { downloadFile, fileMetadata, listSubmissionFiles } from "@/server/file-download";
import { getUpload, initMemberUpload, renameFile, cancelUpload, uploadContent } from "@/server/files";
import { privateFiles } from "@/server/file-storage";
import { sha256 } from "@/server/file-validation";
import { route } from "@/server/http";
import * as auditModule from "@/server/audit";
import { GET as fileGet } from "@/app/api/v1/files/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { PUT as uploadPut, POST as uploadPost } from "@/app/api/v1/uploads/[...segments]/route";
import { POST as shareCreate } from "@/app/api/v1/share-grants/route";
import { GET as viewerGet, POST as viewerPost } from "@/app/api/v1/viewer/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const barriers: { name: string; waiting: number; status: number }[] = [];
const bytes = Buffer.from("첨부파일 권한 검증용 합성 자료\n" + randomUUID());
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function req(path: string, method = "GET", value?: unknown, cookie = "", key: string = randomUUID(), extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": key, ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
const cookieOf = (r: Response) => r.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
async function ok(r: Response, status = 200) {
  expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json();
}
async function fixture() {
  const email = "file-gate-" + randomUUID() + "@catchsecu.test", password = "File-gate!123";
  await ok(await auth.handler(req("/auth/sign-up/email", "POST", { email, password, name: "첨부 권한 검증" })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "첨부파일 합성 회사", publicName: "첨부 검증", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "첨부 서비스", externalName: "첨부" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", { email, password })); await ok(login);
  const cookie = cookieOf(login), ctx = await requireContext(req("/context", "GET", undefined, cookie).headers), serviceId = company.services[0].id;
  const first = randomUUID(), second = randomUUID();
  const form = await ok(await formCreate(req("/forms", "POST", { serviceId, title: "첨부 권한 검사", content: { body: "합성 검증", consentRequired: true,
    consentPurpose: "시험", retentionDays: 30, maxResponses: 10, questions: [first, second].map((id, index) => ({ id, type: "파일 업로드", label: "자료 " + index, required: false })) } }, cookie)), 201);
  const pub = await ok(await formAction(req("/forms/" + form.id + "/publish", "POST", { version: form.version }, cookie)), 201);
  const file = await ok(await publicPost(req("/public/forms/" + pub.token + "/uploads", "POST", { questionId: first, name: "합성 증빙.txt", mime: "text/plain", size: bytes.length, sha256: sha256(bytes) })), 201);
  await ok(await uploadPut(new Request(origin + "/api/v1/uploads/" + file.id + "/content", { method: "PUT", headers: { origin, "content-type": "text/plain", "x-upload-token": file.uploadToken }, body: new Uint8Array(bytes) })));
  await ok(await uploadPost(req("/uploads/" + file.id + "/complete", "POST", undefined, "", randomUUID(), { "x-upload-token": file.uploadToken })));
  const sub = await ok(await publicPost(req("/public/forms/" + pub.token + "/submissions", "POST", { consent: true,
    answers: { [first]: file.id }, attachments: { [first]: { fileId: file.id, token: file.uploadToken } } })), 201);
  const binding = { submissionId: sub.id as string, questionId: first };
  return { company, user, cookie, ctx, serviceId, first, second, form, pub, file, sub, binding };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function viewer(f: Fixture) {
  const versionId = (await db.form.findUniqueOrThrow({ where: { id: f.form.id } })).publishedVersionId;
  const grant = await ok(await shareCreate(req("/share-grants", "POST", { formId: f.form.id, formVersionId: versionId,
    email: "file-viewer@catchsecu.test", questionIds: [f.first], expiresAt: new Date(Date.now() + 86400000).toISOString() }, f.cookie)), 201);
  const mail = decrypt<{ to: string; text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + grant.id + ":invite:1" } })).payloadCipher);
  const challengeResponse = await viewerPost(req("/viewer/challenges", "POST", { email: mail.to, formCode: f.form.id,
    invitationCode: mail.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], consent: true }));
  const challenge = await ok(challengeResponse, 202);
  const challengeMail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + grant.id + ":challenge:" + challenge.id } })).payloadCipher);
  const authenticated = await viewerPost(req("/viewer/challenges/" + challenge.id + "/verify", "POST", { code: challengeMail.text.match(/인증코드: (\d{6})/)![1] }, cookieOf(challengeResponse)));
  await ok(authenticated); const cookie = cookieOf(authenticated);
  const session = await db.viewerSession.findFirstOrThrow({ where: { grantId: grant.id } });
  return { grant, session, cookie };
}
const filePath = (f: Fixture, base = "/files", action = "/download") => base + "/" + f.file.id + action + "?" + new URLSearchParams(f.binding);
async function waitForLock(client: Client, needle: string) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const result = await client.query<{ count: string }>("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1", ["%" + needle + "%"]);
    const count = Number(result.rows[0].count); if (count) return count;
    await pause(20);
  }
  return 0;
}
const directDownload = (f: Fixture) => route(async (_r, requestId) => downloadFile(f.ctx, f.file.id, f.binding, requestId))(req("/files"));
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await mkdir("docs/qa/P06-T03", { recursive: true });
  await writeFile("docs/qa/P06-T03/lock-barriers.json", JSON.stringify({ checkedAt: new Date().toISOString(), barriers }, null, 2) + "\n");
  await db.$disconnect();
});

test("로그아웃한 Context로 파일·목록·업로드 조회·변경·생성 재전송을 처리하지 않는다", async () => {
  const f = await fixture(), key = randomUUID(), input = { purpose: "service" as const, serviceId: f.serviceId, name: "미완료.txt", mime: "text/plain" as const, size: bytes.length, sha256: sha256(bytes) };
  const created = await initMemberUpload(f.ctx, input, key, randomUUID()), upload = created.body;
  await db.session.delete({ where: { id: f.ctx.session.id } });
  const calls = [() => fileMetadata(f.ctx, f.file.id, f.binding, randomUUID()), () => downloadFile(f.ctx, f.file.id, f.binding, randomUUID()),
    () => listSubmissionFiles(f.ctx, f.sub.id, 1, 20, randomUUID()), () => getUpload({ ctx: f.ctx }, upload.id),
    () => renameFile(f.ctx, upload.id, { name: "변경.txt", version: upload.version }, randomUUID()),
    () => cancelUpload({ ctx: f.ctx }, upload.id, upload.version, randomUUID()), () => initMemberUpload(f.ctx, input, key, randomUUID())];
  const audits = await db.auditEvent.count();
  for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 401 });
  expect(await db.auditEvent.count()).toBe(audits); expect(await db.fileObject.count()).toBe(2);
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } })).status).toBe("pending");
});

test.each(["expired", "email", "idle", "mfa", "password", "company"] as const)("현재 %s 상태로 바뀐 Context는 파일 메타데이터와 바이트를 읽지 않는다", async kind => {
  const f = await fixture();
  if (kind === "expired") await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() - 100) } });
  if (kind === "email") await db.user.update({ where: { id: f.user.id }, data: { emailVerified: false } });
  if (kind === "idle") await db.session.update({ where: { id: f.ctx.session.id }, data: { updatedAt: new Date(Date.now() - 31 * 60000) } });
  if (kind === "mfa") await db.securityPolicy.update({ where: { tenantId: f.company.id }, data: { requireMfa: true } });
  if (kind === "password") await db.user.update({ where: { id: f.user.id }, data: { passwordChangedAt: new Date("2020-01-01") } });
  if (kind === "company") {
    const other = await db.company.create({ data: { name: "선택한 다른 회사", publicName: "다른 회사", memberships: { create: { userId: f.user.id, role: "owner" } } } });
    await db.session.update({ where: { id: f.ctx.session.id }, data: { activeCompanyId: other.id } });
  }
  const status = ["expired", "email", "idle"].includes(kind) ? 401 : 403, audits = await db.auditEvent.count();
  await expect(fileMetadata(f.ctx, f.file.id, f.binding, randomUUID())).rejects.toMatchObject({ status });
  await expect(downloadFile(f.ctx, f.file.id, f.binding, randomUUID())).rejects.toMatchObject({ status });
  expect(await db.auditEvent.count()).toBe(audits);
});

test.each(["Session", "User"] as const)("진행 중인 %s 회수 변경이 커밋될 때까지 파일 읽기가 기다린 뒤 거부된다", async table => {
  const f = await fixture(), client = new Client({ connectionString: env.DATABASE_URL, application_name: "file-auth-barrier" }); await client.connect();
  try {
    await client.query("BEGIN");
    if (table === "Session") await client.query('DELETE FROM "Session" WHERE id=$1', [f.ctx.session.id]);
    else await client.query('UPDATE "User" SET "emailVerified"=false WHERE id=$1', [f.user.id]);
    const pending = directDownload(f), waiting = await waitForLock(client, '"' + table + '"');
    await client.query("COMMIT"); const response = await pending;
    barriers.push({ name: table, waiting, status: response.status });
    expect(waiting).toBeGreaterThan(0); expect(response.status).toBe(401);
    expect(await db.auditEvent.count({ where: { resourceId: f.file.id, action: "file.downloaded" } })).toBe(0);
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
});

test.each(["session", "retention"] as const)("파일 행 잠금 대기 중 %s 실제 기한이 지나면 바이트를 보내지 않는다", async kind => {
  const f = await fixture(), client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  const expiresAt = new Date(Date.now() + 350);
  if (kind === "session") await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt } });
  else await db.submission.update({ where: { id: f.sub.id }, data: { retentionUntil: expiresAt, version: { increment: 1 } } });
  try {
    await client.query("BEGIN"); await client.query('SELECT id FROM "FileObject" WHERE id=$1 FOR UPDATE', [f.file.id]);
    const pending = directDownload(f), waiting = await waitForLock(client, '"FileObject"');
    await pause(Math.max(0, expiresAt.getTime() - Date.now() + 50)); await client.query("COMMIT"); const response = await pending;
    barriers.push({ name: "file-wait-" + kind, waiting, status: response.status });
    expect(waiting).toBeGreaterThan(0); expect(response.status).toBe(kind === "session" ? 401 : 410);
    expect(await db.auditEvent.count({ where: { resourceId: f.file.id, action: "file.downloaded" } })).toBe(0);
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
});

test.each(["private-session", "shared-session", "shared-grant", "shared-retention"] as const)("실제 저장소 읽기 중 %s 기한이 지나면 감사 기록과 파일 응답을 모두 취소한다", async kind => {
  const f = await fixture(), v = kind === "private-session" ? null : await viewer(f), expiresAt = new Date(Date.now() + 350);
  if (kind === "private-session") await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt } });
  if (kind === "shared-session") await db.viewerSession.update({ where: { id: v!.session.id }, data: { expiresAt } });
  if (kind === "shared-grant") await db.shareGrant.update({ where: { id: v!.grant.id }, data: { expiresAt, version: { increment: 1 } } });
  // A changed grant invalidates the old session by version; create a session for that current version before reading.
  if (kind === "shared-grant") await db.viewerSession.update({ where: { id: v!.session.id }, data: { grantVersion: v!.grant.version + 1 } });
  if (kind === "shared-retention") await db.submission.update({ where: { id: f.sub.id }, data: { retentionUntil: expiresAt, version: { increment: 1 } } });
  const read = privateFiles.read.bind(privateFiles), audits = await db.auditEvent.count(); let readRealBytes = false;
  vi.spyOn(privateFiles, "read").mockImplementation(async key => {
    const actual = await read(key); expect(actual).toEqual(bytes); readRealBytes = true;
    await pause(Math.max(0, expiresAt.getTime() - Date.now() + 50)); return actual;
  });
  const response = kind === "private-session" ? await directDownload(f) : await viewerGet(req(filePath(f, "/viewer/files"), "GET", undefined, v!.cookie));
  expect(readRealBytes).toBe(true); expect(response.status).toBe(kind === "shared-retention" ? 410 : 401);
  expect(await db.auditEvent.count()).toBe(audits);
});

test("응답·질문·파일의 정확한 조합과 중복 없는 쿼리만 개인·공유 경로에 허용한다", async () => {
  const f = await fixture(), v = await viewer(f);
  for (const [handler, base, cookie] of [[fileGet, "/files", f.cookie], [viewerGet, "/viewer/files", v.cookie]] as const) {
    expect((await handler(req(filePath(f, base, ""), "GET", undefined, cookie))).status).toBe(200);
    const response = await handler(req(filePath(f, base), "GET", undefined, cookie)); expect(response.status).toBe(200);
    expect(sha256(Buffer.from(await response.arrayBuffer()))).toBe(sha256(bytes));
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("content-security-policy")).toContain("sandbox");
    for (const url of [filePath(f, base).replace(f.first, f.second), filePath(f, base).replace(f.sub.id, randomUUID()), filePath(f, base).replace(f.file.id, randomUUID())])
      expect((await handler(req(url, "GET", undefined, cookie))).status).toBe(404);
    for (const suffix of ["&submissionId=" + f.sub.id, "&questionId=" + f.second, "&token=ignored"]) expect((await handler(req(filePath(f, base) + suffix, "GET", undefined, cookie))).status).toBe(422);
  }
});

test("공유 발급자의 이메일 인증 회수도 이미 인증한 열람자의 파일을 차단한다", async () => {
  const f = await fixture(), v = await viewer(f);
  expect((await viewerGet(req(filePath(f, "/viewer/files"), "GET", undefined, v.cookie))).status).toBe(200);
  await db.user.update({ where: { id: f.user.id }, data: { emailVerified: false } });
  expect((await viewerGet(req(filePath(f, "/viewer/files"), "GET", undefined, v.cookie))).status).toBe(401);
});

test.each(["member-session", "public-upload"] as const)("파일 저장 중 %s 기한이 지나면 업로드 DB 변경과 감사 기록을 롤백한다", async kind => {
  const f = await fixture();
  const metadata = { name: "저장 경계.txt", mime: "text/plain" as const, size: bytes.length, sha256: sha256(bytes) };
  const upload = kind === "member-session" ? (await initMemberUpload(f.ctx, { ...metadata, purpose: "service", serviceId: f.serviceId }, randomUUID(), randomUUID())).body :
    await ok(await publicPost(req("/public/forms/" + f.pub.token + "/uploads", "POST", { ...metadata, questionId: f.first })), 201);
  const expiresAt = new Date(Date.now() + 350);
  if (kind === "member-session") await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt } });
  else await db.fileObject.update({ where: { id: upload.id }, data: { expiresAt, version: { increment: 1 } } });
  const before = await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } }), audits = await db.auditEvent.count(), write = privateFiles.write.bind(privateFiles);
  vi.spyOn(privateFiles, "write").mockImplementation(async (key, value) => { await write(key, value); await pause(Math.max(0, expiresAt.getTime() - Date.now() + 50)); });
  const request = new Request(origin + "/api/v1/uploads/" + upload.id + "/content", { method: "PUT", headers: { origin, "content-type": "text/plain" }, body: new Uint8Array(bytes) });
  const principal = kind === "member-session" ? { ctx: f.ctx } : { token: upload.uploadToken as string };
  await expect(uploadContent(principal, upload.id, request, randomUUID())).rejects.toMatchObject({ status: kind === "member-session" ? 401 : 410 });
  expect(await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } })).toEqual(before); expect(await db.auditEvent.count()).toBe(audits);
  // A failed transaction may have written a private object; it remains inaccessible and is removed without touching attached evidence.
  expect(await privateFiles.read(before.storageKey)).toEqual(bytes); await privateFiles.remove(before.storageKey);
});

test("메타데이터 감사 저장이 지연되어 세션 기한이 지나도 파일 이름을 반환하지 않는다", async () => {
  const f = await fixture(), expiresAt = new Date(Date.now() + 350), count = await db.auditEvent.count(), audit = auditModule.audit;
  await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt } });
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => { const result = await audit(...args); await pause(Math.max(0, expiresAt.getTime() - Date.now() + 50)); return result; });
  await expect(fileMetadata(f.ctx, f.file.id, f.binding, randomUUID())).rejects.toMatchObject({ status: 401 });
  expect(await db.auditEvent.count()).toBe(count);
});

test.each(["single", "list"] as const)("공유 %s 감사 INSERT가 실제로 지연되어 보유 기한이 지나면 파일 이름을 반환하지 않는다", async kind => {
  const f = await fixture(), v = await viewer(f), count = await db.auditEvent.count();
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_shared_file_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('share.file_viewed','share.files_viewed') THEN PERFORM pg_sleep(0.6); END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_shared_file_delay BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_shared_file_delay()');
  try {
    await db.submission.update({ where: { id: f.sub.id }, data: { retentionUntil: new Date(Date.now() + 500), version: { increment: 1 } } });
    const url = kind === "single" ? filePath(f, "/viewer/files", "") : "/viewer/files?submissionId=" + f.sub.id;
    const response = await viewerGet(req(url, "GET", undefined, v.cookie));
    expect(response.status).toBe(410); expect(await db.auditEvent.count()).toBe(count);
    expect(await response.text()).not.toContain("합성 증빙.txt");
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER qa_shared_file_delay ON "AuditEvent"');
    await db.$executeRawUnsafe('DROP FUNCTION qa_shared_file_delay()');
  }
});
