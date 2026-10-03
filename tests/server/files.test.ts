import { randomUUID } from "node:crypto";
import { readFile, lstat, symlink, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, test, expect, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { tokenHash, decrypt } from "@/server/crypto";
import { cleanupExpiredFiles } from "@/server/files";
import { privateFiles } from "@/server/file-storage";
import { requireFileScanner } from "@/server/file-scanner";
import { sha256, validateFileBytes } from "@/server/file-validation";
import { MAX_FILE_BYTES } from "@/contracts/files";
import type { Role } from "@/generated/prisma/client";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as uploadPost, GET as uploadGet, PUT as uploadPut, DELETE as uploadDelete } from "@/app/api/v1/uploads/[...segments]/route";
import { GET as fileGet, PATCH as filePatch, DELETE as fileDelete } from "@/app/api/v1/files/[...segments]/route";
import { GET as fileList } from "@/app/api/v1/files/route";
import { GET as submissionGet, PATCH as submissionPatch } from "@/app/api/v1/submissions/[...segments]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, password = "File-test-password!123";
const tenant = randomUUID(), foreignTenant = randomUUID(), service = randomUUID(), hiddenService = randomUUID();
const cookies: Record<string, string> = {}, users: Record<string, string> = {}, members: Record<string, string> = {};
const safe = Buffer.from("개인정보 첨부파일 QA 자료입니다.\\n" + randomUUID());
const eicar = Buffer.from("X5O!P%@AP[4" + String.fromCharCode(92) + "PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
function req(path: string, method = "GET", who = "owner", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method,
    headers: { origin, cookie: cookies[who] ?? "", ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function rawReq(id: string, bytes: Buffer, uploadToken?: string, who = "anonymous", mime = "text/plain", headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1/uploads/" + id + "/content", { method: "PUT", body: new Uint8Array(bytes),
    headers: { origin, cookie: cookies[who] ?? "", "content-type": mime, ...(uploadToken ? { "x-upload-token": uploadToken } : {}), ...headers } });
}
function meta(bytes = safe, name = "확인 자료.txt", mime = "text/plain") { return { name, mime, size: bytes.length, sha256: sha256(bytes) }; }
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
async function signup(role: Role, company = tenant, name: string = role) {
  await db.rateLimit.deleteMany();
  const email = name + "@files.test.local";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } }); users[name] = user.id;
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company, userId: user.id, role } }); members[name] = member.id;
  if (company === tenant) await db.serviceGrant.create({ data: { tenantId: tenant, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password }));
  expect(login.status).toBe(200); cookies[name] = cookieOf(login);
}
beforeAll(async () => {
  await requireFileScanner();
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreignTenant]) await db.company.create({ data: { id, name: id, publicName: id, policy: { create: {} } } });
  await db.service.createMany({ data: [{ id: service, tenantId: tenant, name: "파일 서비스", externalName: "파일 서비스" }, { id: hiddenService, tenantId: tenant, name: "별도 서비스", externalName: "별도 서비스" }] });
  await signup("owner"); await signup("privacy"); await signup("editor"); await signup("viewer"); await signup("owner", foreignTenant, "foreign");
});
beforeEach(async () => { await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

async function publication() {
  const first = randomUUID(), second = randomUUID(), textQuestion = randomUUID();
  const content = { body: "첨부파일 통합 검증", consentRequired: true, consentPurpose: "첨부파일 확인", retentionDays: 30, maxResponses: 100,
    questions: [{ id: first, type: "파일 업로드", label: "증빙 자료", required: true },
      { id: second, type: "파일 업로드", label: "추가 파일", required: false },
      { id: textQuestion, type: "단문형 답변", label: "참가자", required: false }] };
  const create = await formCreate(req("/forms", "POST", "owner", { title: "파일 검증 " + randomUUID(), serviceId: service, content }, { "idempotency-key": randomUUID() }));
  expect(create.status).toBe(201); const form = await create.json();
  const publish = await formAction(req("/forms/" + form.id + "/publish", "POST", "owner", { version: form.version }, { "idempotency-key": randomUUID() }));
  expect(publish.status).toBe(201); return { ...(await publish.json()), formId: form.id, first, second, textQuestion };
}
type Publication = Awaited<ReturnType<typeof publication>>;
type Upload = { id: string; uploadToken?: string; version: number; status: string };
async function init(pub: Publication, bytes = safe, questionId = pub.first, overrides: Record<string, unknown> = {}, key = randomUUID()) {
  return publicPost(req("/public/forms/" + pub.token + "/uploads", "POST", "anonymous", { ...meta(bytes), questionId, ...overrides }, { "idempotency-key": key }));
}
async function ready(pub: Publication, bytes = safe, questionId = pub.first): Promise<Upload> {
  const response = await init(pub, bytes, questionId); expect(response.status).toBe(201); const file = await response.json();
  expect((await uploadPut(rawReq(file.id, bytes, file.uploadToken))).status).toBe(200);
  const complete = await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": file.uploadToken }));
  expect(complete.status).toBe(200); return { ...file, ...(await complete.json()) };
}
async function submit(pub: Publication, file: Upload, key = randomUUID(), overrides: Record<string, unknown> = {}) {
  return publicPost(req("/public/forms/" + pub.token + "/submissions", "POST", "anonymous",
    { answers: { [pub.first]: file.id }, consent: true, attachments: { [pub.first]: { fileId: file.id, token: file.uploadToken } }, ...overrides }, { "idempotency-key": key }));
}
const fileUrl = (file: Upload, sub: { id: string }, pub: Publication) => "/files/" + file.id + "/download?submissionId=" + sub.id + "&questionId=" + pub.first;

describe("private attachment storage with real PostgreSQL and ClamAV", () => {
  test("public file bytes are encrypted, scanned, attached once, and downloaded byte-for-byte with private headers", async () => {
    const pub = await publication(), file = await ready(pub), key = randomUUID();
    const stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    expect(stored.scanStatus).toBe("clean"); expect(stored.scanEngine).toMatch(/^ClamAV 1\.5\.4\//);
    expect(stored.nameCipher).not.toContain("확인 자료"); expect(decrypt(stored.nameCipher!)).toBe("확인 자료.txt");
    expect(stored.uploadTokenHash).toBe(tokenHash(file.uploadToken!));
    const disk = resolve(env.PRIVATE_STORAGE_DIR, "objects", stored.storageKey + ".enc"), encrypted = await readFile(disk);
    expect(encrypted.subarray(0, 4).toString()).toBe("CSF1"); expect(encrypted.includes(safe)).toBe(false);
    expect((await lstat(disk)).mode & 0o777).toBe(0o600); expect((await lstat(resolve(env.PRIVATE_STORAGE_DIR, "objects"))).mode & 0o777).toBe(0o700);
    expect((await fileGet(req("/files/" + file.id + "/download", "GET", "anonymous", undefined, { "x-upload-token": file.uploadToken! }))).status).toBe(401);
    const created = await submit(pub, file, key); expect(created.status).toBe(201); const sub = await created.json();
    expect(await (await submit(pub, file, key)).json()).toEqual(sub);
    expect((await submit(pub, file)).status).toBe(422);
    const response = await fileGet(req(fileUrl(file, sub, pub), "GET", "privacy"));
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(safe);
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect((await uploadGet(req("/uploads/" + file.id, "GET", "anonymous", undefined, { "x-upload-token": file.uploadToken! }))).status).toBe(404);
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).uploadTokenHash).toBeNull();
    const detail = await (await submissionGet(req("/submissions/" + sub.id, "GET", "privacy"))).json();
    expect(detail.attachments).toHaveLength(1); expect(detail.attachments[0].name).toBe("확인 자료.txt");
    const audit = JSON.stringify(await db.auditEvent.findMany({ where: { resourceId: file.id } }));
    expect(audit).not.toContain(file.uploadToken); expect(audit).not.toContain("확인 자료"); expect(audit).not.toContain(safe.toString());
  });
  test("read access checks tenant, role, service, response and question together", async () => {
    const pub = await publication(), file = await ready(pub), sub = await (await submit(pub, file)).json(), url = fileUrl(file, sub, pub);
    expect((await fileGet(req(url, "GET", "foreign"))).status).toBe(404);
    expect((await fileGet(req(url, "GET", "viewer"))).status).toBe(403);
    expect((await fileGet(req(url, "GET", "editor"))).status).toBe(403);
    expect((await fileGet(req(url.replace(pub.first, pub.second)))).status).toBe(404);
    expect((await fileGet(req(url.replace(sub.id, randomUUID())))).status).toBe(404);
    expect((await fileGet(req("/files/" + file.id + "/download"))).status).toBe(404);
    const grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.privacy, serviceId: service } } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities.filter(value => value !== "file.read") } });
    expect((await fileGet(req(url, "GET", "privacy"))).status).toBe(403);
    const detail = await (await submissionGet(req("/submissions/" + sub.id, "GET", "privacy"))).json(); expect(detail.attachments).toEqual([]);
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } });
    expect((await fileList(req("/files?submissionId=" + sub.id, "GET", "privacy"))).status).toBe(200);
  });
  test("filenames, MIME, integrity and streamed size are validated before persistence", async () => {
    const pub = await publication();
    for (const overrides of [{ name: "../secret.txt" }, { name: "bad.exe" }, { size: MAX_FILE_BYTES + 1 }, { size: 0 }, { mime: "text/html" }])
      expect((await init(pub, safe, pub.first, overrides)).status).toBe(422);
    const file = await (await init(pub)).json();
    expect((await uploadPut(rawReq(file.id, Buffer.from("wrong"), file.uploadToken))).status).toBe(422);
    expect((await uploadPut(rawReq(file.id, Buffer.alloc(safe.length + 1), file.uploadToken))).status).toBe(413);
    expect((await uploadPut(rawReq(file.id, safe, file.uploadToken, "anonymous", "image/png"))).status).toBe(415);
    expect((await uploadPut(rawReq(file.id, safe, file.uploadToken, "anonymous", "text/plain", { origin: "https://attacker.invalid" }))).status).toBe(403);
    expect((await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": file.uploadToken }))).status).toBe(409);
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("pending");
    const disguised = await (await init(pub, safe, pub.first, { name: "fake.png", mime: "image/png" })).json();
    expect((await uploadPut(rawReq(disguised.id, safe, disguised.uploadToken, "anonymous", "image/png"))).status).toBe(422);
    const invalidText = Buffer.from([0xff, 0xfe]);
    const bad = await (await init(pub, invalidText)).json(); expect((await uploadPut(rawReq(bad.id, invalidText, bad.uploadToken))).status).toBe(422);
  });
  test("EICAR is rejected by the real scanner and no infected bytes become downloadable", async () => {
    expect(eicar.length).toBe(68);
    const pub = await publication(), response = await init(pub, eicar), file = await response.json();
    expect(response.status).toBe(201); expect((await uploadPut(rawReq(file.id, eicar, file.uploadToken))).status).toBe(200);
    const scanned = await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": file.uploadToken }));
    expect(scanned.status).toBe(422); expect((await scanned.json()).error.code).toBe("FILE_UNSAFE");
    const row = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    expect(row).toMatchObject({ status: "rejected", scanStatus: "infected" });
    await expect(privateFiles.read(row.storageKey)).rejects.toThrow(); expect((await submit(pub, file)).status).toBe(422);
  });
  test("unavailable and stale scanners fail closed, and uploaded files can resume after recovery", async () => {
    const pub = await publication(), file = await (await init(pub)).json();
    await uploadPut(rawReq(file.id, safe, file.uploadToken));
    const socket = env.CLAMAV_SOCKET; env.CLAMAV_SOCKET = "/nonexistent/catchsecu-scanner.sock";
    try {
      expect((await init(pub)).status).toBe(503);
      expect((await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": file.uploadToken }))).status).toBe(503);
      expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } }))).toMatchObject({ status: "uploaded", scanStatus: "error" });
    } finally { env.CLAMAV_SOCKET = socket; }
    const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now + 8 * 86400000);
    try { await expect(requireFileScanner()).rejects.toMatchObject({ code: "FILE_SCANNER_OUTDATED" }); } finally { clock.mockRestore(); }
    expect((await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": file.uploadToken }))).status).toBe(200);
  });
  test("upload initialization is idempotent and mismatched keys, question types, and closed publications are rejected", async () => {
    const pub = await publication(), key = randomUUID();
    const results = await Promise.all([init(pub, safe, pub.first, {}, key), init(pub, safe, pub.first, {}, key)]);
    expect(results.map(row => row.status)).toEqual([201, 201]);
    expect(await results[0].json()).toEqual(await results[1].json());
    expect((await init(pub, safe, pub.first, { name: "changed.txt" }, key)).status).toBe(409);
    expect((await init(pub, safe, pub.textQuestion)).status).toBe(422);
    await db.publication.update({ where: { id: pub.id }, data: { status: "revoked" } });
    expect((await init(pub)).status).toBe(410);
  });
  test("question and publication proofs cannot be swapped and a proof cannot be consumed concurrently twice", async () => {
    const pub = await publication(), other = await publication(), wrongQuestion = await ready(pub, safe, pub.second);
    expect((await submit(pub, wrongQuestion)).status).toBe(422);
    expect((await submit(other, await ready(pub))).status).toBe(422);
    const file = await ready(pub);
    expect((await submit(pub, file, randomUUID(), { attachments: {} })).status).toBe(422);
    expect((await submit(pub, { ...file, uploadToken: "A".repeat(43) })).status).toBe(422);
    const responses = await Promise.all([submit(pub, file), submit(pub, file)]);
    expect(responses.map(row => row.status).sort()).toEqual([201, 422]);
    expect(await db.submission.count({ where: { publicationId: pub.id } })).toBe(1);
  });
  test("cancellation removes stored bytes and metadata; expired uploads are recovered by the cleanup worker", async () => {
    const pub = await publication(), file = await ready(pub);
    const stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    expect((await uploadDelete(req("/uploads/" + file.id, "DELETE", "anonymous", undefined, { "x-upload-token": file.uploadToken!, "if-match": "1" }))).status).toBe(409);
    expect((await uploadDelete(req("/uploads/" + file.id, "DELETE", "anonymous", undefined, { "x-upload-token": file.uploadToken!, "if-match": String(file.version) }))).status).toBe(204);
    expect(await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ status: "deleted", nameCipher: null, sha256: null, size: 0, uploadTokenHash: null });
    await expect(privateFiles.read(stored.storageKey)).rejects.toThrow();
    const expired = await ready(pub), expireRow = await db.fileObject.findUniqueOrThrow({ where: { id: expired.id } });
    await db.fileObject.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000), version: { increment: 1 } } });
    expect((await submit(pub, expired)).status).toBe(422);
    expect((await cleanupExpiredFiles()).deleted).toBeGreaterThanOrEqual(1);
    await expect(privateFiles.read(expireRow.storageKey)).rejects.toThrow();
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe("deleted");
  });
  test("a member can rename and delete an unbound upload but other members and tenants cannot take it over", async () => {
    const request = { purpose: "service", serviceId: service, ...meta() };
    const response = await uploadPost(req("/uploads/init", "POST", "editor", request, { "idempotency-key": randomUUID() }));
    expect(response.status).toBe(201); const file = await response.json();
    expect((await uploadPut(rawReq(file.id, safe, undefined, "owner"))).status).toBe(404);
    expect((await uploadPut(rawReq(file.id, safe, undefined, "foreign"))).status).toBe(404);
    expect((await uploadPut(rawReq(file.id, safe, undefined, "editor"))).status).toBe(200);
    const readyResponse = await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "editor"));
    expect(readyResponse.status).toBe(200); const readyFile = await readyResponse.json();
    const renamed = await filePatch(req("/files/" + file.id, "PATCH", "editor", { name: "이름 변경.txt", version: readyFile.version }));
    expect(renamed.status).toBe(200); expect((await renamed.json()).name).toBe("이름 변경.txt");
    expect((await fileGet(req("/files/" + file.id + "/download", "GET", "editor"))).status).toBe(200);
    expect((await fileDelete(req("/files/" + file.id, "DELETE", "editor", undefined, { "if-match": String(readyFile.version + 1) }))).status).toBe(204);
    expect((await uploadPost(req("/uploads/init", "POST", "editor", { ...request, serviceId: hiddenService }, { "idempotency-key": randomUUID() }))).status).toBe(403);
  });
  test("privacy member replacement preserves old evidence and rejects cross-response files, legal holds, and attached deletion", async () => {
    const pub = await publication(), file = await ready(pub), sub = await (await submit(pub, file)).json(), bytes = Buffer.from("정정된 증빙");
    const replacement = await uploadPost(req("/uploads/init", "POST", "privacy", { purpose: "submission", submissionId: sub.id, questionId: pub.first, ...meta(bytes) }, { "idempotency-key": randomUUID() }));
    expect(replacement.status).toBe(201); const next = await replacement.json();
    expect((await uploadPut(rawReq(next.id, bytes, undefined, "privacy"))).status).toBe(200);
    expect((await uploadPost(req("/uploads/" + next.id + "/complete", "POST", "privacy"))).status).toBe(200);
    const corrected = await submissionPatch(req("/submissions/" + sub.id, "PATCH", "privacy", { version: 1, reason: "실제 첨부 정정", answers: { [pub.first]: next.id } }));
    expect(corrected.status).toBe(200);
    expect((await fileGet(req(fileUrl(file, sub, pub), "GET", "privacy"))).status).toBe(200);
    const downloaded = await fileGet(req(fileUrl(next, sub, pub), "GET", "privacy")); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    const detail = await (await submissionGet(req("/submissions/" + sub.id, "GET", "privacy"))).json();
    expect(detail.attachments).toHaveLength(2); expect(detail.corrections[0].before[pub.first]).toBe(file.id);
    const another = await (await submit(pub, await ready(pub))).json();
    expect((await submissionPatch(req("/submissions/" + another.id, "PATCH", "privacy", { version: 1, reason: "다른 응답", answers: { [pub.first]: next.id } }))).status).toBe(422);
    expect((await fileDelete(req("/files/" + next.id, "DELETE", "privacy", undefined, { "if-match": "4" }))).status).toBe(409);
    await db.submission.update({ where: { id: sub.id }, data: { legalHold: true } });
    expect((await uploadPost(req("/uploads/init", "POST", "privacy", { purpose: "submission", submissionId: sub.id, questionId: pub.first, ...meta() }, { "idempotency-key": randomUUID() }))).status).toBe(409);
    expect((await submissionPatch(req("/submissions/" + sub.id, "PATCH", "privacy", { version: 2, reason: "보존 파일 변경", answers: { [pub.first]: file.id } }))).status).toBe(409);
  });
  test("retention expiry blocks file bytes while legal hold keeps authorized evidence accessible", async () => {
    const pub = await publication(), file = await ready(pub), sub = await (await submit(pub, file)).json();
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    expect((await fileGet(req(fileUrl(file, sub, pub)))).status).toBe(410);
    await db.submission.update({ where: { id: sub.id }, data: { legalHold: true } });
    expect((await fileGet(req(fileUrl(file, sub, pub)))).status).toBe(200);
  });
  test("encrypted object paths reject traversal, symlinks and authenticated ciphertext copied under another key", async () => {
    await expect(privateFiles.read("../escape")).rejects.toThrow();
    const first = randomUUID(), second = randomUUID(); await privateFiles.write(first, safe);
    const dir = resolve(env.PRIVATE_STORAGE_DIR, "objects");
    await symlink(join(dir, first + ".enc"), join(dir, second + ".enc"));
    try { await expect(privateFiles.read(second)).rejects.toThrow(); } finally { await unlink(join(dir, second + ".enc")); }
    const { copyFile } = await import("node:fs/promises");
    await copyFile(join(dir, first + ".enc"), join(dir, second + ".enc"));
    await expect(privateFiles.read(second)).rejects.toThrow();
    await privateFiles.remove(first); await privateFiles.remove(second);
  });
  test("quota reservations serialize concurrent requests and prevent oversubscription", async () => {
    const pub = await publication(), used = (await db.fileObject.aggregate({ where: { tenantId: tenant, status: { not: "deleted" } }, _sum: { size: true } }))._sum.size ?? 0;
    const quota = env.FILE_TENANT_QUOTA_BYTES; env.FILE_TENANT_QUOTA_BYTES = used + safe.length;
    try {
      const responses = await Promise.all([init(pub), init(pub)]);
      expect(responses.map(row => row.status).sort()).toEqual([201, 409]);
    } finally { env.FILE_TENANT_QUOTA_BYTES = quota; }
  });
  test("the 10MB boundary succeeds and the database rejects tampered status, binding and immutable bytes", async () => {
    const pub = await publication(), bytes = Buffer.alloc(MAX_FILE_BYTES, 65), file = await ready(pub, bytes);
    expect((await submit(pub, file)).status).toBe(201);
    await expect(db.fileObject.update({ where: { id: file.id }, data: { sha256: "0".repeat(64), version: { increment: 1 } } })).rejects.toThrow();
    await expect(db.fileObject.update({ where: { id: file.id }, data: { serviceId: hiddenService, version: { increment: 1 } } })).rejects.toThrow();
    await expect(db.fileObject.update({ where: { id: file.id }, data: { tenantId: foreignTenant, version: { increment: 1 } } })).rejects.toThrow();
    await expect(db.fileObject.update({ where: { id: file.id }, data: { status: "pending", version: { increment: 1 } } })).rejects.toThrow();
    expect(() => validateFileBytes(Buffer.alloc(MAX_FILE_BYTES + 1), { ...meta(), size: MAX_FILE_BYTES + 1 })).toThrow();
  });
  test("a failed physical deletion stays inaccessible and cleanup retries after storage recovery", async () => {
    const pub = await publication(), file = await ready(pub), originalDir = env.PRIVATE_STORAGE_DIR;
    const link = resolve(".local", "file-test-symlink-" + randomUUID());
    await symlink(resolve(originalDir), link); env.PRIVATE_STORAGE_DIR = link;
    try {
      const response = await uploadDelete(req("/uploads/" + file.id, "DELETE", "anonymous", undefined, { "x-upload-token": file.uploadToken!, "if-match": String(file.version) }));
      expect(response.status).toBe(503);
      expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("deleting");
      expect((await fileGet(req("/files/" + file.id + "/download"))).status).toBe(409);
      expect((await cleanupExpiredFiles()).retry).toBeGreaterThanOrEqual(1);
    } finally { env.PRIVATE_STORAGE_DIR = originalDir; await unlink(link); }
    expect((await cleanupExpiredFiles()).deleted).toBeGreaterThanOrEqual(1);
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("deleted");
  });
  test("cancellation versus submission commits one outcome without an attachment pointing to deleted bytes", async () => {
    const pub = await publication(), file = await ready(pub);
    const results = await Promise.all([submit(pub, file), uploadDelete(req("/uploads/" + file.id, "DELETE", "anonymous", undefined,
      { "x-upload-token": file.uploadToken!, "if-match": String(file.version) }))]);
    const stored = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    if (results[0].status === 201) {
      expect([404, 409]).toContain(results[1].status); expect(stored.status).toBe("attached");
      expect(await privateFiles.read(stored.storageKey)).toEqual(safe);
    } else {
      expect(results[0].status).toBe(422); expect(results[1].status).toBe(204); expect(stored.status).toBe("deleted");
      expect(await db.submission.count({ where: { publicationId: pub.id } })).toBe(0);
    }
  });
  test("unsubmitted files never download and revoked or expired publications cannot receive upload bytes", async () => {
    const pub = await publication(), file = await ready(pub);
    expect((await fileGet(req("/files/" + file.id + "/download"))).status).toBe(409);
    await db.publication.update({ where: { id: pub.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await uploadPut(rawReq(file.id, safe, file.uploadToken))).status).toBe(410);
    expect((await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": file.uploadToken! }))).status).toBe(410);
    expect((await submit(pub, file)).status).toBe(410);
  });
  test("repeated PUT and complete keep one encrypted object and one scan result", async () => {
    const pub = await publication(), created = await (await init(pub)).json();
    const uploadResults = await Promise.all([uploadPut(rawReq(created.id, safe, created.uploadToken)), uploadPut(rawReq(created.id, safe, created.uploadToken))]);
    expect(uploadResults.map(item => item.status)).toEqual([200, 200]);
    const scanResults = await Promise.all([0, 1].map(() => uploadPost(req("/uploads/" + created.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": created.uploadToken }))));
    expect(scanResults.map(item => item.status)).toEqual([200, 200]);
    expect(await scanResults[0].json()).toEqual(await scanResults[1].json());
    expect(await db.auditEvent.count({ where: { resourceId: created.id, action: "file.scan_passed" } })).toBe(1);
  });
  test("PDF, PNG, JPEG and UTF-8 CSV signatures are checked and downloaded without byte conversion", async () => {
    const samples = [
      { name: "proof.png", mime: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=", "base64") },
      { name: "proof.jpg", mime: "image/jpeg", bytes: Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]) },
      { name: "proof.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4\\n1 0 obj<</Type/Catalog>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF\\n") },
      { name: "proof.csv", mime: "text/csv", bytes: Buffer.from("name,value\\nQA,verified\\n") },
    ];
    for (const sample of samples) {
      const response = await uploadPost(req("/uploads/init", "POST", "editor", { purpose: "service", serviceId: service, ...meta(sample.bytes, sample.name, sample.mime) }, { "idempotency-key": randomUUID() }));
      expect(response.status).toBe(201); const file = await response.json();
      expect((await uploadPut(rawReq(file.id, sample.bytes, undefined, "editor", sample.mime))).status).toBe(200);
      expect((await uploadPost(req("/uploads/" + file.id + "/complete", "POST", "editor"))).status).toBe(200);
      const downloaded = await fileGet(req("/files/" + file.id + "/download", "GET", "editor"));
      expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(sample.bytes);
    }
  });

});
