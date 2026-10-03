import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, test, expect, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { encrypt } from "@/server/crypto";
import { privateFiles } from "@/server/file-storage";
import { sha256 } from "@/server/file-validation";
import { expireIdempotencyResponses, idempotent } from "@/server/idempotency";
import { claimDestruction, enqueueExpiredSubmissions, runOneDestruction } from "@/server/destruction-worker";
import { certificateDigest, destructionQuery, listDestructions } from "@/server/destruction";
import { requireContext } from "@/server/context";
import { getSubmission as readSubmission } from "@/server/submission-management";
import type { Role } from "@/generated/prisma/client";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { POST as actForm, GET as getForm } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as postUpload, PUT as putUpload } from "@/app/api/v1/uploads/[...segments]/route";
import { GET as getFile } from "@/app/api/v1/files/[...segments]/route";
import { GET as getSubmission, PATCH as patchSubmission, POST as postSubmission } from "@/app/api/v1/submissions/[...segments]/route";
import { GET as listRequests } from "@/app/api/v1/destruction-requests/route";
import { POST as actionRequest } from "@/app/api/v1/destruction-requests/[...segments]/route";
import { GET as listCertificates } from "@/app/api/v1/destruction-certificates/route";
import { GET as getCertificate } from "@/app/api/v1/destruction-certificates/[...segments]/route";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ok(response: Response, status = 200) {
  expect(response.status, response.status >= 400 ? (await response.clone().json()).error?.code : "").toBe(status);
  return response.json();
}
async function signup(name: string, role: Role, company = tenant) {
  await db.rateLimit.deleteMany();
  const email = name + "@destruction.test.local", password = "Destruction-test-password!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company, userId: user.id, role } }); members[name] = member.id;
  if (company === tenant) await db.serviceGrant.create({ data: { tenantId: tenant, memberId: member.id, serviceId: service, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password }));
  expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: id, publicName: id, policy: { create: {} } } });
  await db.service.create({ data: { id: service, tenantId: tenant, name: "파기 시험 서비스", externalName: "파기 시험 서비스" } });
  await signup("owner", "owner"); await signup("admin", "admin"); await signup("privacy", "privacy"); await signup("viewer", "viewer"); await signup("foreign", "owner", foreign);
});
beforeEach(async () => {
  vi.restoreAllMocks(); await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany();
  await db.securityPolicy.update({ where: { tenantId: tenant }, data: { automaticDestruction: false, allowRetentionAdjustment: false } });
  await db.membership.update({ where: { id: members.admin }, data: { role: "admin" } });
});
afterAll(async () => { await db.$disconnect(); });
async function response(withFile = false) {
  const questionId = randomUUID(), fileQuestion = randomUUID(), privateValue = "지울 응답 " + randomUUID(), bytes = Buffer.from("삭제할 합성 첨부 " + randomUUID());
  const content = { body: "보유 기한과 실제 파기 검증", consentRequired: true, consentPurpose: "합성 자료 처리", retentionDays: 30, maxResponses: 100,
    questions: [{ id: questionId, type: "단문형 답변", label: "확인 값", required: true },
      ...(withFile ? [{ id: fileQuestion, type: "파일 업로드", label: "증빙", required: true }] : [])] };
  const form = await ok(await createForm(req("/forms", "POST", "owner", { title: "파기 시험 " + randomUUID(), serviceId: service, content }, { "idempotency-key": randomUUID() })), 201);
  const pub = await ok(await actForm(req("/forms/" + form.id + "/publish", "POST", "owner", { version: form.version }, { "idempotency-key": randomUUID() })), 201);
  let file: { id: string; uploadToken: string } | undefined;
  if (withFile) {
    file = await ok(await publicPost(req("/public/forms/" + pub.token + "/uploads", "POST", "anonymous",
      { questionId: fileQuestion, name: "파기 확인.txt", mime: "text/plain", size: bytes.length, sha256: sha256(bytes) }, { "idempotency-key": randomUUID() })), 201);
    expect((await putUpload(new Request(origin + "/api/v1/uploads/" + file!.id + "/content", { method: "PUT", body: bytes,
      headers: { origin, "content-type": "text/plain", "x-upload-token": file!.uploadToken } }))).status).toBe(200);
    expect((await postUpload(req("/uploads/" + file!.id + "/complete", "POST", "anonymous", undefined, { "x-upload-token": file!.uploadToken }))).status).toBe(200);
  }
  const key = randomUUID(), input = { answers: { [questionId]: privateValue, ...(file ? { [fileQuestion]: file.id } : {}) }, consent: true,
    ...(file ? { attachments: { [fileQuestion]: { fileId: file.id, token: file.uploadToken } } } : {}) };
  const sub = await ok(await publicPost(req("/public/forms/" + pub.token + "/submissions", "POST", "anonymous", input, { "idempotency-key": key })), 201);
  return { id: sub.id as string, questionId, fileQuestion, formId: form.id as string, privateValue, token: pub.token as string, input, key, file, bytes };
}
async function requestDestruction(id: string, who = "privacy") {
  const row = await db.submission.findUniqueOrThrow({ where: { id } });
  const result = await ok(await postSubmission(req("/submissions/" + id + "/destruction-request", "POST", who, { version: row.version, reason: "검증 목적 종료" })));
  return db.destructionRequest.findUniqueOrThrow({ where: { id: result.destructionId } });
}
async function act(id: string, action: string, who = "owner", extra: Record<string, unknown> = {}) {
  const row = await db.destructionRequest.findUniqueOrThrow({ where: { id } });
  return actionRequest(req("/destruction-requests/" + id + "/" + action, "POST", who, { version: row.version, reason: "합성 자료 검증", ...extra }));
}
const filePath = (key: string) => resolve(env.PRIVATE_STORAGE_DIR, "objects", key + ".enc");
describe("approved destruction with real database and private storage", () => {
  test("request, approve, erase all originals and caches, produce one immutable verified certificate", async () => {
    const sub = await response(true), noteKey = randomUUID();
    await ok(await patchSubmission(req("/submissions/" + sub.id, "PATCH", "privacy", { version: 1, reason: "정정 사유 원문",
      answers: { [sub.questionId]: "정정한 비공개 값" } })));
    await ok(await postSubmission(req("/submissions/" + sub.id + "/notes", "POST", "privacy", { text: "삭제할 담당자 메모" }, { "idempotency-key": noteKey })), 201);
    const before = await db.fileObject.findUniqueOrThrow({ where: { id: sub.file!.id } });
    expect((await readFile(filePath(before.storageKey))).length).toBeGreaterThan(0);
    const request = await requestDestruction(sub.id);
    expect(request.status).toBe("pending");
    expect(await runOneDestruction("not-approved")).toBe(false);
    expect(await db.answer.count({ where: { submissionId: sub.id } })).toBe(2);
    await ok(await act(request.id, "approve"));
    expect(await runOneDestruction("erase-originals")).toBe(true);
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.status).toBe("destroyed");
    for (const count of [await db.answer.count({ where: { submissionId: sub.id } }), await db.submissionNote.count({ where: { submissionId: sub.id } }),
      await db.correction.count({ where: { submissionId: sub.id } }), await db.consentReceipt.count({ where: { submissionId: sub.id } })]) expect(count).toBe(0);
    expect(await db.correctionPayload.count({ where: { tenantId: tenant } })).toBe(0);
    await expect(lstat(filePath(before.storageKey))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await db.fileObject.findUnique({ where: { id: before.id } })).toMatchObject({ status: "deleted", nameCipher: null, sha256: null, size: 0 });
    const caches = await db.idempotencyRecord.findMany({ where: { tenantId: tenant, resourceId: { in: [sub.id, before.id] } } });
    expect(caches).toHaveLength(3); for (const cache of caches) { expect(cache.responseCipher).toBeNull(); expect(cache.requestHash).toBeNull(); expect(cache.invalidatedAt).not.toBeNull(); }
    expect((await publicPost(req("/public/forms/" + sub.token + "/submissions", "POST", "anonymous", sub.input, { "idempotency-key": sub.key }))).status).toBe(410);
    expect((await postSubmission(req("/submissions/" + sub.id + "/notes", "POST", "privacy", { text: "삭제할 담당자 메모" }, { "idempotency-key": noteKey }))).status).toBe(410);
    const cert = await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: sub.id } });
    expect(cert.digest).toBe(certificateDigest(cert)); expect(cert.counts).toMatchObject({ answers: 2, notes: 1, files: 1, receipts: 1 });
    expect(await db.destructionRequest.findUnique({ where: { id: request.id } })).toMatchObject({ status: "completed", reasonCipher: null, decisionCipher: null });
    const detail = await ok(await getSubmission(req("/submissions/" + sub.id)));
    expect(detail).toMatchObject({ contentAvailable: false, values: {}, attachments: [], corrections: [], notes: [], receipts: [] });
    expect((await getFile(req("/files/" + before.id + "/download?submissionId=" + sub.id + "&questionId=" + sub.fileQuestion))).status).toBe(410);
    const download = await getCertificate(req("/destruction-certificates/" + cert.id + "/download"));
    expect(download.status).toBe(200); expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(await download.json()).toMatchObject({ id: cert.id, integrityVerified: true });
    await expect(db.destructionCertificate.update({ where: { id: cert.id }, data: { digest: "0".repeat(64) } })).rejects.toThrow();
    await expect(db.destructionCertificate.delete({ where: { id: cert.id } })).rejects.toThrow();
    expect(await runOneDestruction("duplicate")).toBe(false);
    expect(await db.destructionCertificate.count({ where: { submissionId: sub.id } })).toBe(1);
  });
  test("tenant, role and current service permission isolate request and certificate APIs", async () => {
    const sub = await response(), job = await requestDestruction(sub.id);
    expect((await act(job.id, "approve", "privacy")).status).toBe(403);
    expect((await act(job.id, "approve", "foreign")).status).toBe(404);
    expect((await listRequests(req("/destruction-requests", "GET", "viewer"))).status).toBe(403);
    expect((await listRequests(req("/destruction-requests", "GET", "anonymous"))).status).toBe(401);
    expect((await ok(await listRequests(req("/destruction-requests?submissionId=" + sub.id, "GET", "foreign")))).total).toBe(0);
    const grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.privacy, serviceId: service } } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: [] } });
    expect((await act(job.id, "cancel", "privacy")).status).toBe(403);
    expect((await ok(await listRequests(req("/destruction-requests?submissionId=" + sub.id, "GET", "privacy")))).total).toBe(0);
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } });
    await ok(await act(job.id, "approve")); await runOneDestruction("permissions");
    const cert = await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: sub.id } });
    expect((await getCertificate(req("/destruction-certificates/" + cert.id, "GET", "foreign"))).status).toBe(404);
    expect((await getCertificate(req("/destruction-certificates/" + cert.id, "GET", "viewer"))).status).toBe(403);
    expect((await ok(await listCertificates(req("/destruction-certificates?submissionId=" + sub.id, "GET", "foreign")))).total).toBe(0);
    expect((await getCertificate(req("/destruction-certificates/" + cert.id, "GET", "privacy"))).status).toBe(200);
  });
  test("hold blocks approval and start, and releasing it permits the scheduled job", async () => {
    const sub = await response(), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    let current = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    await ok(await postSubmission(req("/submissions/" + sub.id + "/hold", "POST", "privacy", { version: current.version, reason: "보존 필요", hold: true })));
    expect(await runOneDestruction("held")).toBe(false);
    expect(await db.answer.count({ where: { submissionId: sub.id } })).toBe(1);
    current = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    await ok(await postSubmission(req("/submissions/" + sub.id + "/hold", "POST", "privacy", { version: current.version, reason: "보존 종료", hold: false })));
    expect(await runOneDestruction("released")).toBe(true);
  });
  test("future schedule requires fresh approval after editing, supports cancellation, and rejects stale versions", async () => {
    const sub = await response(), job = await requestDestruction(sub.id);
    await ok(await act(job.id, "approve"));
    await ok(await act(job.id, "reschedule", "privacy", { dueAt: new Date(Date.now() + 86400000).toISOString() }));
    expect(await db.destructionRequest.findUnique({ where: { id: job.id } })).toMatchObject({ status: "pending", approverId: null });
    expect((await actionRequest(req("/destruction-requests/" + job.id + "/approve", "POST", "owner", { version: 1, reason: "낡은 요청" }))).status).toBe(409);
    await ok(await act(job.id, "approve")); expect(await runOneDestruction("future")).toBe(false);
    await ok(await act(job.id, "cancel", "privacy")); expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("submitted");
    expect((await act(job.id, "approve")).status).toBe(409);
    const next = await requestDestruction(sub.id); await ok(await act(next.id, "reject"));
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("submitted");
  });
  test("expiry has an exact boundary, defaults to approval, hides all content and allows preservation", async () => {
    const sub = await response(), boundary = new Date(Date.now() - 1000);
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: boundary } });
    await enqueueExpiredSubmissions(new Date(boundary.getTime() - 1));
    expect(await db.destructionRequest.count({ where: { submissionId: sub.id } })).toBe(0);
    await enqueueExpiredSubmissions(boundary); await enqueueExpiredSubmissions(boundary);
    const jobs = await db.destructionRequest.findMany({ where: { submissionId: sub.id } }); expect(jobs).toHaveLength(1); expect(jobs[0].status).toBe("pending");
    const detail = await ok(await getSubmission(req("/submissions/" + sub.id))); expect(detail).toMatchObject({ contentAvailable: false, values: {}, receipts: [] });
    const rows = await ok(await getForm(req("/forms/" + sub.formId + "/submissions"))); expect(rows.items[0].values).toEqual({});
    expect((await postSubmission(req("/submissions/" + sub.id + "/notes", "POST", "privacy", { text: "기한 뒤" }, { "idempotency-key": randomUUID() }))).status).toBe(410);
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    await ok(await postSubmission(req("/submissions/" + sub.id + "/hold", "POST", "privacy", { version: row.version, reason: "보존 필요", hold: true })));
    expect((await act(jobs[0].id, "approve")).status).toBe(409);
    expect((await ok(await getSubmission(req("/submissions/" + sub.id)))).values[sub.questionId]).toBe(sub.privateValue);
  });
  test("automatic expiry is policy-controlled and cancelled expiry does not starve newer candidates", async () => {
    const sub = await response(); await db.securityPolicy.update({ where: { tenantId: tenant }, data: { automaticDestruction: true } });
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    await enqueueExpiredSubmissions(); const job = await db.destructionRequest.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(job.status).toBe("scheduled"); await ok(await act(job.id, "cancel", "privacy"));
    await enqueueExpiredSubmissions(); expect(await db.destructionRequest.count({ where: { submissionId: sub.id } })).toBe(1);
    const newer = await response(); await db.submission.update({ where: { id: newer.id }, data: { retentionUntil: new Date(Date.now() - 500) } });
    await enqueueExpiredSubmissions(new Date(), 1);
    expect(await db.destructionRequest.count({ where: { submissionId: newer.id } })).toBe(1);
    expect(await runOneDestruction("automatic")).toBe(true);
    expect((await db.submission.findUniqueOrThrow({ where: { id: newer.id } })).status).toBe("destroyed");
  });
  test("policy change and revoked approver invalidate approval before destructive work", async () => {
    const sub = await response(); await db.securityPolicy.update({ where: { tenantId: tenant }, data: { automaticDestruction: true } });
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() - 1000) } }); await enqueueExpiredSubmissions();
    const job = await db.destructionRequest.findFirstOrThrow({ where: { submissionId: sub.id } });
    await db.securityPolicy.update({ where: { tenantId: tenant }, data: { automaticDestruction: false } });
    expect(await runOneDestruction("changed-policy")).toBe(false);
    expect(await db.destructionRequest.findUnique({ where: { id: job.id } })).toMatchObject({ status: "pending", lastError: "APPROVAL_REQUIRED" });
    await ok(await act(job.id, "approve", "admin"));
    await db.membership.update({ where: { id: members.admin }, data: { role: "viewer" } });
    expect(await runOneDestruction("revoked-approver")).toBe(false);
    expect(await db.destructionRequest.findUnique({ where: { id: job.id } })).toMatchObject({ status: "pending", approverId: null });
    await ok(await act(job.id, "approve")); expect(await runOneDestruction("new-approval")).toBe(true);
  });
  test("two workers and a recovered lease produce one certificate", async () => {
    const sub = await response(), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    const claims = await Promise.all([claimDestruction("worker-a"), claimDestruction("worker-b")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await db.destructionRequest.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1), version: { increment: 1 } } });
    await Promise.all([runOneDestruction("recovery-a"), runOneDestruction("recovery-b")]);
    expect(await db.destructionCertificate.count({ where: { submissionId: sub.id } })).toBe(1);
    expect((await db.destructionRequest.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(2);
  });
  test("filesystem failure preserves denial and originals until a retry succeeds", async () => {
    const sub = await response(true), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    const remove = vi.spyOn(privateFiles, "remove").mockRejectedValueOnce(new Error("SIMULATED_DISK_FAILURE"));
    expect(await runOneDestruction("disk-failure")).toBe(true);
    expect(await db.destructionRequest.findUnique({ where: { id: job.id } })).toMatchObject({ status: "retry", lastError: "DESTRUCTION_FAILED" });
    expect(await db.destructionCertificate.count({ where: { submissionId: sub.id } })).toBe(0);
    expect(await db.answer.count({ where: { submissionId: sub.id } })).toBe(2);
    expect((await ok(await getSubmission(req("/submissions/" + sub.id)))).values).toEqual({});
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect((await postSubmission(req("/submissions/" + sub.id + "/hold", "POST", "privacy", { version: row.version, reason: "늦은 보존", hold: true }))).status).toBe(409);
    expect((await act(job.id, "cancel")).status).toBe(409);
    remove.mockRestore();
    await db.destructionRequest.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() - 1), version: { increment: 1 } } });
    expect(await runOneDestruction("disk-recovery")).toBe(true);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("destroyed");
  });
  test("last-attempt crash reaches failure and explicit retry recovers", async () => {
    const sub = await response(), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    await claimDestruction("crashed");
    await db.destructionRequest.update({ where: { id: job.id }, data: { attempts: 5, leaseUntil: new Date(Date.now() - 1), version: { increment: 1 } } });
    expect(await runOneDestruction("expired-final-lease")).toBe(false);
    expect((await db.destructionRequest.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed");
    await ok(await act(job.id, "retry", "privacy")); expect(await runOneDestruction("manual-retry")).toBe(true);
    expect((await db.destructionRequest.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(6);
  });
  test("simultaneous approve/cancel never erases a cancelled request", async () => {
    const sub = await response(), job = await requestDestruction(sub.id);
    const input = { version: job.version, reason: "동시 처리" };
    const results = await Promise.all(["approve", "cancel"].map(action => actionRequest(req("/destruction-requests/" + job.id + "/" + action, "POST", "owner", input))));
    expect(results.map(item => item.status).sort()).toEqual([200, 409]);
    const current = await db.destructionRequest.findUniqueOrThrow({ where: { id: job.id } });
    if (current.status === "scheduled") await ok(await act(job.id, "cancel"));
    expect(await runOneDestruction("cancelled")).toBe(false);
    expect(await db.answer.count({ where: { submissionId: sub.id } })).toBe(1);
  });
  test("after the barrier all writes and forged completion are rejected by API and DB", async () => {
    const sub = await response(), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve")); await claimDestruction("barrier");
    const current = await db.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { answers: true } });
    expect((await patchSubmission(req("/submissions/" + sub.id, "PATCH", "privacy", { version: current.version, reason: "늦은 수정", answers: { [sub.questionId]: "원문 재생" } }))).status).toBe(410);
    await expect(db.submission.update({ where: { id: sub.id }, data: { legalHold: true } })).rejects.toThrow();
    await expect(db.submission.update({ where: { id: sub.id }, data: { status: "destroyed" } })).rejects.toThrow();
    await expect(db.answer.update({ where: { id: current.answers[0].id }, data: { valueCipher: encrypt("원문 재생") } })).rejects.toThrow();
    await expect(db.submissionNote.create({ data: { tenantId: tenant, submissionId: sub.id, actorId: "test", textCipher: encrypt("원문 재생") } })).rejects.toThrow();
    await db.destructionRequest.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1), version: { increment: 1 } } }); await runOneDestruction("finish-barrier");
    await expect(db.submission.update({ where: { id: sub.id }, data: { status: "submitted" } })).rejects.toThrow();
  });
  test("retention change needs policy, cannot exceed consent or revive expired data, and records the before value", async () => {
    const sub = await response(), next = new Date(Date.now() + 86400000).toISOString();
    const input = { version: 1, reason: "더 이른 파기", retentionUntil: next };
    expect((await patchSubmission(req("/submissions/" + sub.id + "/retention", "PATCH", "privacy", input))).status).toBe(403);
    await db.securityPolicy.update({ where: { tenantId: tenant }, data: { allowRetentionAdjustment: true } });
    const original = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect((await patchSubmission(req("/submissions/" + sub.id + "/retention", "PATCH", "privacy", { ...input, retentionUntil: new Date(original.originalRetentionUntil.getTime() + 1).toISOString() }))).status).toBe(422);
    await ok(await patchSubmission(req("/submissions/" + sub.id + "/retention", "PATCH", "privacy", input)));
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).retentionVersion).toBe(2);
    const detail = await ok(await getSubmission(req("/submissions/" + sub.id))); expect(detail.corrections[0].before.retentionUntil).toBe(original.retentionUntil.toISOString());
    await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() - 1) } });
    expect((await patchSubmission(req("/submissions/" + sub.id + "/retention", "PATCH", "privacy", { ...input, version: 2 }))).status).toBe(422);
    await db.submission.update({ where: { id: sub.id }, data: { legalHold: true } });
  });
  test("expired idempotency payload is cleared while replay never reexecutes the operation", async () => {
    const scope = "expiry-test", key = randomUUID(); let count = 0;
    const operation = async () => { count++; return { status: 201, body: { private: "캐시 원문" } }; };
    await idempotent(scope, key, { input: "비공개" }, operation);
    await db.idempotencyRecord.update({ where: { scope_key: { scope, key } }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(idempotent(scope, key, { input: "비공개" }, operation)).rejects.toMatchObject({ status: 410 });
    await expireIdempotencyResponses();
    expect(await db.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } })).toMatchObject({ responseCipher: null, requestHash: null });
    await expect(idempotent(scope, key, { input: "다름" }, operation)).rejects.toMatchObject({ status: 410 }); expect(count).toBe(1);
  });
  test("requests reject cross-site origins, invalid schedules and company-mismatched references", async () => {
    const sub = await response(), job = await requestDestruction(sub.id);
    expect((await actionRequest(req("/destruction-requests/" + job.id + "/approve", "POST", "owner",
      { version: 1, reason: "위조 출처" }, { origin: "https://invalid.test" }))).status).toBe(403);
    expect((await act(job.id, "reschedule", "owner", { dueAt: new Date(Date.now() + 365 * 86400000).toISOString() })).status).toBe(422);
    expect((await act(job.id, "reschedule", "owner", { dueAt: new Date(Date.now() - 86400000).toISOString() })).status).toBe(422);
    await expect(db.destructionRequest.create({ data: { tenantId: foreign, serviceId: service, submissionId: sub.id, source: "manual", previousStatus: "submitted", dueAt: new Date() } })).rejects.toThrow();
    await ok(await act(job.id, "cancel"));
  });
  test("cached note retries recheck a revoked service grant", async () => {
    const sub = await response(), key = randomUUID(), path = "/submissions/" + sub.id + "/notes", payload = { text: "권한 회수 대상 메모" };
    await ok(await postSubmission(req(path, "POST", "privacy", payload, { "idempotency-key": key })), 201);
    const grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.privacy, serviceId: service } } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities.filter(value => value !== "submission.write") } });
    expect((await postSubmission(req(path, "POST", "privacy", payload, { "idempotency-key": key }))).status).toBe(403);
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } });
    expect((await postSubmission(req(path, "POST", "privacy", payload, { "idempotency-key": key }))).status).toBe(201);
    expect(await db.submissionNote.count({ where: { submissionId: sub.id } })).toBe(1);
  });
  test("attachment metadata uses permissions current at the locked read, even with an older context", async () => {
    const sub = await response(true), ctx = await requireContext(req("/", "GET", "privacy").headers, "submission.read");
    const grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.privacy, serviceId: service } } });
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities.filter(value => value !== "file.read") } });
    expect((await readSubmission(ctx, sub.id, randomUUID())).attachments).toEqual([]);
    await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } });
    expect((await readSubmission(ctx, sub.id, randomUUID())).attachments).toHaveLength(1);
  });
  test("request and certificate lists recheck service grants and roles after the context was read", async () => {
    const sub = await response(), job = await requestDestruction(sub.id);
    await ok(await act(job.id, "approve")); await runOneDestruction("list-permissions");
    const ctx = await requireContext(req("/", "GET", "privacy").headers, "submission.destroy");
    const query = destructionQuery.parse({ submissionId: sub.id });
    expect((await listDestructions(ctx, query)).total).toBe(1);
    expect((await listDestructions(ctx, query, true)).total).toBe(1);
    const grant = await db.serviceGrant.findUniqueOrThrow({ where: { tenantId_memberId_serviceId: { tenantId: tenant, memberId: members.privacy, serviceId: service } } });
    try {
      await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: [] } });
      expect((await listDestructions(ctx, query)).total).toBe(0);
      expect((await listDestructions(ctx, query, true)).total).toBe(0);
      await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } });
      await db.membership.update({ where: { id: members.privacy }, data: { role: "viewer" } });
      await expect(listDestructions(ctx, query)).rejects.toMatchObject({ status: 403 });
      await expect(listDestructions(ctx, query, true)).rejects.toMatchObject({ status: 403 });
    } finally {
      await db.membership.update({ where: { id: members.privacy }, data: { role: "privacy" } });
      await db.serviceGrant.update({ where: { id: grant.id }, data: { capabilities: grant.capabilities } });
    }
  });
});
