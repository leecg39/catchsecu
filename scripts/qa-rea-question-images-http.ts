import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuthorAssetUploadInfo, AuthorAssetManifest } from "../src/contracts/author-assets";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { contentDto, versionInclude } from "../src/server/forms";
import { privateFiles } from "../src/server/file-storage";

// Root invokes this against the running local production server, outside other QA writes.
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert(["http://localhost:3100", "http://localhost:3108"].includes(origin), "Only the isolated local QA server is allowed");
const directory = resolve(".local/rea-fullstack/question-images");
const fixtureFile = directory + "/fixture.json", probeFile = directory + "/http-probes.json", lockFile = directory + "/http-probes.lock";
const output = resolve("docs/qa/R08-T02/question-metadata/content-images/http-boundaries");
const mode = process.argv[2], runId = randomUUID();
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type Sample = { path: string; name: string; mime: string; size: number; sha256: string };
type Fixture = { format: number; cookie: string; companyId: string; serviceId: string; memberId: string; formId: string;
  preparedAt?: string; questionIds: string[]; original?: { versionId: string; publicationId: string; token: string; questionImageKeys: string[] };
  submission?: { id: string; receiptHash: string }; samples: Record<string, Sample>; hash?: string; frozenAt?: string };
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
  assert.equal(current.format, 1); assert(current.preparedAt && current.original && current.submission, "Capture the original publication and submission first"); assert(!current.hash && !current.frozenAt, "Frozen fixture rejects this helper");
  if (f) for (const key of ["companyId", "serviceId", "memberId", "formId"] as const) assert.equal(current[key], f[key]);
  if (f) {
    assert.equal(current.original!.versionId, f.original!.versionId);
    assert.equal(current.submission!.id, f.submission!.id);
  }
  return current;
}
async function save() {
  await guard(); assert(p);
  const temp = probeFile + "." + runId + ".tmp";
  await writeFile(temp, JSON.stringify(p, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, probeFile); await chmod(probeFile, 0o600);
}
async function request<T = unknown>(action: string, path: string, expectedStatus: number, options: {
  method?: string; json?: unknown; bytes?: Buffer; mime?: string; key?: string; anonymous?: boolean; code?: string; reservation?: Reservation; expectedBytes?: Buffer;
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
  const value = options.expectedBytes && response.ok ? null : await response.json().catch(() => null);
  let downloaded: Buffer | undefined;
  if (options.expectedBytes && response.ok) downloaded = Buffer.from(await response.arrayBuffer());
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
  if (options.expectedBytes) {
    assert(downloaded); assert.equal(downloaded.length, options.expectedBytes.length);
    assert.equal(sha(downloaded), sha(options.expectedBytes));
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
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
  await guard();
  const probes = p?.reservations.flatMap(r => r.id ? [r.id] : []) ?? [];
  // Audit/idempotency/rate/session rows intentionally change during real HTTP requests.
  const state = await db.$transaction(async tx => ({
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
  // Protect stored bytes as well as metadata. The probe reservations are excluded
  // only after their IDs are recorded; an unknown outcome fails the baseline.
  const bytes = [];
  for (const blob of [...new Map(state.assets.filter(a => a.status === "ready").map(a => [a.blobId, a.blob])).values()].sort((a, b) => a.id.localeCompare(b.id))) {
    await guard();
    const value = await privateFiles.read(blob.storageKey);
    assert.equal(value.length, blob.size); assert.equal(sha(value), blob.sha256);
    bytes.push({ id: blob.id, size: value.length, sha256: sha(value) });
  }
  return { ...state, bytes };
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
/**
 * run is exclusive and can only create a new probe state once.
 * cleanup resumes cleanup after interruption (including recovering a committed init
 * response from the private idempotency record). It never replays successful cases
 * or converts a failed/partial run into a fully passed twelve-case run.
 * verify is DB read-only and reports preservation/cleanup separately.
 */
async function run() {
  const baseline = await snapshot();
  assert(f.original && f.submission && f.questionIds.length === 3);
  assert.equal(new Set(f.original.questionImageKeys).size, 2, "Capture the two published question images first");
  for (const id of f.original.questionImageKeys) {
    const asset = baseline.assets.find(a => a.id === id); assert(asset);
    assert.equal(asset.purpose, "QUESTION_IMAGE"); assert.equal(asset.status, "ready"); assert.equal(asset.blob.scanStatus, "clean");
    assert.equal(asset.createdById, f.memberId);
    assert(baseline.pins.some(pin => pin.assetId === id && pin.formVersionId === f.original!.versionId && pin.slot === "question"));
  }
  const form = baseline.forms.find(row => row.id === f.formId); assert(form);
  const publication = form.publications.find(row => row.status === "active"); assert(publication);
  const submission = baseline.submissions.find(row => row.id === f.submission!.id); assert(submission);
  assert.equal(submission.formVersionId, f.original.versionId);
  const receipt = submission.receipts.find(row => row.pdfHash === f.submission!.receiptHash); assert(receipt?.pdfCipher);
  assert.equal(sha(Buffer.from(decrypt<string>(receipt.pdfCipher), "base64")), f.submission.receiptHash);
  const token = decrypt<string>(publication.tokenCipher);
  const current = form.versions.find(row => row.status === "draft") ?? form.versions.find(row => row.id === form.publishedVersionId);
  assert(current);
  const content = contentDto(current);
  const firstIndex = content.questions.findIndex(question => question.id === f.questionIds[0]);
  const optionIndex = content.questions.findIndex(question => question.id === f.questionIds[1]);
  assert(firstIndex >= 0 && optionIndex >= 0);
  assert.equal(content.questions[optionIndex].type, "객관식 답변");
  assert(content.questions[optionIndex].optionDefinitions?.length);
  const sample = f.samples.original; assert(sample && resolve(sample.path).startsWith(directory + "/"));
  const bytes = await readFile(sample.path); assert.equal(sample.mime, "image/png");
  assert.equal(bytes.length, sample.size); assert.equal(sha(bytes), sample.sha256);
  const input: Input = { serviceId: f.serviceId, purpose: "QUESTION_IMAGE", name: "http-question-probe.png", mime: "image/png", size: bytes.length, sha256: sha(bytes) };
  p = { format: 1, companyId: f.companyId, serviceId: f.serviceId, formId: f.formId, memberId: f.memberId,
    startedAt: new Date().toISOString(), baselineHash: sha(JSON.stringify(baseline)), baselineAssetIds: baseline.assets.map(a => a.id),
    reservations: [], cases: [], checks: [] };
  await writeFile(probeFile, JSON.stringify(p, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const scope = "?kind=form&id=" + f.formId + "&version=" + form.version;
  const member = await request<AuthorAssetManifest>("positive control: current member manifest", "/author-assets" + scope, 200);
  const memberIds = [...new Set(baseline.pins.filter(pin => pin.formVersionId === current.id).map(pin => pin.assetId))].sort();
  assert.deepEqual(member.items.map(item => item.id).sort(), memberIds);
  const publicManifest = await request<AuthorAssetManifest>("positive control: active public manifest", "/public/forms/" + token + "/author-assets", 200, { anonymous: true });
  const publicIds = [...new Set(baseline.pins.filter(pin => pin.formVersionId === publication.formVersionId).map(pin => pin.assetId))].sort();
  assert(publicIds.length > 0); assert.deepEqual(publicManifest.items.map(item => item.id).sort(), publicIds);
  async function rejectPatch(action: string, changed: typeof content, code: string) {
    await request(action, "/forms/" + f.formId + "/draft", 422, { method: "PATCH", key: randomUUID(),
      json: { version: form!.version, content: changed }, code });
    await verifyBaseline();
  }
  await scenario("anonymous member request is 401", async () => {
    await request("anonymous manifest", "/author-assets" + scope, 401, { anonymous: true, code: "UNAUTHENTICATED" });
  });
  await scenario("stale form scope is 409", async () => {
    assert(form.version > 1);
    await request("stale form scope", "/author-assets?kind=form&id=" + f.formId + "&version=" + (form.version - 1), 409, { code: "VERSION_CONFLICT" });
  });
  await scenario("mixed and repeated scope queries are 422", async () => {
    await request("mixed parent query", "/author-assets" + scope + "&submissionId=" + f.submission!.id, 422, { code: "VALIDATION_ERROR" });
    await request("duplicate version query", "/author-assets" + scope + "&version=" + form.version, 422, { code: "VALIDATION_ERROR" });
  });
  await scenario("QUESTION_IMAGE oversize and non-image MIME init are 422 before reservation", async () => {
    await rejectInit("question image over 1MiB", { ...input, size: 1024 * 1024 + 1 });
    await rejectInit("question image PDF MIME", { ...input, name: "forged.pdf", mime: "application/pdf" });
  });
  await scenario("non-UUID question image key is rejected without changing published or draft rows", async () => {
    const changed = structuredClone(content); changed.questions[firstIndex].questionImageKey = "https://example.invalid/arbitrary.png";
    await rejectPatch("external URL as question image key", changed, "VALIDATION_ERROR");
  });
  await scenario("pinned historical question image cannot be discarded", async () => {
    const id = f.original!.questionImageKeys[0];
    const item = await request<AuthorAssetUploadInfo>("read pinned image revision", "/author-assets/uploads/" + id, 200);
    assert.equal(item.status, "ready"); assert.equal(item.purpose, "QUESTION_IMAGE");
    await request("discard pinned question image", "/author-assets/uploads/" + id + "?version=" + item.version, 409, { method: "DELETE", code: "AUTHOR_ASSET_IN_USE" });
  });
  const clean = await reserve("clean question PNG", input);
  await scenario("raw wrong MIME, hash mismatch and forged PNG body remain pending", async () => {
    await request("wrong raw upload MIME", "/author-assets/uploads/" + clean.info.id + "/content", 415,
      { method: "PUT", bytes, mime: "application/pdf", code: "FILE_CONTENT_TYPE" });
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
    await request("same-size SHA mismatch", "/author-assets/uploads/" + clean.info.id + "/content", 422,
      { method: "PUT", bytes: corrupt, mime: input.mime, code: "AUTHOR_ASSET_INTEGRITY" });
    assert.equal((await assertOwnProbe(clean.reservation)).status, "pending");
    // A separate matching hash distinguishes actual byte-format validation from the hash guard.
    const forged = Buffer.alloc(64, 65);
    const spoof = await reserve("forged question PNG", { ...input, name: "forged.png", size: forged.length, sha256: sha(forged) });
    await request("forged PNG with matching SHA", "/author-assets/uploads/" + spoof.info.id + "/content", 422,
      { method: "PUT", bytes: forged, mime: input.mime, code: "AUTHOR_ASSET_CONTENT" });
    const rejected = await assertOwnProbe(spoof.reservation);
    assert.equal(rejected.status, "pending"); assert.equal(rejected.blob.status, "pending");
  });
  await scenario("real PNG init replay PUT and ClamAV complete give inline own-preview with exact hash", async () => {
    const before = await db.authorAsset.count({ where: { tenantId: f.companyId } });
    const replay = await request<AuthorAssetUploadInfo>("same init key replay", "/author-assets/uploads", 201, { json: input, key: clean.reservation.key });
    assert.equal(replay.id, clean.info.id); assert.equal(await db.authorAsset.count({ where: { tenantId: f.companyId } }), before);
    await request("upload valid question PNG", "/author-assets/uploads/" + clean.info.id + "/content", 200, { method: "PUT", bytes, mime: input.mime });
    const ready = await request<AuthorAssetUploadInfo>("scan actual question PNG", "/author-assets/uploads/" + clean.info.id + "/complete", 200, { method: "POST" });
    assert.equal(ready.status, "ready"); assert.equal(ready.purpose, "QUESTION_IMAGE");
    const row = await assertOwnProbe(clean.reservation); assert.equal(row.blob.scanStatus, "clean"); assert.match(row.blob.scanEngine!, /^ClamAV /); assert(row.blob.scannedAt);
    await request("own preview inline bytes and SHA", "/author-assets/uploads/" + clean.info.id + "/download", 200, { expectedBytes: bytes });
  });
  await scenario("ready unbound question image is absent from public and member parent scopes", async () => {
    await request("public unbound question image", "/public/forms/" + token + "/author-assets/" + clean.info.id + "/download", 404, { anonymous: true, code: "NOT_FOUND" });
    await request("member unbound question image", "/author-assets/" + clean.info.id + "/download" + scope, 404, { code: "NOT_FOUND" });
  });
  await scenario("QUESTION_IMAGE cannot be attached as FILE and leaves the entire protected graph unchanged", async () => {
    const changed = structuredClone(content);
    changed.questions[firstIndex].materialList = [{ materialType: "FILE", orderNumber: 0, fileKey: clean.info.id, linkLabel: null, linkUrl: null }];
    await rejectPatch("question image in material slot", changed, "AUTHOR_ASSET_PURPOSE");
  });
  await scenario("QUESTION_IMAGE cannot be attached as an option image and rolls back", async () => {
    const changed = structuredClone(content); changed.questions[optionIndex].optionDefinitions![0].optionImageKey = clean.info.id;
    await rejectPatch("question image in option slot", changed, "AUTHOR_ASSET_PURPOSE");
  });
  await scenario("OPTION_IMAGE cannot be attached as question image and rolls back", async () => {
    const option = await reserve("clean option PNG", { ...input, purpose: "OPTION_IMAGE", name: "http-option-probe.png" });
    await request("upload real option PNG", "/author-assets/uploads/" + option.info.id + "/content", 200, { method: "PUT", bytes, mime: input.mime });
    const ready = await request<AuthorAssetUploadInfo>("scan real option PNG", "/author-assets/uploads/" + option.info.id + "/complete", 200, { method: "POST" });
    assert.equal(ready.status, "ready"); const row = await assertOwnProbe(option.reservation);
    assert.equal(row.blob.scanStatus, "clean"); assert.match(row.blob.scanEngine!, /^ClamAV /);
    const changed = structuredClone(content); changed.questions[firstIndex].questionImageKey = option.info.id;
    await rejectPatch("option image in question slot", changed, "AUTHOR_ASSET_PURPOSE");
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
    originalProbeRunResult: p?.runResult ?? null, scope: "Local question-image production HTTP only; database observations only; no mocked scan/ready writes; not original-site or external-provider verification",
    executionPolicy: "run once; cleanup resumes interrupted reservation cleanup only; verify does not imply the twelve scenarios passed" };
  // This artifact is generated only by an actual invocation, for successes and failures alike.
  await mkdir(output, { recursive: true });
  await writeFile(output + "/" + mode + "-" + runId + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ mode, result: result.result, executedCases: cases.length, passedCases: cases.filter(c => c.result === "passed").length,
    protectedDatabaseUnchanged: result.protectedDatabaseUnchanged, probeCleanupComplete: result.probeCleanupComplete, report: output + "/" + mode + "-" + runId + ".json" }));
  if (failures.length) process.exitCode = 1;
}
