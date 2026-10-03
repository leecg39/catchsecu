import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { runOneImport } from "../src/server/import-worker";
import type { ImportJobRecord, ImportMapping, ImportPreview } from "../src/contracts/imports";

const target = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (target.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(target.hostname) || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Independent local development HTTP QA only.");
const phase = process.argv[2], out = "docs/qa/P07-T01/", checkpoint = ".local/p07-import-checkpoint.json";
if (!["prepare", "finish", "database"].includes(phase)) throw new Error("prepare, finish or database required.");
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; jobId: string; fileId: string; storageKey: string;
  originalCompanyIds: string[]; originalUserIds: string[]; preservedHash: string; preparedHash: string; finishedHash: string; ownerCookie: string; createKey: string; createInput: object };
const cases: { label: string; status: number }[] = [];
let cookie = "";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const responseCookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
async function call(label: string, path: string, options: { method?: string; value?: unknown; bytes?: Buffer; cookie?: string; expected?: number | number[]; headers?: Record<string, string> } = {}) {
  const method = options.method ?? "GET", expected = options.expected ?? 200;
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie: options.cookie ?? cookie,
    ...(method === "GET" ? {} : { origin }), ...(options.value === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers },
    ...(options.bytes ? { body: new Uint8Array(options.bytes) } : options.value === undefined ? {} : { body: JSON.stringify(options.value) }) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + ": " + response.status);
  cases.push({ label, status: response.status }); return response;
}
const api = (label: string, path: string, options?: Parameters<typeof call>[2]) => call(label, "/api/v1" + path, options);
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
  const job = await db.importJob.findUniqueOrThrow({ where: { id: s.jobId }, include: { rows: { orderBy: { rowNo: "asc" } } } });
  const file = await db.fileObject.findUniqueOrThrow({ where: { id: s.fileId } });
  const submissions = await db.submission.findMany({ where: { importJobId: s.jobId }, orderBy: { importRowNo: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } });
  const evidence = await db.importEvidence.findMany({ where: { jobId: s.jobId }, orderBy: { submissionId: "asc" } });
  return { hash: digest({ job, file, submissions, evidence }), status: job.status, importedRows: job.importedRows, leaseGeneration: job.leaseGeneration,
    totalRows: job.totalRows, validRows: job.validRows, invalidRows: job.invalidRows, skippedRows: job.skippedRows, submissions: submissions.length, evidence: evidence.length, fileStatus: file.status };
}
await mkdir(out, { recursive: true });
try {
  if (phase === "prepare") {
    const s: State = { email: "p07-import-owner-" + randomUUID() + "@catchsecu.local.test", password: "P07-Import!" + randomUUID(), userId: "", companyId: "", serviceId: "", jobId: "", fileId: "", storageKey: "",
      originalCompanyIds: (await db.company.findMany({ select: { id: true } })).map(row => row.id), originalUserIds: (await db.user.findMany({ select: { id: true } })).map(row => row.id),
      preservedHash: "", preparedHash: "", finishedHash: "", ownerCookie: "", createKey: randomUUID(), createInput: {} };
    s.preservedHash = await preserved(s); await persist(s);
    await api("signup independent owner", "/auth/sign-up/email", { method: "POST", cookie: "", value: { name: "CSV 검증", email: s.email, password: s.password } });
    const mails = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" }, take: 100 });
    const mail = mails.map(job => decrypt<{ to: string; subject: string; text: string }>(job.payloadCipher)).find(row => row.to === s.email && row.subject === "이메일 인증");
    assert(mail); const link = new URL(mail.text.match(/https?:\/\/\S+/)![0]); assert.equal(link.origin, origin);
    await call("verify own queued email token", link.pathname + link.search, { cookie: "", expected: [200, 302] });
    cookie = responseCookies(await api("login independent owner", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email: s.email, password: s.password } }));
    const user = await db.user.findUniqueOrThrow({ where: { email: s.email } }); assert(!user.platformAdmin); s.userId = user.id; s.ownerCookie = cookie;
    const company = await (await api("create independent company", "/companies", { method: "POST", expected: 201, value: { name: "P07 Import " + randomUUID(), publicName: "CSV QA" } })).json() as { id: string }; s.companyId = company.id;
    const ctx = await (await api("read own context", "/context")).json() as { company: { id: string }; services: { id: string }[] }; assert.equal(ctx.company.id, s.companyId); s.serviceId = ctx.services[0].id; await persist(s);
    const purpose = await (await api("create purpose through HTTP", "/processing-purposes", { method: "POST", expected: 201, headers: { "Idempotency-Key": randomUUID() }, value: {
      serviceId: s.serviceId, name: "CSV 합성 검증", purpose: "합성 CSV 수집 검증", lawfulBasis: "consent", basisReference: "합성 행별 동의",
      items: [{ name: "이름", kind: "general", required: true }, { name: "이메일", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] } })).json() as { id: string };
    const today = new Date().toISOString().slice(0, 10), first = "사람0,person0@example.test," + today + ",yes";
    const bytes = Buffer.from("이름,이메일,수집일,동의\n" + Array.from({ length: 55 }, (_, i) => "사람" + i + ",person" + i + "@example.test," + today + ",yes").join("\n") + "\n\"=1+1\",wrong," + today + ",yes\n" + first + "\n\n");
    s.createInput = { serviceId: s.serviceId, title: "CSV 합성 부분 반영", name: "import.csv", mime: "text/csv", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), encoding: "utf-8" }; await persist(s);
    const create = () => ({ method: "POST", expected: 201, value: s.createInput, headers: { "Idempotency-Key": s.createKey } });
    let row = await (await api("reserve import file and job", "/imports", create())).json() as ImportJobRecord; s.jobId = row.id; s.fileId = row.fileId; await persist(s);
    assert.equal((await (await api("creation replay uses same reservation", "/imports", create())).json()).id, row.id);
    await api("changed payload under same key rejected", "/imports", { ...create(), expected: 409, value: { ...s.createInput, title: "다른 제목" } });
    await api("upload actual CSV bytes", "/uploads/" + row.fileId + "/content", { method: "PUT", bytes, headers: { "Content-Type": "text/csv" } });
    await api("complete actual ClamAV scan", "/uploads/" + row.fileId + "/complete", { method: "POST" });
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: row.fileId } }); s.storageKey = file.storageKey; assert((await privateFiles.read(file.storageKey)).equals(bytes));
    row = await (await api("inspect headers and blank rows", "/imports/" + row.id + "/inspect", { method: "POST", value: { version: row.version } })).json() as ImportJobRecord;
    assert.equal(row.totalRows, 57); assert.equal((await (await api("creation replay returns current draft", "/imports", create())).json()).version, row.version);
    await api("unknown detail query rejected", "/imports/" + row.id + "?unknown=x", { expected: 422 });
    await api("duplicate list query rejected", "/imports?serviceId=" + s.serviceId + "&serviceId=" + s.serviceId, { expected: 422 });
    await api("read active mapping options", "/imports/options?serviceId=" + s.serviceId);
    const mapping: ImportMapping = { purposeId: purpose.id, fields: [{ name: "이름", column: 0, type: "text" }, { name: "이메일", column: 1, type: "email" }],
      collectedAt: { mode: "column", column: 2 }, retentionUntil: null, consentColumn: 3, evidenceColumn: null, sourceStatement: "합성 CSV 근거", source: "internal", sourceRecipientId: null };
    row = await (await api("map columns and collection basis", "/imports/" + row.id, { method: "PATCH", value: { version: row.version, mapping } })).json() as ImportJobRecord;
    await api("stale mapping version rejected", "/imports/" + row.id, { method: "PATCH", expected: 409, value: { version: row.version - 1, mapping } });
    row = await (await api("validate types consent duplicates", "/imports/" + row.id + "/validate", { method: "POST", value: { version: row.version } })).json() as ImportJobRecord;
    assert.deepEqual([row.validRows, row.invalidRows, row.skippedRows], [55, 1, 1]); assert(row.permissions.canCommit); assert.equal(await db.submission.count({ where: { importJobId: row.id } }), 0);
    const list = await (await api("ID search sort and page clamp", "/imports?serviceId=" + s.serviceId + "&search=" + row.id + "&page=999&sort=name&direction=asc&status=validated")).json() as { items: ImportJobRecord[]; page: number }; assert.equal(list.page, 1); assert.equal(list.items[0].id, row.id);
    const preview = await (await api("error preview page clamp", "/imports/" + row.id + "/rows?errorsOnly=true&page=999&pageSize=1")).json() as ImportPreview; assert.equal(preview.page, 2); assert.equal(preview.items[0].status, "duplicate");
    const csv = await api("failure CSV formula defense and no-store", "/imports/" + row.id + "/errors.csv"); assert.equal(csv.headers.get("cache-control"), "private, no-store"); assert((await csv.text()).includes('"\'=1+1"'));
    await api("unsupported row search rejected", "/imports/" + row.id + "/rows?search=x", { expected: 422 });
    await api("noncanonical If-Match rejected", "/imports/" + row.id, { method: "DELETE", expected: 422, headers: { "If-Match": "1e0" } });
    row = await (await api("request asynchronous import", "/imports/" + row.id + "/commit", { method: "POST", expected: 202, value: { version: row.version } })).json() as ImportJobRecord;
    assert(!row.permissions.canEdit); assert(!row.permissions.canClean);
    await api("running cleanup rejected", "/imports/" + row.id, { method: "DELETE", expected: 409, headers: { "If-Match": String(row.version) } });
    assert(await runOneImport("p07-http-first", new Date(), { tenantId: s.companyId, jobId: s.jobId }));
    const snap = await snapshot(s); assert.equal(snap.importedRows, 50); assert.equal(snap.status, "committing"); assert.equal(snap.fileStatus, "deleted");
    await assert.rejects(lstat(resolve(env.PRIVATE_STORAGE_DIR, "objects", s.storageKey + ".enc")), { code: "ENOENT" });
    await api("read current progress after first batch", "/imports/" + s.jobId);
    await api("erased original creation cache denied", "/imports", { ...create(), expected: 410 });
    s.preparedHash = snap.hash; assert.equal(await preserved(s), s.preservedHash); await persist(s);
    await writeFile(out + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, snapshot: snap, originalsUnchanged: true, workerScope: { tenantId: s.companyId, jobId: s.jobId }, globalWorkerRun: false, browserInspected: false }, null, 2) + "\n");
  } else {
    const s = JSON.parse(await readFile(checkpoint, "utf8")) as State; assert.equal(await preserved(s), s.preservedHash);
    if (phase === "finish") {
      assert.equal((await snapshot(s)).hash, s.preparedHash); cookie = s.ownerCookie;
      await api("persisted progress available after restart", "/imports/" + s.jobId);
      assert(await runOneImport("p07-http-final", new Date(), { tenantId: s.companyId, jobId: s.jobId }));
      let row = await (await api("current completed partial result", "/imports/" + s.jobId)).json() as ImportJobRecord;
      assert.deepEqual([row.status, row.importedRows], ["partialFailed", 55]); assert(row.permissions.canClean); assert(!row.permissions.canRetry);
      assert.equal(await runOneImport("p07-http-repeat", new Date(), { tenantId: s.companyId, jobId: s.jobId }), false);
      await api("duplicate commit cannot add responses", "/imports/" + s.jobId + "/commit", { method: "POST", expected: 409, value: { version: row.version } });
      await api("failures remain downloadable", "/imports/" + s.jobId + "/errors.csv");
      row = await (await api("archive completed job and clear staging", "/imports/" + s.jobId, { method: "DELETE", headers: { "If-Match": String(row.version) } })).json() as ImportJobRecord;
      assert.equal(row.status, "archived"); assert.deepEqual(row.headers, []); assert.equal(row.mapping, null);
      await api("archived staging preview denied", "/imports/" + s.jobId + "/rows", { expected: 410 });
      await api("archived failure download denied", "/imports/" + s.jobId + "/errors.csv", { expected: 410 });
      s.finishedHash = (await snapshot(s)).hash; await api("logout synthetic owner", "/auth/sign-out", { method: "POST", value: {} });
      await api("closed session cannot read job", "/imports/" + s.jobId, { expected: 401 }); cookie = "";
      s.ownerCookie = ""; await persist(s); assert.equal(await preserved(s), s.preservedHash);
      await writeFile(out + "http-restart.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, restartStatePreserved: true, snapshot: await snapshot(s), originalsUnchanged: true, globalWorkerRun: false, browserInspected: false }, null, 2) + "\n");
    } else {
      const snap = await snapshot(s); assert.equal(snap.hash, s.finishedHash); assert.equal(snap.submissions, 55); assert.equal(snap.evidence, 55);
      assert.equal(snap.leaseGeneration, 2); assert.equal(snap.fileStatus, "deleted");
      assert.equal(await db.importRow.count({ where: { jobId: s.jobId, OR: [{ payloadCipher: { not: null } }, { digest: { not: null } }] } }), 0);
      assert.equal(await db.session.count({ where: { userId: s.userId, expiresAt: { gt: new Date() } } }), 0);
      await assert.rejects(lstat(resolve(env.PRIVATE_STORAGE_DIR, "objects", s.storageKey + ".enc")), { code: "ENOENT" });
      await writeFile(out + "database.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", snapshot: snap, originalCompanies: s.originalCompanyIds.length, originalUsers: s.originalUserIds.length,
        originalsUnchanged: true, preservedHash: s.preservedHash, syntheticSessions: 0, stagingPayloads: 0, encryptedObjectRemoved: true, workerScope: { tenantId: s.companyId, jobId: s.jobId }, globalWorkerRun: false,
        checkpointMode: (await lstat(checkpoint)).mode & 0o777, providerProtocolVerified: false }, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ phase, result: "passed", httpCases: cases.length, globalWorkerRun: false }));
} catch (error) {
  if (cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  await writeFile(out + "http-" + phase + "-failure.json", JSON.stringify({ checkedAt: new Date().toISOString(), passed: cases.length, cases, failure: error instanceof Error ? error.message : "FAILED", globalWorkerRun: false }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
