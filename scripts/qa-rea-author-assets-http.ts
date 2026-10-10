import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { crc32 } from "node:zlib";
import type { AuthorAssetUploadInfo, AuthorAssetManifest } from "../src/contracts/author-assets";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { versionInclude } from "../src/server/forms";

// Root invokes this against the running local production server, outside other QA writes.
const origin = "http://localhost:3100";
const directory = resolve(".local/rea-fullstack/author-assets");
const fixtureFile = directory + "/fixture.json", probeFile = directory + "/http-probes.json", lockFile = directory + "/http-probes.lock";
const output = resolve("docs/qa/R08-T02/question-metadata/author-assets/http-boundaries");
const mode = process.argv[2], runId = randomUUID();
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type Sample = { path: string; name: string; mime: string; purpose: string; size: number; sha256: string };
type Fixture = { format: number; cookie: string; companyId: string; serviceId: string; memberId: string; formId: string;
  authored?: { assetIds: string[] }; samples: Record<string, Sample>; hash?: string; frozenAt?: string };
type Input = { serviceId: string; purpose: string; name: string; mime: string; size: number; sha256: string };
type Reservation = { label: string; key: string; input: Input; attemptedAt?: string; id?: string;
  cleanup: "planned" | "pending" | "not-created" | "deleted" | "unresolved"; cleanupFailure?: string };
type HttpCheck = { action: string; status: number; code?: string; expectedStatus: number; expectedCode?: string };
type Case = { name: string; result: "passed" | "failed"; startedAt: string; finishedAt: string; errorType?: string };
type Probe = { format: 1; companyId: string; serviceId: string; formId: string; memberId: string; startedAt: string;
  baselineHash: string; baselineAssetIds: string[]; reservations: Reservation[];
  cases: Case[]; checks: HttpCheck[]; runFinishedAt?: string; runResult?: "passed" | "failed" };
let f: Fixture, p: Probe | undefined, step = "validate local environment", locked = false;
const checks: HttpCheck[] = [], cases: Case[] = [];
const failures: { phase: string; errorType: string }[] = [];
let preserved: boolean | undefined, cleaned: boolean | undefined;
let afterHash: string | undefined;
const errorType = (error: unknown) => error instanceof Error ? error.name : "UnknownError";

async function guard() {
  const current = JSON.parse(await readFile(fixtureFile, "utf8")) as Fixture;
  assert.equal(current.format, 1); assert(!current.hash && !current.frozenAt, "Frozen fixture rejects this helper");
  if (f) for (const key of ["companyId", "serviceId", "memberId", "formId"] as const) assert.equal(current[key], f[key]);
  return current;
}
async function save() {
  await guard(); assert(p);
  const temp = probeFile + "." + runId + ".tmp";
  await writeFile(temp, JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, probeFile); await chmod(probeFile, 0o600);
}
async function request<T = unknown>(action: string, path: string, expectedStatus: number, options: {
  method?: string; json?: unknown; bytes?: Buffer; mime?: string; key?: string; anonymous?: boolean; code?: string; reservation?: Reservation;
} = {}): Promise<T> {
  await guard(); step = action;
  const headers: Record<string, string> = { origin };
  if (!options.anonymous) headers.cookie = f.cookie;
  if (options.key) headers["idempotency-key"] = options.key;
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.mime) headers["content-type"] = options.mime;
  const response = await fetch(origin + "/api/v1" + path, { method: options.method ?? (options.json === undefined ? "GET" : "POST"),
    redirect: "error", signal: AbortSignal.timeout(45000), headers,
    ...(options.bytes ? { body: new Uint8Array(options.bytes) } : options.json !== undefined ? { body: JSON.stringify(options.json) } : {}) });
  // No bodies, URLs/tokens, cookies, error message, or stack are retained in artifacts.
  const value = await response.json().catch(() => null);
  // Even an unexpected status can have committed a reservation. Persist its ID before assertions.
  if (options.reservation && typeof value?.id === "string" && /^[0-9a-f-]{36}$/i.test(value.id)) {
    options.reservation.id = value.id; await save();
  }
  const rawCode: unknown = value?.error?.code;
  const code = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : undefined;
  const check = { action, status: response.status, ...(code ? { code } : {}), expectedStatus,
    ...(options.code ? { expectedCode: options.code } : {}) };
  checks.push(check); if (p) { p.checks.push(check); await save(); }
  assert.equal(response.status, expectedStatus);
  if (options.code) assert.equal(code, options.code);
  return value as T;
}
async function scenario(name: string, operation: () => Promise<void>) {
  const startedAt = new Date().toISOString(); step = name;
  try {
    await operation(); const result: Case = { name, result: "passed", startedAt, finishedAt: new Date().toISOString() };
    cases.push(result); p!.cases.push(result); await save();
  } catch (error) {
    const result: Case = { name, result: "failed", startedAt, finishedAt: new Date().toISOString(), errorType: errorType(error) };
    cases.push(result); p!.cases.push(result); await save(); throw error;
  }
}
async function snapshot() {
  const probes = p?.reservations.flatMap(r => r.id ? [r.id] : []) ?? [];
  // Audit/idempotency/rate/session rows intentionally change during real HTTP requests.
  return db.$transaction(async tx => ({
    forms: await tx.form.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: {
      versions: { orderBy: { number: "asc" }, include: versionInclude }, publications: { orderBy: { id: "asc" } } } }),
    templates: await tx.formTemplate.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    approvals: await tx.approvalRequest.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    assets: await tx.authorAsset.findMany({ where: { tenantId: f.companyId, id: { notIn: probes } }, include: { blob: true }, orderBy: { id: "asc" } }),
    pins: await tx.authorAssetReference.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    submissions: await tx.submission.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: {
      answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } }),
    corrections: await tx.correction.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { payload: true } }),
    shares: await tx.shareGrant.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: {
      fields: { orderBy: { questionId: "asc" } }, challenges: { orderBy: { id: "asc" } }, sessions: { orderBy: { id: "asc" } } } }),
  }), { isolationLevel: "RepeatableRead" });
}
async function verifyBaseline() {
  step = "verify protected database fingerprint"; assert(p); await guard();
  const current = await snapshot();
  afterHash = sha(JSON.stringify(current));
  assert.deepEqual(current.assets.map(a => a.id), p.baselineAssetIds);
  assert.equal(afterHash, p.baselineHash); preserved = true;
}
async function reserve(label: string, input: Input) {
  assert(p && !p.reservations.some(r => r.label === label));
  const reservation: Reservation = { label, key: randomUUID(), input, cleanup: "planned" };
  p.reservations.push(reservation); await save();
  reservation.attemptedAt = new Date().toISOString(); reservation.cleanup = "pending"; await save();
  const info = await request<AuthorAssetUploadInfo>(label + ": reserve upload", "/author-assets/uploads", 201, { json: input, key: reservation.key, reservation });
  reservation.id = info.id; await save();
  await assertOwnProbe(reservation); return { reservation, info };
}
async function rejectInit(label: string, input: Input) {
  assert(p);
  const before = await db.authorAsset.count({ where: { tenantId: f.companyId } });
  const r: Reservation = { label, input, key: randomUUID(), attemptedAt: new Date().toISOString(), cleanup: "pending" };
  p.reservations.push(r); await save();
  await request(label, "/author-assets/uploads", 422, { json: input, key: r.key, code: "VALIDATION_ERROR", reservation: r });
  assert(!r.id);
  assert.equal(await db.authorAsset.count({ where: { tenantId: f.companyId } }), before);
  assert.equal(await db.idempotencyRecord.count({ where: { scope: "author-asset:upload:" + f.memberId, key: r.key } }), 0);
  r.cleanup = "not-created"; await save();
}
async function recoverReservationIds() {
  assert(p);
  for (const r of p.reservations) if (!r.id && r.attemptedAt && r.cleanup !== "not-created") {
    const cached = await db.idempotencyRecord.findUnique({ where: { scope_key: { scope: "author-asset:upload:" + f.memberId, key: r.key } } });
    if (cached?.resourceType === "author-asset" && cached.tenantId === f.companyId && cached.resourceId) { r.id = cached.resourceId; await save(); }
    // A timed-out request may still be committing: no cache row is not proof that no reservation exists.
    else { r.cleanup = "unresolved"; r.cleanupFailure = "ReservationOutcomeUnknown"; await save(); }
  }
}
async function assertOwnProbe(r: Reservation) {
  assert(p && r.id && !p.baselineAssetIds.includes(r.id));
  const row = await db.authorAsset.findUniqueOrThrow({ where: { id: r.id }, include: { blob: true } });
  assert.equal(row.tenantId, f.companyId); assert.equal(row.serviceId, f.serviceId); assert.equal(row.createdById, f.memberId);
  assert.equal(row.ownerKind, "company"); assert.equal(row.size, r.input.size); assert.equal(row.blob.sha256, r.input.sha256);
  assert.equal(await db.authorAssetReference.count({ where: { assetId: row.id } }), 0);
  return row;
}
async function cleanup() {
  assert(p); await guard(); await recoverReservationIds();
  let complete = true;
  for (const r of p.reservations) {
    if (!r.attemptedAt || r.cleanup === "not-created") continue;
    if (!r.id) { complete = false; continue; }
    try {
      const row = await assertOwnProbe(r);
      if (row.status !== "deleted") {
        const info = await request<AuthorAssetUploadInfo>(r.label + ": read current cleanup version", "/author-assets/uploads/" + r.id, 200);
        await request(r.label + ": delete unreferenced reservation", "/author-assets/uploads/" + r.id + "?version=" + info.version, 204, { method: "DELETE" });
      }
      await request(r.label + ": deleted reservation is unavailable", "/author-assets/uploads/" + r.id, 410, { code: "AUTHOR_ASSET_EXPIRED" });
      const removed = await assertOwnProbe(r);
      assert.equal(removed.status, "deleted"); assert.equal(removed.nameCipher, null); assert.equal(removed.blob.status, "deleted");
      assert.equal(await db.authorAsset.count({ where: { blobId: removed.blobId, status: { not: "deleted" } } }), 0);
      const cached = await db.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope: "author-asset:upload:" + f.memberId, key: r.key } } });
      assert(cached.invalidatedAt); assert.equal(cached.responseCipher, null);
      r.cleanup = "deleted"; delete r.cleanupFailure; await save();
    } catch (error) {
      complete = false; r.cleanup = "unresolved"; r.cleanupFailure = errorType(error); await save();
      failures.push({ phase: r.label + ": cleanup", errorType: errorType(error) });
    }
  }
  cleaned = complete; assert(complete, "Not every probe asset was removed by the API");
}
async function infectedDocx() {
  // Standard harmless antivirus test signature, never saved to disk or included in reports.
  const signature = "X5O!P%@AP[4" + String.fromCharCode(92) + "PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  const base = new URL("../tests/fixtures/author-assets/", import.meta.url);
  const entries = [
    ["[Content_Types].xml", Buffer.from((await readFile(new URL("content-types.xml", base), "utf8"))
      .replace("</Types>", '<Default Extension="txt" ContentType="text/plain"/></Types>'))],
    ["_rels/.rels", await readFile(new URL("relationships.xml", base))],
    ["word/document.xml", await readFile(new URL("document.xml", base))],
    ["word/embeddings/test.txt", Buffer.from(signature)],
  ] as const;
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [path, data] of entries) {
    const name = Buffer.from(path), local = Buffer.alloc(30), header = Buffer.alloc(46), crc = crc32(data);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
    locals.push(local, name, data); central.push(header, name); offset += local.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

async function run() {
  const baseline = await snapshot();
  assert.equal(new Set(f.authored?.assetIds).size, 3, "First capture the three authored assets");
  for (const id of f.authored!.assetIds) {
    const asset = baseline.assets.find(a => a.id === id); assert(asset);
    assert.equal(asset.status, "ready"); assert.equal(asset.blob.scanStatus, "clean"); assert.equal(asset.createdById, f.memberId);
    assert(baseline.pins.some(pin => pin.assetId === id));
  }
  const form = baseline.forms.find(row => row.id === f.formId); assert(form);
  const publication = form.publications.find(row => row.status === "active"); assert(publication);
  assert(baseline.submissions.some(row => form.versions.some(version => version.id === row.formVersionId)), "Submit the UI fixture before these probes");
  const token = decrypt<string>(publication.tokenCipher);
  const sample = f.samples["reference-a"]; assert(sample && resolve(sample.path).startsWith(directory + "/"));
  const bytes = await readFile(sample.path); assert.equal(bytes.length, sample.size); assert.equal(sha(bytes), sample.sha256);
  const input: Input = { serviceId: f.serviceId, purpose: "QUESTION_MATERIAL", name: "http-probe.pdf", mime: "application/pdf", size: bytes.length, sha256: sha(bytes) };
  p = { format: 1, companyId: f.companyId, serviceId: f.serviceId, formId: f.formId, memberId: f.memberId,
    startedAt: new Date().toISOString(), baselineHash: sha(JSON.stringify(baseline)), baselineAssetIds: baseline.assets.map(a => a.id),
    reservations: [], cases: [], checks: [] };
  // wx protects a partial/finished run from accidental replay or a second set of reservations.
  await writeFile(probeFile, JSON.stringify(p, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const scope = "?kind=form&id=" + f.formId + "&version=" + form.version;
  const memberManifest = await request<AuthorAssetManifest>("positive control: authenticated current form manifest", "/author-assets" + scope, 200);
  assert(memberManifest.items.length > 0);
  const publicManifest = await request<AuthorAssetManifest>("positive control: active public manifest", "/public/forms/" + token + "/author-assets", 200, { anonymous: true });
  const publicIds = [...new Set(baseline.pins.filter(pin => pin.formVersionId === publication.formVersionId).map(pin => pin.assetId))].sort();
  assert(publicIds.length > 0); assert.deepEqual(publicManifest.items.map(item => item.id).sort(), publicIds);
  await scenario("anonymous member request is 401", async () => {
    await request("anonymous manifest", "/author-assets" + scope, 401, { anonymous: true, code: "UNAUTHENTICATED" });
  });
  await scenario("stale form scope is 409", async () => {
    assert(form.version > 1, "The authored and published fixture must have a previous revision");
    await request("stale manifest version", "/author-assets?kind=form&id=" + f.formId + "&version=" + (form.version - 1), 409, { code: "VERSION_CONFLICT" });
  });
  await scenario("mixed scope query is 422", async () => {
    await request("form query with extra parent", "/author-assets" + scope + "&templateId=" + randomUUID(), 422, { code: "VALIDATION_ERROR" });
  });
  await scenario("duplicate query is 422", async () => {
    await request("duplicate kind query", "/author-assets" + scope + "&kind=template", 422, { code: "VALIDATION_ERROR" });
  });
  await scenario("pinned ready asset cannot be discarded", async () => {
    const id = f.authored!.assetIds[0];
    const info = await request<AuthorAssetUploadInfo>("pinned asset current version", "/author-assets/uploads/" + id, 200);
    assert.equal(info.status, "ready");
    await request("discard pinned ready asset", "/author-assets/uploads/" + id + "?version=" + info.version, 409, { method: "DELETE", code: "AUTHOR_ASSET_IN_USE" });
  });
  await scenario("wrong purpose and MIME are rejected before reservation", async () => {
    await rejectInit("invalid purpose MIME", { ...input, purpose: "OPTION_IMAGE" });
  });
  await scenario("oversize reservation is rejected before storage", async () => {
    await rejectInit("oversize material", { ...input, size: 5 * 1024 * 1024 + 1 });
  });
  const { reservation: pdf, info } = await reserve("clean PDF", input);
  await scenario("same key replays one reservation", async () => {
    const before = await db.authorAsset.count({ where: { tenantId: f.companyId } });
    const replay = await request<AuthorAssetUploadInfo>("idempotent reservation", "/author-assets/uploads", 201, { json: input, key: pdf.key });
    assert.equal(replay.id, info.id); assert.equal(await db.authorAsset.count({ where: { tenantId: f.companyId } }), before);
  });
  await scenario("raw content MIME mismatch is 415", async () => {
    await request("wrong content MIME", "/author-assets/uploads/" + pdf.id + "/content", 415, { method: "PUT", bytes, mime: "image/png", code: "FILE_CONTENT_TYPE" });
    assert.equal((await assertOwnProbe(pdf)).status, "pending");
  });
  await scenario("same length corrupted bytes fail SHA256", async () => {
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
    await request("corrupt content hash", "/author-assets/uploads/" + pdf.id + "/content", 422, { method: "PUT", bytes: corrupt, mime: input.mime, code: "AUTHOR_ASSET_INTEGRITY" });
    assert.equal((await assertOwnProbe(pdf)).status, "pending");
  });
  await scenario("clean but unbound asset is absent from public scope", async () => {
    await request("upload valid PDF", "/author-assets/uploads/" + pdf.id + "/content", 200, { method: "PUT", bytes, mime: input.mime });
    const ready = await request<AuthorAssetUploadInfo>("scan actual PDF", "/author-assets/uploads/" + pdf.id + "/complete", 200, { method: "POST" });
    assert.equal(ready.status, "ready"); const row = await assertOwnProbe(pdf);
    assert.equal(row.blob.scanStatus, "clean"); assert.match(row.blob.scanEngine!, /^ClamAV /); assert(row.blob.scannedAt);
    await request("public unbound PDF", "/public/forms/" + token + "/author-assets/" + pdf.id + "/download", 404, { anonymous: true, code: "NOT_FOUND" });
  });
  await scenario("actual ClamAV rejects in-memory EICAR DOCX", async () => {
    const docx = await infectedDocx(), mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const { reservation } = await reserve("antivirus DOCX", { ...input, name: "antivirus-probe.docx", mime, size: docx.length, sha256: sha(docx) });
    try {
      await request("upload structurally valid DOCX", "/author-assets/uploads/" + reservation.id + "/content", 200, { method: "PUT", bytes: docx, mime });
      await request("scan antivirus test DOCX", "/author-assets/uploads/" + reservation.id + "/complete", 422, { method: "POST", code: "AUTHOR_ASSET_UNSAFE" });
      const row = await assertOwnProbe(reservation);
      assert.equal(row.status, "rejected"); assert.equal(row.blob.status, "quarantined"); assert.equal(row.blob.scanStatus, "infected");
      assert.match(row.blob.scanEngine!, /^ClamAV /); assert(row.blob.scannedAt);
      await request("infected DOCX preview unavailable", "/author-assets/uploads/" + reservation.id + "/download", 409, { code: "AUTHOR_ASSET_NOT_READY" });
    } finally { docx.fill(0); }
  });
  assert.equal(cases.length, 12);
}

try {
  assert(["run", "cleanup", "verify"].includes(mode));
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(new URL(process.env.BETTER_AUTH_URL!).origin, origin);
  f = await guard(); assert(f.companyId && f.serviceId && f.memberId && f.formId && f.cookie);
  await chmod(directory, 0o700);
  await writeFile(lockFile, JSON.stringify({ runId, pid: process.pid, mode, at: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 }); locked = true;
  if (mode === "run") {
    // Do not load or rewrite an existing run, even from the failure cleanup path.
    try { await readFile(probeFile); throw new Error("ExistingProbeRun"); } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    try { await run(); } catch (error) { failures.push({ phase: step, errorType: errorType(error) }); }
    if (p) {
      try { await cleanup(); } catch (error) { failures.push({ phase: "cleanup", errorType: errorType(error) }); }
      try { await verifyBaseline(); } catch (error) { failures.push({ phase: "baseline", errorType: errorType(error) }); preserved = false; }
      p.runFinishedAt = new Date().toISOString(); p.runResult = failures.length ? "failed" : "passed"; await save();
    }
  } else {
    p = JSON.parse(await readFile(probeFile, "utf8")) as Probe; assert.equal(p.format, 1);
    for (const field of ["companyId", "serviceId", "formId", "memberId"] as const) assert.equal(p[field], f[field]);
    if (mode === "cleanup") {
      try { await cleanup(); } catch (error) { failures.push({ phase: "cleanup", errorType: errorType(error) }); }
    }
    else {
      // verify does no HTTP/DB writes; cleanup success is not success of all twelve scenarios.
      for (const r of p.reservations) if (r.attemptedAt && r.cleanup !== "not-created") {
        assert.equal(r.cleanup, "deleted"); assert.equal((await assertOwnProbe(r)).status, "deleted");
      }
      cleaned = true;
    }
    await verifyBaseline();
  }
} catch (error) { failures.push({ phase: step, errorType: errorType(error) }); }
finally {
  if (locked) await unlink(lockFile).catch(() => {});
  await db.$disconnect();
  const result = { format: 1, mode, runId, recordedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed",
    executedCases: cases, checks, failures, protectedDatabaseUnchanged: preserved ?? null, probeCleanupComplete: cleaned ?? null,
    databaseFingerprint: { before: p?.baselineHash ?? null, after: afterHash ?? null, protectedAssets: p?.baselineAssetIds.length ?? null },
    originalProbeRunResult: p?.runResult ?? null, scope: "Local production HTTP; database observations only; no mocked scan or ready/clean writes" };
  // This artifact is generated only by an actual invocation, for successes and failures alike.
  await mkdir(output, { recursive: true });
  await writeFile(output + "/" + mode + "-" + runId + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ mode, result: result.result, executedCases: cases.length, passedCases: cases.filter(c => c.result === "passed").length,
    protectedDatabaseUnchanged: result.protectedDatabaseUnchanged, probeCleanupComplete: result.probeCleanupComplete, report: output + "/" + mode + "-" + runId + ".json" }));
  if (failures.length) process.exitCode = 1;
}
