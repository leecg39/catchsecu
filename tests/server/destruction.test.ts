import { randomUUID } from "node:crypto";
import { lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { resolve } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, test, expect, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { roleCapabilities } from "@/server/permissions";
import { encrypt, tokenHash } from "@/server/crypto";
import { privateFiles } from "@/server/file-storage";
import { sha256 } from "@/server/file-validation";
import { expireIdempotencyResponses, idempotent } from "@/server/idempotency";
import { claimDestruction, enqueueExpiredSubmissions, runOneDestruction } from "@/server/destruction-worker";
import { certificateDigest, destructionQuery, listDestructions, decideDestruction, readCertificate, changeRetention } from "@/server/destruction";
import { changeSubmission } from "@/server/submission-management";
import { POST as createVerification } from "@/app/api/v1/services/[id]/verification/route";
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
const barriers: Record<string, unknown>[] = [];
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
afterAll(async () => {
  await mkdir("docs/qa/P07-T03", { recursive: true });
  await writeFile("docs/qa/P07-T03/lock-barriers.json", JSON.stringify({ checkedAt: new Date().toISOString(), barriers, providerProtocolVerified: false }, null, 2) + "\n");
  await db.$disconnect();
});
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
const scopeFor = (requestId: string) => ({ tenantId: tenant, requestId });
async function withAuditDelay(action: string, operation: () => Promise<void>) {
  await db.$executeRawUnsafe("CREATE FUNCTION qa_destruction_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='" + action + "' THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER qa_destruction_delay BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_destruction_delay()');
  try { await operation(); } finally {
    await db.$executeRawUnsafe('DROP TRIGGER qa_destruction_delay ON "AuditEvent"');
    await db.$executeRawUnsafe("DROP FUNCTION qa_destruction_delay()");
  }
}
async function nativeReject(sql: string, values: unknown[], before?: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  try {
    await client.query("BEGIN"); await before?.(client);
    let error: { code?: string; message?: string } | undefined;
    try { await client.query(sql, values); } catch (cause) { error = cause as typeof error; }
    expect(error?.code).toBe("23514"); return error?.message;
  } finally { await client.query("ROLLBACK"); await client.end(); }
}
async function syntheticVerification(submissionId: string, kind: "identity" | "signature") {
  // These are mechanical DB integrity fixtures, never external identity/signature success.
  const ctx = await requireContext(req("/", "GET", "owner").headers);
  let configuration = await db.verificationIntegration.findUnique({ where: { tenantId_serviceId: { tenantId: tenant, serviceId: service } } });
  if (!configuration) {
    await ok(await createVerification(req("/services/" + service + "/verification", "POST", "owner", {
      identityProvider: "qa_identity", signatureProvider: "qa_signature", environment: "production", status: "pending",
    }, { "idempotency-key": randomUUID() })), 201);
    // 과거 외부 공급자로 검증된 응답을 재현한다 — 앱 계층은 외부 공급자의 enabled를 막지만
    // 이 픽스처는 파기 증거의 DB 무결성만 검증하므로 트랜잭션으로 설정을 승격한다.
    await db.$transaction(async tx => {
      const current = await tx.verificationIntegration.findUniqueOrThrow({ where: { tenantId_serviceId: { tenantId: tenant, serviceId: service } } });
      await tx.verificationIntegration.update({ where: { id: current.id }, data: { status: "enabled", version: { increment: 1 } } });
      await tx.verificationIntegrationRevision.create({ data: { tenantId: tenant, serviceId: service, integrationId: current.id,
        version: current.version + 1, identityProvider: current.identityProvider, signatureProvider: current.signatureProvider,
        environment: current.environment, status: "enabled" } });
    });
    configuration = await db.verificationIntegration.findUniqueOrThrow({ where: { tenantId_serviceId: { tenantId: tenant, serviceId: service } } });
  }
  const sub = await db.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { formVersion: true } });
  const attempt = await db.verificationAttempt.create({ data: { tenantId: tenant, serviceId: service, integrationId: configuration.id, integrationVersion: configuration.version,
    formId: sub.formVersion.formId, formVersionId: sub.formVersionId, publicationId: sub.publicationId!, kind, environment: "production",
    browserNonceHash: tokenHash(randomUUID()), requestHash: tokenHash(randomUUID()), documentHash: tokenHash("synthetic document"), expiresAt: new Date(Date.now() + 60000) } });
  const verifiedAt = new Date(), bodyHash = tokenHash(randomUUID());
  await db.verificationAttempt.update({ where: { id: attempt.id }, data: { status: "verified", version: 2, verifiedAt,
    providerRequestHash: tokenHash(randomUUID()), providerRequestCipher: encrypt({ synthetic: true, privateReference: randomUUID() }) } });
  const event = await db.verificationEvent.create({ data: { tenantId: tenant, serviceId: service, attemptId: attempt.id,
    providerEventHash: tokenHash(randomUUID()), bodyHash, signatureValid: true, verificationStatus: "verified" } });
  await db.verificationEvent.create({ data: { tenantId: tenant, serviceId: service, attemptId: attempt.id,
    providerEventHash: tokenHash(randomUUID()), bodyHash: tokenHash(randomUUID()), signatureValid: false, verificationStatus: "ignored" } });
  const receipt = { tenantId: tenant, serviceId: service, attemptId: attempt.id, eventId: event.id, formVersionId: sub.formVersionId,
    publicationId: sub.publicationId!, submissionId: sub.id, provider: kind === "identity" ? "qa_identity" : "qa_signature", kind,
    environment: "production", documentHash: attempt.documentHash, proofHash: bodyHash, verifiedAt, retentionUntil: sub.retentionUntil };
  return { ctx, attempt, event, receipt };
}
describe("current destruction authority, fencing and verification erasure", () => {
  test.each(["?ignored=true", "?page=1&page=2", "?sort=completedAt", "?page=0", "?pageSize=101"])("request query is strict: %s", async query => {
    expect((await listRequests(req("/destruction-requests" + query))).status).toBe(422);
  });
  test("certificate queries and action/detail queries cannot be silently ignored", async () => {
    for (const query of ["?status=completed", "?sort=dueAt", "?ignored=true", "?page=1&page=2"])
      expect((await listCertificates(req("/destruction-certificates" + query))).status).toBe(422);
    const sub = await response(), job = await requestDestruction(sub.id);
    expect((await actionRequest(req("/destruction-requests/" + job.id + "/approve?ignored=true", "POST", "owner", { version: job.version, reason: "test" }))).status).toBe(422);
    expect((await getCertificate(req("/destruction-certificates/" + randomUUID() + "?ignored=true"))).status).toBe(422);
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect((await postSubmission(req("/submissions/" + sub.id + "/hold?ignored=true", "POST", "owner", { version: row.version, reason: "test", hold: true }))).status).toBe(422);
    expect((await patchSubmission(req("/submissions/" + sub.id + "/retention?ignored=true", "PATCH", "owner", { version: row.version, reason: "test", retentionUntil: new Date(Date.now() + 86400000).toISOString() }))).status).toBe(422);
    await ok(await act(job.id, "cancel"));
  });
  test("search, stable sort, clamped page and server action permissions reflect current state", async () => {
    const sub = await response(), job = await requestDestruction(sub.id);
    const query = "?submissionId=" + sub.id + "&page=999&pageSize=1&sort=name&direction=asc&search=" + sub.id;
    const owner = await ok(await listRequests(req("/destruction-requests" + query))), privacy = await ok(await listRequests(req("/destruction-requests" + query, "GET", "privacy")));
    expect(owner).toMatchObject({ page: 1, total: 1 }); expect(owner.items[0].permissions).toMatchObject({ canApprove: true, canReject: true, canCancel: true });
    expect(privacy.items[0].permissions).toMatchObject({ canApprove: false, canReject: false, canCancel: true });
    expect((await ok(await listRequests(req("/destruction-requests?submissionId=" + sub.id + "&search=missing")))).total).toBe(0);
    await ok(await act(job.id, "approve")); await runOneDestruction("query", new Date(), scopeFor(job.id));
    const certificates = await ok(await listCertificates(req("/destruction-certificates?submissionId=" + sub.id + "&sort=completedAt&direction=asc&page=999&pageSize=1&search=" + sub.id)));
    expect(certificates).toMatchObject({ page: 1, total: 1 }); expect(certificates.items[0].integrityVerified).toBe(true);
    const final = await ok(await listRequests(req("/destruction-requests?submissionId=" + sub.id)));
    expect(Object.values(final.items[0].permissions)).toEqual([false, false, false, false, false]);
  });
  test.each(["expired", "company", "unverified", "mfa", "password", "inactive"] as const)("stale list context rejects changed %s", async kind => {
    const ctx = await requireContext(req("/", "GET", "owner").headers), saved = await db.session.findUniqueOrThrow({ where: { id: ctx.session.id } });
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } }), policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: tenant } });
    try {
      if (kind === "expired") await db.session.update({ where: { id: saved.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      if (kind === "company") await db.session.update({ where: { id: saved.id }, data: { activeCompanyId: foreign } });
      if (kind === "unverified") await db.user.update({ where: { id: user.id }, data: { emailVerified: false } });
      if (kind === "inactive") await db.user.update({ where: { id: user.id }, data: { status: "suspended" } });
      if (kind === "mfa") await db.securityPolicy.update({ where: { tenantId: tenant }, data: { requireMfa: true } });
      if (kind === "password") {
        await db.user.update({ where: { id: user.id }, data: { passwordChangedAt: new Date(Date.now() - 400 * 86400000) } });
        await db.securityPolicy.update({ where: { tenantId: tenant }, data: { passwordMonths: 1 } });
      }
      for (const certificates of [false, true]) await expect(listDestructions(ctx, destructionQuery.parse({}), certificates)).rejects.toMatchObject({ status: ["expired", "unverified", "inactive"].includes(kind) ? 401 : 403 });
    } finally {
      await db.user.update({ where: { id: user.id }, data: { emailVerified: user.emailVerified, status: user.status, passwordChangedAt: user.passwordChangedAt } });
      await db.securityPolicy.update({ where: { tenantId: tenant }, data: { requireMfa: policy.requireMfa, passwordMonths: policy.passwordMonths } });
      await db.session.update({ where: { id: saved.id }, data: { expiresAt: saved.expiresAt, updatedAt: saved.updatedAt, activeCompanyId: saved.activeCompanyId } });
    }
  });
  test.each(["Company", "DestructionRequest"] as const)("actual native %s lock expiry never returns success", async table => {
    const sub = await response(), job = await requestDestruction(sub.id), ctx = await requireContext(req("/", "GET", "owner").headers);
    const saved = await db.session.findUniqueOrThrow({ where: { id: ctx.session.id } }), client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
    let promise: Promise<unknown> | undefined;
    try {
      await db.session.update({ where: { id: saved.id }, data: { expiresAt: new Date(Date.now() + 2000) } });
      await client.query("BEGIN"); await client.query('SELECT id FROM "' + table + '" WHERE id=$1 FOR UPDATE', [table === "Company" ? tenant : job.id]);
      promise = table === "Company" ? listDestructions(ctx, destructionQuery.parse({ submissionId: sub.id })) : decideDestruction(ctx, job.id, "approve", { version: job.version, reason: "test" }, randomUUID());
      const caught = promise.catch(error => error); let waiters = 0;
      for (let i = 0; i < 60; i++) {
        await client.query("SELECT pg_stat_clear_snapshot()");
        waiters = (await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1", ['%FROM "' + table + '"%'])).rows[0].n;
        if (waiters) break; await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiters).toBeGreaterThan(0); await new Promise(resolve => setTimeout(resolve, 2100)); await client.query("ROLLBACK");
      const error = await caught; expect(error).toMatchObject({ status: 401 });
      expect((await db.destructionRequest.findUniqueOrThrow({ where: { id: job.id } })).version).toBe(job.version);
      barriers.push({ table, actualWaitObserved: true, waiters, afterWaitStatus: (error as { status: number }).status });
    } finally {
      await client.query("ROLLBACK"); await promise?.catch(() => undefined); await client.end();
      await db.session.update({ where: { id: saved.id }, data: { expiresAt: saved.expiresAt, updatedAt: saved.updatedAt } });
      await ok(await act(job.id, "cancel"));
    }
  });
  test.each(["hold", "destruction-request", "approve", "retention", "certificate"] as const)("audit INSERT delay rolls back expired %s and its history", async action => {
    const sub = await response(); let job: Awaited<ReturnType<typeof requestDestruction>> | undefined, certificateId: string | undefined;
    if (action === "approve" || action === "certificate") job = await requestDestruction(sub.id);
    if (action === "certificate") { await ok(await act(job!.id, "approve")); await runOneDestruction("cert-delay", new Date(), scopeFor(job!.id)); certificateId = (await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: sub.id } })).id; }
    if (action === "retention") await db.securityPolicy.update({ where: { tenantId: tenant }, data: { allowRetentionAdjustment: true } });
    const ctx = await requireContext(req("/", "GET", "owner").headers), saved = await db.session.findUniqueOrThrow({ where: { id: ctx.session.id } });
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } }), audits = await db.auditEvent.count({ where: { tenantId: tenant } }), corrections = await db.correction.count({ where: { submissionId: sub.id } });
    const auditAction = action === "approve" ? "destruction.approve" : action === "certificate" ? "destruction.certificate_viewed" : action === "retention" ? "submission.retention_changed" : "submission." + action;
    try { await withAuditDelay(auditAction, async () => {
      await db.session.update({ where: { id: saved.id }, data: { expiresAt: new Date(Date.now() + 1000) } });
      const operation = action === "approve" ? decideDestruction(ctx, job!.id, "approve", { version: job!.version, reason: "test" }, randomUUID()) :
        action === "certificate" ? readCertificate(ctx, certificateId!, randomUUID()) :
        action === "retention" ? changeRetention(ctx, sub.id, { version: row.version, reason: "test", retentionUntil: new Date(Date.now() + 86400000).toISOString() }, randomUUID()) :
        changeSubmission(ctx, sub.id, action, { version: row.version, reason: "test", ...(action === "hold" ? { hold: true } : {}) }, randomUUID());
      await expect(operation).rejects.toMatchObject({ status: 401 });
      expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).version).toBe(row.version);
      expect(await db.auditEvent.count({ where: { tenantId: tenant } })).toBe(audits);
      expect(await db.correction.count({ where: { submissionId: sub.id } })).toBe(corrections);
      if (action === "destruction-request") expect(await db.destructionRequest.count({ where: { submissionId: sub.id } })).toBe(0);
      barriers.push({ table: "AuditEvent", action, actualDelaySeconds: 2, status: 401, mutationAndAuditRolledBack: true });
    }); } finally {
      await db.session.update({ where: { id: saved.id }, data: { expiresAt: saved.expiresAt, updatedAt: saved.updatedAt } });
      if (action === "approve") await ok(await act(job!.id, "cancel"));
    }
  });
  test.each(["succeed", "fail"])("old execution cannot finish or overwrite retry after the same name reacquires: %s", async mode => {
    const sub = await response(true), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), paused = new Promise<void>(resolve => { release = resolve; });
    const original = privateFiles.remove.bind(privateFiles);
    const spy = vi.spyOn(privateFiles, "remove").mockImplementationOnce(async key => { started(); await paused; if (mode === "fail") throw new Error("OLD_EXECUTION_FAILED"); await original(key); });
    const old = runOneDestruction("same-worker", new Date(), scopeFor(job.id));
    try {
      await entered; await db.destructionRequest.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1), version: { increment: 1 } } });
      const fresh = await claimDestruction("same-worker", new Date(), scopeFor(job.id)); expect(fresh?.attempts).toBe(2);
      release(); await old;
      expect(await db.destructionCertificate.count({ where: { submissionId: sub.id } })).toBe(0);
      expect(await db.destructionRequest.findUnique({ where: { id: job.id } })).toMatchObject({ status: "running", attempts: 2, leaseOwner: "same-worker" });
      barriers.push({ kind: "sameWorkerLeaseGeneration", mode, staleAttempt: 1, currentAttempt: 2, staleCompletionOrRetryRejected: true });
    } finally { release(); await old; spy.mockRestore(); }
    await db.destructionRequest.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1), version: { increment: 1 } } });
    await runOneDestruction("generation-recovery", new Date(), scopeFor(job.id));
    expect(await db.destructionCertificate.count({ where: { submissionId: sub.id } })).toBe(1);
  });
  test.each(["email", "mfa"])("worker rejects an approver who loses current %s eligibility", async kind => {
    const sub = await response(), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    const owner = await requireContext(req("/", "GET", "owner").headers);
    try {
      if (kind === "email") await db.user.update({ where: { id: owner.user.id }, data: { emailVerified: false } });
      else await db.securityPolicy.update({ where: { tenantId: tenant }, data: { requireMfa: true } });
      expect(await runOneDestruction("ineligible-approver", new Date(), scopeFor(job.id))).toBe(false);
      expect(await db.destructionRequest.findUnique({ where: { id: job.id } })).toMatchObject({ status: "pending", approverId: null, lastError: "APPROVAL_REQUIRED" });
      expect(await db.answer.count({ where: { submissionId: sub.id } })).toBe(1);
    } finally {
      await db.user.update({ where: { id: owner.user.id }, data: { emailVerified: true } });
      await db.securityPolicy.update({ where: { tenantId: tenant }, data: { requireMfa: false } });
    }
    await ok(await act(job.id, "approve")); await runOneDestruction("new-eligible-approval", new Date(), scopeFor(job.id));
  });
  test("expert viewer cannot gain destruction or certificate access through forged grants", async () => {
    const name = "expert-" + randomUUID(); await signup(name, "viewer");
    const owner = await requireContext(req("/", "GET", "owner").headers), member = await db.membership.findUniqueOrThrow({ where: { id: members[name] } });
    const assignment = await db.expertAssignment.create({ data: { tenantId: tenant, expertUserId: member.userId, assignedById: owner.user.id, expiresAt: new Date(Date.now() + 86400000) } });
    await db.expertAssignmentService.create({ data: { tenantId: tenant, assignmentId: assignment.id, serviceId: service } });
    await db.membership.update({ where: { id: member.id }, data: { accessKind: "expert", expertAssignmentId: assignment.id } });
    await db.serviceGrant.updateMany({ where: { memberId: member.id }, data: { capabilities: ["service.read", "form.read", "submission.destroy", "audit.read"] } });
    await db.session.updateMany({ where: { userId: member.userId }, data: { activeCompanyId: tenant } });
    const ctx = await requireContext(req("/", "GET", name).headers), sub = await response(), query = destructionQuery.parse({ submissionId: sub.id });
    for (const certificates of [false, true]) await expect(listDestructions(ctx, query, certificates)).rejects.toMatchObject({ status: 403 });
    const row = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    await expect(changeSubmission(ctx, sub.id, "hold", { version: row.version, hold: true, reason: "test" }, randomUUID())).rejects.toMatchObject({ status: 403 });
    expect(await db.submission.findUnique({ where: { id: sub.id } })).toMatchObject({ legalHold: false, version: row.version });
    barriers.push({ kind: "expertViewerRole", forgedGrantCannotElevateRole: true, requestAndCertificateDenied: true, holdUnchanged: true });
  });
  test("retention deadline elapsed during audit cannot revive originals", async () => {
    const sub = await response(), ctx = await requireContext(req("/", "GET", "owner").headers);
    await db.securityPolicy.update({ where: { tenantId: tenant }, data: { allowRetentionAdjustment: true } });
    const row = await db.submission.update({ where: { id: sub.id }, data: { retentionUntil: new Date(Date.now() + 1000), version: { increment: 1 } } });
    await withAuditDelay("submission.retention_changed", async () => {
      await expect(changeRetention(ctx, sub.id, { version: row.version, reason: "test", retentionUntil: new Date(Date.now() + 86400000).toISOString() }, randomUUID())).rejects.toMatchObject({ status: 422 });
      expect(await db.submission.findUnique({ where: { id: sub.id } })).toMatchObject({ retentionUntil: row.retentionUntil, version: row.version });
      barriers.push({ kind: "retentionBoundary", actualAuditDelaySeconds: 2, elapsedRetentionUpdateRolledBack: true });
    });
    // Finish this isolated response so later global test-worker cases cannot select it.
    const job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    await runOneDestruction("retention-boundary-cleanup", new Date(), scopeFor(job.id));
  });
  test("lease expiry during completion audit rolls back certificate and DB erasure for recovery", async () => {
    const sub = await response(true), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    // The storage unlink stays real; shorten the actual DB lease before finalization.
    const original = privateFiles.remove.bind(privateFiles);
    const spy = vi.spyOn(privateFiles, "remove").mockImplementationOnce(async key => {
      await original(key);
      await db.destructionRequest.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() + 1000), version: { increment: 1 } } });
    });
    try { await withAuditDelay("destruction.completed", async () => {
      await runOneDestruction("lease-expiring", new Date(), scopeFor(job.id));
      expect(await db.destructionCertificate.count({ where: { submissionId: sub.id } })).toBe(0);
      expect(await db.answer.count({ where: { submissionId: sub.id } })).toBe(2);
      expect(await db.destructionRequest.findUnique({ where: { id: job.id } })).toMatchObject({ status: "running", attempts: 1 });
      barriers.push({ kind: "completionAuditLeaseExpiry", actualDelaySeconds: 2, certificateAndErasureRolledBack: true });
    }); } finally { spy.mockRestore(); }
    await runOneDestruction("lease-recovery", new Date(), scopeFor(job.id));
    expect(await db.destructionCertificate.count({ where: { submissionId: sub.id } })).toBe(1);
  });
  test("scoped worker never claims another tenant or request", async () => {
    const sub = await response(), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve"));
    expect(await runOneDestruction("wrong-tenant", new Date(), { tenantId: foreign, requestId: job.id })).toBe(false);
    expect(await runOneDestruction("wrong-request", new Date(), scopeFor(randomUUID()))).toBe(false);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("pendingDestruction");
    expect(await runOneDestruction("correct-scope", new Date(), scopeFor(job.id))).toBe(true);
  });
  test("linked identity/signature proofs erase atomically and cannot be rebound after destruction", async () => {
    const sub = await response(), identity = await syntheticVerification(sub.id, "identity"), signature = await syntheticVerification(sub.id, "signature");
    const a = await db.verificationReceipt.create({ data: identity.receipt }), b = await db.verificationReceipt.create({ data: signature.receipt });
    await nativeReject('DELETE FROM "VerificationReceipt" WHERE id=$1', [a.id]);
    const job = await requestDestruction(sub.id); await ok(await act(job.id, "approve")); await claimDestruction("proof-barrier", new Date(), scopeFor(job.id));
    const message = await nativeReject('INSERT INTO "DestructionCertificate" (id,"tenantId","serviceId","submissionId","requestId",scope,method,counts,digest,version,"completedAt") VALUES ($1,$2,$3,$4,$5,\'active-database-and-private-storage\',\'database-delete-and-encrypted-object-unlink\',\'{}\',\'fake\',1,clock_timestamp())', [randomUUID(), tenant, service, sub.id, job.id], async client => {
      await client.query('SELECT id FROM "Submission" WHERE id=$1 FOR UPDATE', [sub.id]);
      await client.query('DELETE FROM "CorrectionPayload" WHERE "correctionId" IN (SELECT id FROM "Correction" WHERE "submissionId"=$1)', [sub.id]);
      await client.query('DELETE FROM "Correction" WHERE "submissionId"=$1', [sub.id]);
      await client.query('DELETE FROM "ConsentEvent" WHERE "receiptId" IN (SELECT id FROM "ConsentReceipt" WHERE "submissionId"=$1)', [sub.id]);
      await client.query('DELETE FROM "ConsentReceipt" WHERE "submissionId"=$1', [sub.id]);
      await client.query('DELETE FROM "Answer" WHERE "submissionId"=$1', [sub.id]);
    });
    expect(message).toContain("verification erasure");
    expect(await db.verificationReceipt.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);
    await db.destructionRequest.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1), version: { increment: 1 } } });
    await runOneDestruction("proof-erasure", new Date(), scopeFor(job.id));
    expect(await db.verificationReceipt.count({ where: { submissionId: sub.id } })).toBe(0);
    expect(await db.verificationAttempt.count({ where: { id: { in: [identity.attempt.id, signature.attempt.id] } } })).toBe(0);
    expect(await db.verificationEvent.count({ where: { attemptId: { in: [identity.attempt.id, signature.attempt.id] } } })).toBe(0);
    const cert = await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: sub.id } });
    expect(cert.counts).toMatchObject({ verificationReceipts: 2, verificationEvents: 4, verificationAttempts: 2 });
    const late = await syntheticVerification(sub.id, "identity");
    await expect(db.verificationReceipt.create({ data: late.receipt })).rejects.toBeTruthy();
    barriers.push({ kind: "syntheticVerificationErasure", receipts: 2, events: 4, encryptedAttempts: 2, remainingLinkedOriginals: 0, lateBindingRejected: true, providerProtocolVerified: false });
  });
  test("invalid certificate integrity never commits a successful viewing audit", async () => {
    const sub = await response(), job = await requestDestruction(sub.id); await ok(await act(job.id, "approve")); await runOneDestruction("integrity", new Date(), scopeFor(job.id));
    const cert = await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: sub.id } });
    const tamper = async (digest: string) => db.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "DestructionCertificate" DISABLE TRIGGER USER');
      await tx.destructionCertificate.update({ where: { id: cert.id }, data: { digest } });
      await tx.$executeRawUnsafe('ALTER TABLE "DestructionCertificate" ENABLE TRIGGER USER');
    });
    const before = await db.auditEvent.count({ where: { resourceId: cert.id } });
    try {
      await tamper("0".repeat(64));
      expect((await getCertificate(req("/destruction-certificates/" + cert.id))).status).toBe(409);
      expect((await getCertificate(req("/destruction-certificates/" + cert.id + "/download"))).status).toBe(409);
      expect(await db.auditEvent.count({ where: { resourceId: cert.id } })).toBe(before);
    } finally { await tamper(cert.digest); }
  });
});

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
    expect(await db.correctionPayload.count({ where: { tenantId: tenant, correction: { submissionId: sub.id } } })).toBe(0);
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
    expect(await db.auditEvent.count({ where: { resourceId: job.id, action: "destruction.failed_attempt" } })).toBe(1);
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
