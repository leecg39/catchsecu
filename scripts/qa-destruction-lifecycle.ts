import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { runOneDestruction } from "../src/server/destruction-worker";
import type { DestructionRecord, CertificateRecord } from "../src/contracts/destruction";

const target = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (target.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(target.hostname) || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Independent local development HTTP QA only.");
const phase = process.argv[2], out = "docs/qa/P07-T03/", checkpoint = ".local/p07-destruction-checkpoint.json";
if (!["prepare", "finish", "database"].includes(phase)) throw new Error("prepare, finish or database required.");
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; formId: string; submissionId: string;
  questionId: string; fileQuestionId: string; fileId: string; storageKey: string; requestId: string; certificateId: string;
  originalCompanyIds: string[]; originalUserIds: string[]; preservedHash: string; businessHash: string; ownerCookie: string };
const cases: { label: string; status: number }[] = [];
let cookie = "";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const responseCookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
async function call(label: string, path: string, options: { method?: string; value?: unknown; bytes?: Buffer; cookie?: string; expected?: number | number[]; headers?: Record<string, string> } = {}) {
  const method = options.method ?? "GET", expected = options.expected ?? 200;
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie: options.cookie ?? cookie,
    ...(method === "GET" ? {} : { origin }), ...(options.value === undefined ? {} : { "Content-Type": "application/json" }),
    ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}), ...options.headers },
    ...(options.bytes ? { body: new Uint8Array(options.bytes) } : options.value === undefined ? {} : { body: JSON.stringify(options.value) }) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + ": " + response.status);
  cases.push({ label, status: response.status }); return response;
}
const api = (label: string, path: string, options: Parameters<typeof call>[2] = {}) => call(label, "/api/v1" + path, options);
async function persist(s: State) { await writeFile(checkpoint, JSON.stringify(s), { mode: 0o600 }); assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600); }
async function preserved(s: Pick<State, "originalCompanyIds" | "originalUserIds">) {
  const scope = { tenantId: { in: s.originalCompanyIds } };
  const companies = await db.company.findMany({ where: { id: { in: s.originalCompanyIds } }, orderBy: { id: "asc" } });
  const services = await db.service.findMany({ where: scope, orderBy: { id: "asc" } });
  const forms = await db.form.findMany({ where: scope, orderBy: { id: "asc" }, include: { versions: { orderBy: { id: "asc" }, include: { questions: { orderBy: { id: "asc" } } } } } });
  const submissions = await db.submission.findMany({ where: scope, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } }, verificationReceipts: { orderBy: { id: "asc" } } } });
  const integrations = await db.verificationIntegration.findMany({ where: scope, orderBy: { id: "asc" }, include: { revisions: { orderBy: { id: "asc" } } } });
  const users = await db.user.findMany({ where: { id: { in: s.originalUserIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, emailVerified: true, platformAdmin: true, twoFactorEnabled: true, passwordChangedAt: true } });
  return digest({ companies, services, forms, submissions, integrations, users });
}
async function snapshot(s: State) {
  const submission = await db.submission.findUniqueOrThrow({ where: { id: s.submissionId }, include: { answers: { orderBy: { id: "asc" } }, notes: { orderBy: { id: "asc" } }, corrections: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } });
  const requests = await db.destructionRequest.findMany({ where: { tenantId: s.companyId, submissionId: s.submissionId }, orderBy: { id: "asc" } });
  const certificate = await db.destructionCertificate.findUniqueOrThrow({ where: { id: s.certificateId } }), file = await db.fileObject.findUniqueOrThrow({ where: { id: s.fileId } });
  return { hash: digest({ submission, requests, certificate, file }), status: submission.status, requests: requests.length, certificateId: certificate.id, fileStatus: file.status,
    answers: submission.answers.length, notes: submission.notes.length, corrections: submission.corrections.length, receipts: submission.receipts.length };
}
await mkdir(out, { recursive: true });
try {
  if (phase === "prepare") {
    const s: State = { email: "p07-destruction-owner-" + randomUUID() + "@catchsecu.local.test", password: "P07-Destruction!" + randomUUID(),
      userId: "", companyId: "", serviceId: "", formId: "", submissionId: "", questionId: randomUUID(), fileQuestionId: randomUUID(),
      fileId: "", storageKey: "", requestId: "", certificateId: "", originalCompanyIds: (await db.company.findMany({ select: { id: true } })).map(row => row.id),
      originalUserIds: (await db.user.findMany({ select: { id: true } })).map(row => row.id), preservedHash: "", businessHash: "", ownerCookie: "" };
    s.preservedHash = await preserved(s); await persist(s);
    await api("register independent synthetic owner", "/auth/sign-up/email", { method: "POST", cookie: "", value: { name: "Destruction QA", email: s.email, password: s.password } });
    const mail = (await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" }, take: 30 })).map(job => decrypt<{ to: string; subject: string; text: string }>(job.payloadCipher)).find(row => row.to === s.email && row.subject === "이메일 인증");
    assert(mail); const link = new URL(mail.text.match(/https?:\/\/\S+/)![0]); assert.equal(link.origin, origin);
    await call("verify own queued email token", link.pathname + link.search, { cookie: "", expected: [200, 302] });
    cookie = responseCookies(await api("login independent owner", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email: s.email, password: s.password } }));
    const user = await db.user.findUniqueOrThrow({ where: { email: s.email } }); assert(!user.platformAdmin); s.userId = user.id; s.ownerCookie = cookie;
    const company = await (await api("create independent company", "/companies", { method: "POST", expected: 201, value: { name: "P07 Destruction " + randomUUID(), publicName: "Destruction QA" } })).json() as { id: string }; s.companyId = company.id;
    const context = await (await api("read own active company and service", "/context")).json() as { company: { id: string }; services: { id: string }[] }; assert.equal(context.company.id, s.companyId); s.serviceId = context.services[0].id; await persist(s);
    const content = { body: "Synthetic local destruction QA", consentRequired: true, consentPurpose: "Synthetic QA", retentionDays: 30, maxResponses: 10,
      questions: [{ id: s.questionId, type: "단문형 답변", label: "Value", required: true }, { id: s.fileQuestionId, type: "파일 업로드", label: "File", required: true }] };
    const form = await (await api("create form with required private file", "/forms", { method: "POST", expected: 201, value: { serviceId: s.serviceId, title: "Destruction " + randomUUID(), content } })).json() as { id: string; version: number }; s.formId = form.id;
    const publication = await (await api("publish synthetic ordinary form", "/forms/" + form.id + "/publish", { method: "POST", expected: 201, value: { version: form.version } })).json() as { token: string };
    const bytes = Buffer.from("Synthetic private attachment " + randomUUID()), sha256 = createHash("sha256").update(bytes).digest("hex");
    const upload = await (await api("reserve required public upload", "/public/forms/" + publication.token + "/uploads", { method: "POST", cookie: "", expected: 201,
      value: { questionId: s.fileQuestionId, name: "destruction.txt", mime: "text/plain", size: bytes.length, sha256 } })).json() as { id: string; uploadToken: string }; s.fileId = upload.id;
    await api("upload real synthetic file bytes", "/uploads/" + upload.id + "/content", { method: "PUT", cookie: "", bytes, headers: { "Content-Type": "text/plain", "X-Upload-Token": upload.uploadToken } });
    await api("complete real ClamAV scan", "/uploads/" + upload.id + "/complete", { method: "POST", cookie: "", headers: { "X-Upload-Token": upload.uploadToken } });
    const submission = await (await api("accept public submission and attached file", "/public/forms/" + publication.token + "/submissions", { method: "POST", cookie: "", expected: 201,
      value: { consent: true, answers: { [s.questionId]: "Synthetic private original", [s.fileQuestionId]: upload.id },
        attachments: { [s.fileQuestionId]: { fileId: upload.id, token: upload.uploadToken } } } })).json() as { id: string }; s.submissionId = submission.id;
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: s.fileId } }); s.storageKey = file.storageKey;
    assert((await privateFiles.read(file.storageKey)).equals(bytes));
    const noteKey = randomUUID();
    await api("create encrypted note with idempotent response", "/submissions/" + s.submissionId + "/notes", { method: "POST", expected: 201, value: { text: "Synthetic private note" }, headers: { "Idempotency-Key": noteKey } });
    const actSubmission = async (action: string, extra: Record<string, unknown> = {}) => {
      const row = await db.submission.findUniqueOrThrow({ where: { id: s.submissionId } });
      return api(action, "/submissions/" + s.submissionId + "/" + action, { method: "POST", value: { version: row.version, reason: "Synthetic purpose ended", ...extra } });
    };
    await actSubmission("hold", { hold: true });
    const held = await db.submission.findUniqueOrThrow({ where: { id: s.submissionId } });
    await api("legal hold blocks destruction request", "/submissions/" + s.submissionId + "/destruction-request", { method: "POST", expected: 409, value: { version: held.version, reason: "test" } });
    await actSubmission("hold", { hold: false });
    const cancelled = await (await actSubmission("destruction-request")).json() as { destructionId: string };
    const first = await db.destructionRequest.findUniqueOrThrow({ where: { id: cancelled.destructionId } });
    await api("cancel pending request", "/destruction-requests/" + first.id + "/cancel", { method: "POST", value: { version: first.version, reason: "Schedule review" } });
    const pending = await (await actSubmission("destruction-request")).json() as { destructionId: string }; s.requestId = pending.destructionId; await persist(s);
    let row = await db.destructionRequest.findUniqueOrThrow({ where: { id: s.requestId } });
    const listed = await (await api("search current request and clamp requested page", "/destruction-requests?submissionId=" + s.submissionId + "&search=" + s.requestId + "&page=999&sort=dueAt&direction=asc")).json() as { items: DestructionRecord[]; page: number; total: number };
    assert.equal(listed.page, 1); assert.equal(listed.total, 1); assert(listed.items[0].permissions.canApprove);
    await api("reject duplicate query key", "/destruction-requests?page=1&page=2", { expected: 422 });
    await api("reject unsupported query", "/destruction-requests?ignored=true", { expected: 422 });
    await api("reject stale action version", "/destruction-requests/" + row.id + "/approve", { method: "POST", expected: 409, value: { version: row.version + 10, reason: "test" } });
    await api("reschedule and require fresh approval", "/destruction-requests/" + row.id + "/reschedule", { method: "POST", value: { version: row.version, reason: "Rescheduled", dueAt: new Date().toISOString() } });
    row = await db.destructionRequest.findUniqueOrThrow({ where: { id: s.requestId } });
    await api("approve current request", "/destruction-requests/" + row.id + "/approve", { method: "POST", value: { version: row.version, reason: "Approved synthetic erasure" } });
    assert.equal(await runOneDestruction("p07-http-scoped", new Date(), { tenantId: s.companyId, requestId: s.requestId }), true);
    const cert = await db.destructionCertificate.findUniqueOrThrow({ where: { submissionId: s.submissionId } }); s.certificateId = cert.id;
    const detail = await (await api("read verified immutable certificate", "/destruction-certificates/" + cert.id)).json() as CertificateRecord; assert(detail.integrityVerified);
    assert.equal((await (await api("download verified certificate JSON", "/destruction-certificates/" + cert.id + "/download")).json()).id, cert.id);
    const certificates = await (await api("search certificate and clamp page", "/destruction-certificates?submissionId=" + s.submissionId + "&search=" + cert.id + "&sort=name&direction=asc&page=999")).json() as { page: number; total: number }; assert.equal(certificates.page, 1); assert.equal(certificates.total, 1);
    await api("reject certificate status query", "/destruction-certificates?status=completed", { expected: 422 });
    const erased = await (await api("read metadata with original answers hidden", "/submissions/" + s.submissionId)).json() as { values: unknown }; assert.deepEqual(erased.values, {});
    await api("erased file cannot be downloaded", "/files/" + s.fileId + "/download?submissionId=" + s.submissionId + "&questionId=" + s.fileQuestionId, { expected: 410 });
    await api("old note replay cannot return erased plaintext", "/submissions/" + s.submissionId + "/notes", { method: "POST", expected: 410, value: { text: "Synthetic private note" }, headers: { "Idempotency-Key": noteKey } });
    await call("schedule route HTTP reachable; current UI still uninspected", "/log/destruction-schedule");
    await call("certificate route HTTP reachable; current UI still uninspected", "/log/destruction_certificate");
    s.businessHash = (await snapshot(s)).hash; assert.equal(await preserved(s), s.preservedHash); await persist(s);
    await writeFile(out + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, snapshot: await snapshot(s), originalCompanies: s.originalCompanyIds.length,
      originalUsers: s.originalUserIds.length, preservedOriginalsUnchanged: true, workerScope: { tenantId: s.companyId, requestId: s.requestId }, globalWorkerRun: false, browserInspected: false, providerProtocolVerified: false }, null, 2) + "\n");
  } else {
    const s = JSON.parse(await readFile(checkpoint, "utf8")) as State;
    assert.equal((await snapshot(s)).hash, s.businessHash); assert.equal(await preserved(s), s.preservedHash);
    if (phase === "finish") {
      await api("close prepared owner session after restart", "/auth/sign-out", { method: "POST", cookie: s.ownerCookie, value: {} });
      cookie = responseCookies(await api("fresh login after server restart", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email: s.email, password: s.password } }));
      const list = await (await api("persisted requests have current actions", "/destruction-requests?submissionId=" + s.submissionId)).json() as { items: DestructionRecord[] };
      assert.equal(list.items.length, 2); assert(list.items.some(row => row.status === "completed")); assert(list.items.every(row => Object.values(row.permissions).every(value => !value)));
      assert((await (await api("persisted certificate remains verified", "/destruction-certificates/" + s.certificateId)).json()).integrityVerified);
      await api("erased file stays denied after restart", "/files/" + s.fileId + "/download?submissionId=" + s.submissionId + "&questionId=" + s.fileQuestionId, { expected: 410 });
      await api("log out fresh synthetic owner", "/auth/sign-out", { method: "POST", value: {} });
      await api("closed session cannot read certificate", "/destruction-certificates/" + s.certificateId, { expected: 401 }); cookie = "";
      assert.equal((await snapshot(s)).hash, s.businessHash); assert.equal(await preserved(s), s.preservedHash);
      await writeFile(out + "http-restart.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, businessUnchanged: true, originalsUnchanged: true, browserInspected: false }, null, 2) + "\n");
    } else {
      const snap = await snapshot(s); assert.equal(snap.status, "destroyed");
      for (const count of [snap.answers, snap.notes, snap.corrections, snap.receipts, await db.verificationReceipt.count({ where: { submissionId: s.submissionId } }),
        await db.correctionPayload.count({ where: { correction: { submissionId: s.submissionId } } }), await db.session.count({ where: { userId: s.userId, expiresAt: { gt: new Date() } } })]) assert.equal(count, 0);
      const file = await db.fileObject.findUniqueOrThrow({ where: { id: s.fileId } }); assert.equal(file.status, "deleted"); assert.equal(file.nameCipher, null); assert.equal(file.sha256, null); assert.equal(file.size, 0);
      await assert.rejects(lstat(resolve(env.PRIVATE_STORAGE_DIR, "objects", s.storageKey + ".enc")), { code: "ENOENT" });
      const caches = await db.idempotencyRecord.findMany({ where: { tenantId: s.companyId, resourceId: { in: [s.submissionId, s.fileId] } } }); assert(caches.length > 0); assert(caches.every(row => row.invalidatedAt && !row.responseCipher && !row.requestHash));
      const requests = await db.destructionRequest.findMany({ where: { submissionId: s.submissionId } }); assert(requests.every(row => !row.reasonCipher && !row.decisionCipher));
      await writeFile(out + "database.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", snapshot: snap, originalCompanies: s.originalCompanyIds.length, originalUsers: s.originalUserIds.length,
        originalsUnchanged: true, syntheticSessions: 0, remainingOriginals: 0, encryptedObjectRemoved: true, cachesInvalidated: caches.length, requestReasonsErased: requests.length,
        globalWorkerRun: false, workerScope: { tenantId: s.companyId, requestId: s.requestId }, checkpointMode: (await lstat(checkpoint)).mode & 0o777, providerProtocolVerified: false }, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ phase, result: "passed", httpCases: cases.length, globalWorkerRun: false }));
} catch (error) {
  if (cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  await writeFile(out + "http-" + phase + "-failure.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, failure: error instanceof Error ? error.message : "FAILED", globalWorkerRun: false }, null, 2) + "\n");
  throw error;
} finally { await db.$disconnect(); }
