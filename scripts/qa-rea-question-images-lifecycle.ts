import assert from "node:assert/strict";
import { legacyBodyImageColumn } from "./qa-legacy-language";
import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { contentDto, versionInclude } from "../src/server/forms";
import { privateFiles } from "../src/server/file-storage";
import { policySettings, type PolicyRecord } from "../src/contracts/security";
import type { FormRecord, FormContent, TemplateRecord } from "../src/contracts/forms";
import type { AuthorAssetManifest, AuthorAssetInfo } from "../src/contracts/author-assets";
import type { SharedPage } from "../src/contracts/sharing";

/**
 * Root runs each mode serially against localhost:3100 or :3108/catchsecu_dev, after
 * qa-rea-question-images-flow capture-original/capture-submission/assert-history.
 * Pause for Ego inspection after any mode. Nothing here accesses the older
 * frozen author-assets fixture. No SQL mutations or ready/scan bypasses exist.
 *
 * init -> template-register -> template-use -> form-copy -> template-edit -> template-delete
 * -> approval-request -> approval-invalidate -> approval-rerequest
 * -> approval-publish -> share-create -> viewer-auth -> viewer-check
 * -> share-revoke -> verify. state is an anytime read-only inspection.
 * policy-restore is optional explicit cleanup after successful publication.
 *
 * Template registration attaches same-service assets; use/copy issue new owned
 * IDs. Copies/approvals remain as inspectable evidence. Only the recorded
 * temporary template and share are deleted/revoked through their own APIs.
 * Failures preserve actual state. Idempotent operations retain exact payload/key;
 * uncertain non-idempotent operations stop for inspection instead of replaying.
 */
let origin = "";
const directory = resolve(".local/rea-fullstack/question-images");
const fixtureFile = directory + "/fixture.json", stateFile = directory + "/lifecycle.json", lockFile = directory + "/lifecycle.lock";
const output = resolve("docs/qa/R08-T02/question-metadata/content-images/lifecycle");
const mode = process.argv[2], runId = randomUUID(), sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const legacyGraphHash = (value: unknown) => sha(JSON.stringify(value, legacyBodyImageColumn));
const modes = ["init", "state", "template-register", "template-use", "form-copy", "template-edit", "template-delete", "approval-request", "approval-invalidate",
  "approval-rerequest", "approval-publish", "share-create", "viewer-auth", "viewer-check", "share-revoke", "policy-restore", "verify"];
type Fixture = { format: 1; cookie: string; password: string; companyId: string; serviceId: string; memberId: string; formId: string;
  preparedAt: string; historyVerifiedAt: string; questionIds: string[]; hash?: string; frozenAt?: string;
  original: { versionId: string; publicationId: string; contentHash: string; pinsHash: string; questionImageKeys: string[] };
  submission: { id: string; receiptHash: string } };
type Spec = { path: string; method: "POST" | "PATCH" | "DELETE"; expected: number; body?: unknown; headers?: Record<string, string>;
  cookie?: string; idempotent?: boolean; code?: string };
type Reply = { status: number; value: unknown; cookies: string; code?: string };
type Operation = { spec: Spec; key: string; phase: "pending" | "received"; reply?: Reply };
type Approval = { id: string; version: number; status: string; snapshot: { content: FormContent } };
type State = { format: 1; companyId: string; serviceId: string; memberId: string; formId: string; originalVersionId: string; submissionId: string;
  createdAt: string; operations: Record<string, Operation>; completed: Record<string, string>; originalProofHash: string;
  template?: { id: string; version: number; originalContent: FormContent; currentContent: FormContent }; usedFormId?: string; copiedFormId?: string;
  templateCheckpoints?: Record<string, { formsHash: string; questionPins: number }>;
  policyBefore?: ReturnType<typeof policySettings.parse>; firstApproval?: { id: string; version: number; snapshotHash: string; pinsHash: string; imageKey: string };
  secondApproval?: { id: string; version: number }; share?: { id: string; version: number; email: string };
  viewerCookie?: string; viewerExpiresAt?: string; viewerBytesHash?: string };
let f: Fixture, state: State | undefined, locked = false, step = "environment validation";
const checks: { action: string; status: number; expected: number; source: "live" | "journal"; code?: string }[] = [];
let proof: Record<string, unknown> = {}, failure: { step: string; errorType: string } | undefined;
const errType = (error: unknown) => error instanceof Error ? error.name : "UnknownError";
async function guard() {
  const current = JSON.parse(await readFile(fixtureFile, "utf8")) as Fixture;
  assert.equal(current.format, 1);
  assert(current.preparedAt && current.original && current.submission && current.historyVerifiedAt, "Finish actual image replacement and assert-history first");
  assert(!current.hash && !current.frozenAt || ["state", "verify"].includes(mode), "Frozen fixture permits read-only state/verify only");
  assert(current.companyId && current.serviceId && current.memberId && current.formId && current.cookie);
  if (f) for (const key of ["companyId", "serviceId", "memberId", "formId"] as const) assert.equal(current[key], f[key]);
  if (state) { assert.equal(current.original.versionId, state.originalVersionId); assert.equal(current.submission.id, state.submissionId); }
  return current;
}
async function save() {
  await guard(); assert(state);
  const temporary = stateFile + "." + runId + ".tmp";
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, stateFile); await chmod(stateFile, 0o600);
}
function checked(reply: Reply, action: string, expected: number, code?: string, source: "live" | "journal" = "live") {
  checks.push({ action, status: reply.status, expected, source, ...(reply.code ? { code: reply.code } : {}) });
  assert.equal(reply.status, expected, action); if (code) assert.equal(reply.code, code);
}
async function fetchJson(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; cookie?: string } = {}): Promise<Reply> {
  await guard();
  const response = await fetch(origin + "/api/v1" + path, { method: options.method ?? "GET", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { origin, cookie: options.cookie ?? f.cookie, ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const value = await response.json().catch(() => null), rawCode: unknown = value?.error?.code;
  const code = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : undefined;
  return { status: response.status, value, cookies: response.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; "), ...(code ? { code } : {}) };
}
async function read<T>(action: string, path: string, expected = 200, cookie?: string, code?: string) {
  step = action; const reply = await fetchJson(path, { cookie }); checked(reply, action, expected, code); return reply.value as T;
}
async function mutate<T>(label: string, make: () => Promise<Spec>): Promise<{ value: T; cookies: string }> {
  await guard(); assert(state); step = label;
  let operation = state.operations[label];
  if (!operation) {
    operation = { spec: await make(), key: randomUUID(), phase: "pending" };
    state.operations[label] = operation; await save();
  } else if (operation.phase === "pending" && !operation.spec.idempotent) {
    throw new Error("UncertainNonIdempotentOutcomeRequiresInspection");
  }
  const responseSource = operation.phase === "received" ? "journal" : "live";
  if (operation.phase === "pending") {
    const spec = operation.spec;
    const reply = await fetchJson(spec.path, { method: spec.method, body: spec.body, cookie: spec.cookie,
      headers: { ...spec.headers, ...(spec.idempotent ? { "idempotency-key": operation.key } : {}) } });
    operation.reply = reply; operation.phase = "received"; await save();
  }
  assert(operation.reply); checked(operation.reply, label, operation.spec.expected, operation.spec.code, responseSource);
  return { value: operation.reply.value as T, cookies: operation.reply.cookies };
}
async function form(id = f.formId) { return read<FormRecord>("read exact form revision", "/forms/" + id); }
async function graph(id: string) {
  await guard();
  return db.form.findFirstOrThrow({ where: { id, tenantId: f.companyId, serviceId: f.serviceId },
    include: { versions: { orderBy: { number: "asc" }, include: versionInclude }, publications: { orderBy: { id: "asc" } } } });
}
async function formAndPins(id: string) {
  const form = await graph(id);
  const refs = await db.authorAssetReference.findMany({ where: { tenantId: f.companyId, formVersionId: { in: form.versions.map(version => version.id) } }, orderBy: { id: "asc" } });
  return { form, refs };
}
async function pins(where: { formVersionId?: string; templateId?: string; approvalId?: string }) {
  await guard(); return db.authorAssetReference.findMany({ where: { tenantId: f.companyId, ...where }, orderBy: { id: "asc" } });
}
async function originalProof() {
  await guard();
  const original = await db.formVersion.findFirstOrThrow({ where: { id: f.original.versionId, tenantId: f.companyId, formId: f.formId }, include: versionInclude });
  const oldPins = await pins({ formVersionId: original.id });
  assert.equal(legacyGraphHash(original), f.original.contentHash); assert.equal(legacyGraphHash(oldPins), f.original.pinsHash);
  const publication = await db.publication.findFirstOrThrow({ where: { id: f.original.publicationId, tenantId: f.companyId, formVersionId: original.id } });
  const submission = await db.submission.findFirstOrThrow({ where: { id: f.submission.id, tenantId: f.companyId }, include: {
    answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, corrections: { include: { payload: true }, orderBy: { id: "asc" } },
  } });
  assert.equal(submission.formVersionId, original.id);
  const receipt = submission.receipts.find(row => row.pdfHash === f.submission.receiptHash); assert(receipt?.pdfCipher);
  assert.equal(sha(Buffer.from(decrypt<string>(receipt.pdfCipher), "base64")), f.submission.receiptHash);
  const bytes: { id: string; sha256: string; size: number }[] = [];
  for (const id of [...f.original.questionImageKeys].sort()) {
    const asset = await db.authorAsset.findFirstOrThrow({ where: { id, tenantId: f.companyId, serviceId: f.serviceId }, include: { blob: true } });
    assert.equal(asset.status, "ready"); assert.equal(asset.blob.scanStatus, "clean");
    const value = await privateFiles.read(asset.blob.storageKey); assert.equal(sha(value), asset.blob.sha256); assert.equal(value.length, asset.size);
    bytes.push({ id, sha256: sha(value), size: value.length });
  }
  return legacyGraphHash({ original, publication, oldPins, submission, bytes });
}
async function preserveOriginal() {
  assert(state); const actual = await originalProof(); assert.equal(actual, state.originalProofHash);
  return { originalVersionReceiptPinsAndBytesUnchanged: true, hash: actual };
}
function imageKeys(content: FormContent) { return [...new Set(content.questions.flatMap(q => q.questionImageKey ? [q.questionImageKey] : []))].sort(); }
async function copyProof(source: FormContent, targetId: string) {
  // Once the parent fixture is frozen its old browser session may expire. The
  // verify mode remains strictly read-only and reconstructs the same DTO from
  // the persisted graph; the pre-freeze lifecycle report retains the live HTTP
  // evidence. No replacement session is created because that would mutate the
  // tenant whose graph is being checked.
  const target = mode === "verify" && !!(f.hash || f.frozenAt)
    ? await graph(targetId).then(row => ({ content: contentDto(row.versions.find(version => version.status === "draft") ?? row.versions.at(-1)!) }))
    : await form(targetId);
  assert(target.content);
  assert.equal(target.content.questions.length, source.questions.length);
  const mapping = new Map<string, string>();
  for (const [index, q] of source.questions.entries()) {
    const other = target.content.questions[index]; assert.notEqual(other.id, q.id);
    if (!q.questionImageKey) { assert(!other.questionImageKey); continue; }
    assert(other.questionImageKey); assert.notEqual(other.questionImageKey, q.questionImageKey);
    if (mapping.has(q.questionImageKey)) assert.equal(mapping.get(q.questionImageKey), other.questionImageKey);
    mapping.set(q.questionImageKey, other.questionImageKey);
    const [old, owned] = await Promise.all([q.questionImageKey, other.questionImageKey].map(id => db.authorAsset.findUniqueOrThrow({ where: { id }, include: { blob: true } })));
    assert.equal(owned.tenantId, f.companyId); assert.equal(owned.serviceId, f.serviceId); assert.equal(owned.createdById, f.memberId);
    assert.equal(owned.purpose, "QUESTION_IMAGE"); assert.equal(owned.blobId, old.blobId); assert.equal(owned.size, old.size);
    assert.equal(owned.blob.sha256, old.blob.sha256); assert.equal(owned.expiresAt, null); assert.equal(owned.status, "ready");
    assert.equal(owned.blob.status, "ready"); assert.equal(owned.blob.scanStatus, "clean");
  }
  assert(mapping.size > 0); assert.equal(new Set(mapping.values()).size, mapping.size);
  const row = await graph(targetId), current = row.versions.find(v => v.status === "draft") ?? row.versions.at(-1)!;
  const refs = (await pins({ formVersionId: current.id })).filter(ref => ref.slot === "question");
  assert.equal(refs.length, target.content.questions.filter(q => q.questionImageKey).length);
  for (const q of target.content.questions.filter(q => q.questionImageKey)) assert(refs.some(ref => ref.questionKey === q.id && ref.assetId === q.questionImageKey && ref.optionKey === null && ref.orderNumber === null));
  return { targetId, copiedOwnerCount: mapping.size, newOwnedAssetBytes: (await db.authorAsset.aggregate({ where: { tenantId: f.companyId, serviceId: f.serviceId, id: { in: [...mapping.values()] } }, _sum: { size: true } }))._sum.size };
}
async function approvalProof(id: string) {
  const row = await db.approvalRequest.findFirstOrThrow({ where: { id, tenantId: f.companyId, formId: f.formId } });
  return { snapshotHash: sha(JSON.stringify(row.snapshot)), pinsHash: legacyGraphHash(await pins({ approvalId: id })), status: row.status };
}
async function preserveApproval() {
  assert(state?.firstApproval);
  const actual = await approvalProof(state.firstApproval.id);
  assert.equal(actual.snapshotHash, state.firstApproval.snapshotHash); assert.equal(actual.pinsHash, state.firstApproval.pinsHash);
  return actual;
}
async function changeDraft(label: string, change: (content: FormContent) => void) {
  return (await mutate<FormRecord>(label, async () => {
    const current = await form(); assert(current.content);
    const content = structuredClone(current.content); change(content);
    return { path: "/forms/" + f.formId + "/draft", method: "PATCH", expected: 200, idempotent: true, body: { version: current.version, content } };
  })).value;
}
async function approvalRequest(label: string) {
  return (await mutate<Approval>(label, async () => ({ path: "/forms/" + f.formId + "/approvals", method: "POST", expected: 201, idempotent: true,
    body: { version: (await form()).version, message: "Question image lifecycle", reference: "LOCAL-QI" } }))).value;
}
async function download(action: string, path: string, asset: Pick<AuthorAssetInfo, "sha256" | "size" | "mime">, cookie: string) {
  await guard(); step = action;
  const response = await fetch(origin + "/api/v1" + path, { headers: { origin, cookie }, redirect: "error", signal: AbortSignal.timeout(45000) });
  checks.push({ action, status: response.status, expected: 200, source: "live" }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), asset.mime); assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const value = Buffer.from(await response.arrayBuffer()); assert.equal(value.length, asset.size); assert.equal(sha(value), asset.sha256);
  return { sha256: sha(value), size: value.length };
}
async function currentImageBytes(id: string) {
  const current = await form(id), query = "kind=form&id=" + id + "&version=" + current.version;
  const manifest = await read<AuthorAssetManifest>("read surviving form image owners", "/author-assets?" + query);
  const expected = imageKeys(current.content);
  assert.deepEqual(manifest.items.filter(item => item.purpose === "QUESTION_IMAGE").map(item => item.id).sort(), expected);
  for (const image of manifest.items.filter(item => item.purpose === "QUESTION_IMAGE"))
    await download("image remains downloadable after template change", "/author-assets/" + image.id + "/download?" + query, image, f.cookie);
  return expected.length;
}
async function execute() {
  assert(state);
  if (mode === "state") {
    proof = { completed: Object.keys(state.completed), templateId: state.template?.id, usedFormId: state.usedFormId, copiedFormId: state.copiedFormId,
      firstApprovalId: state.firstApproval?.id, secondApprovalId: state.secondApproval?.id, shareId: state.share?.id,
      pendingOperationLabels: Object.entries(state.operations).filter(([, value]) => value.phase === "pending").map(([key]) => key) }; return;
  }
  if (mode === "verify") {
    for (const required of modes.filter(item => !["init", "state", "verify", "policy-restore"].includes(item))) assert(state.completed[required], "Missing completed lifecycle mode: " + required);
    assert((await db.shareGrant.findFirstOrThrow({ where: { id: state.share!.id, tenantId: f.companyId } })).revokedAt);
    assert.equal(await db.formTemplate.count({ where: { id: state.template!.id, tenantId: f.companyId } }), 0);
    await copyProof(state.template!.originalContent, state.usedFormId!); await copyProof(state.template!.originalContent, state.copiedFormId!); await preserveApproval();
    assert.equal((await db.approvalRequest.findFirstOrThrow({ where: { id: state.secondApproval!.id, tenantId: f.companyId, formId: f.formId } })).status, "consumed");
    assert.equal(await db.publication.count({ where: { tenantId: f.companyId, formId: f.formId, approvalId: state.secondApproval!.id } }), 1);
    proof = { ...await preserveOriginal(), completedModes: Object.keys(state.completed) }; return;
  }
  assert(!state.completed[mode], "This mode already completed; use state/verify");
  if (mode === "template-register") {
    const saved = (await mutate<TemplateRecord>("template-register", async () => {
      const current = await form(); assert(current.content);
      return { path: "/templates", method: "POST", expected: 201, idempotent: true,
        body: { serviceId: f.serviceId, title: "QI lifecycle template", category: "QA", content: current.content } };
    })).value;
    state.template = { id: saved.id, version: saved.version, originalContent: saved.content, currentContent: saved.content }; await save();
    const source = (state.operations["template-register"].spec.body as { content: FormContent }).content;
    assert.deepEqual(imageKeys(saved.content), imageKeys(source));
    const refs = (await pins({ templateId: saved.id })).filter(row => row.slot === "question");
    assert.equal(refs.length, source.questions.filter(q => q.questionImageKey).length);
    for (const q of source.questions.filter(q => q.questionImageKey)) assert(refs.some(ref => ref.questionKey === q.id && ref.assetId === q.questionImageKey && ref.questionId === null));
    proof = { templateId: saved.id, registrationReusesSameServiceOwners: true };
  } else if (mode === "template-use") {
    assert(state.template && state.completed["template-register"]);
    state.usedFormId = (await mutate<FormRecord>("template-use", async () => ({ path: "/templates/" + state!.template!.id + "/use", method: "POST", expected: 201, idempotent: true,
      body: { version: state!.template!.version, serviceId: f.serviceId, title: "QI template use" } }))).value.id; await save();
    proof = await copyProof(state.template.originalContent, state.usedFormId);
  } else if (mode === "form-copy") {
    assert(state.completed["template-use"]);
    const copy = (await mutate<FormRecord>("form-copy", async () => ({ path: "/forms/" + f.formId + "/copy", method: "POST", expected: 201, idempotent: true, body: { title: "QI explicit copy" } }))).value;
    state.copiedFormId = copy.id; await save(); const source = await form(); assert(source.content); proof = await copyProof(source.content, copy.id);
    if (state.usedFormId) {
      const used = await form(state.usedFormId); assert(used.content && copy.content);
      assert(imageKeys(used.content).every(id => !imageKeys(copy.content!).includes(id)));
    }
  } else if (mode === "template-edit" || mode === "template-delete") {
    assert(state.template && state.usedFormId && state.copiedFormId);
    assert(state.completed["form-copy"]);
    if (mode === "template-delete") assert(state.completed["template-edit"]);
    const ids = [f.formId, state.usedFormId, state.copiedFormId];
    state.templateCheckpoints ??= {};
    if (!state.templateCheckpoints[mode]) {
      state.templateCheckpoints[mode] = { formsHash: legacyGraphHash(await Promise.all(ids.map(formAndPins))),
        questionPins: (await pins({ templateId: state.template.id })).filter(row => row.slot === "question").length };
      await save();
    }
    const before = state.templateCheckpoints[mode];
    if (mode === "template-edit") {
      const updated = (await mutate<TemplateRecord>("template-edit", async () => {
        const content = structuredClone(state!.template!.currentContent); assert(content.questions[0].questionImageKey);
        content.questions[0].questionImageKey = null;
        return { path: "/templates/" + state!.template!.id, method: "PATCH", expected: 200,
          body: { version: state!.template!.version, title: "QI lifecycle template edited", content } };
      })).value;
      assert.equal(updated.title, "QI lifecycle template edited"); assert(!updated.content.questions[0].questionImageKey);
      state.template.version = updated.version; state.template.currentContent = updated.content; await save();
      const currentPins = (await pins({ templateId: state.template.id })).filter(row => row.slot === "question");
      assert.equal(currentPins.length, before.questionPins - 1);
      assert(!currentPins.some(row => row.questionKey === state!.template!.originalContent.questions[0].id));
    } else {
      await mutate("template-delete", async () => ({ path: "/templates/" + state!.template!.id, method: "DELETE", expected: 204, headers: { "if-match": String(state!.template!.version) } }));
      assert.equal(await db.formTemplate.count({ where: { id: state.template.id, tenantId: f.companyId } }), 0);
      assert.equal((await pins({ templateId: state.template.id })).length, 0);
    }
    assert.equal(legacyGraphHash(await Promise.all(ids.map(formAndPins))), before.formsHash);
    await copyProof(state.template.originalContent, state.usedFormId); await copyProof(state.template.originalContent, state.copiedFormId);
    const survivingImages = [];
    for (const id of ids) survivingImages.push({ formId: id, count: await currentImageBytes(id) });
    proof = { templateOperation: mode, sourceAndCopiedFormsAndPinsUnchanged: true, survivingImages };
  } else if (mode === "approval-request") {
    assert(state.completed["template-delete"]);
    await mutate<PolicyRecord>("enable-approval-policy", async () => {
      const current = await read<PolicyRecord>("read current policy", "/security/policy");
      assert.equal(current.tenantId, f.companyId);
      state!.policyBefore = policySettings.parse(Object.fromEntries(Object.keys(policySettings.shape).map(key => [key, current[key as keyof PolicyRecord]]))); await save();
      return { path: "/security/policy", method: "PATCH", expected: 200,
        body: { ...state!.policyBefore, tenantId: f.companyId, version: current.version, password: f.password, requireApproval: true, approvalRoles: ["owner"] } };
    });
    await changeDraft("first-approval-draft", content => { content.questions[0].additionalExplanation = "QI first approval snapshot"; });
    const approval = await approvalRequest("request-first-approval"), imageKey = approval.snapshot.content.questions[0].questionImageKey; assert(imageKey);
    state.firstApproval = { id: approval.id, version: approval.version, ...await approvalProof(approval.id), imageKey }; await save();
    assert((await pins({ approvalId: approval.id })).some(row => row.slot === "question" && row.assetId === imageKey));
    proof = { firstApprovalId: approval.id, snapshotPinsVerified: true };
  } else if (mode === "approval-invalidate") {
    assert(state.firstApproval && state.completed["approval-request"]);
    await changeDraft("remove-image-after-approval", content => { content.questions[0].questionImageKey = null; });
    assert.equal((await preserveApproval()).status, "superseded");
    await mutate("reject-old-approval-decision", async () => ({ path: "/approvals/" + state!.firstApproval!.id + "/decision", method: "POST", expected: 409, code: "VERSION_CONFLICT",
      body: { version: state!.firstApproval!.version, decision: "approved", reason: "Must fail after draft mutation" } }));
    await mutate("reject-publication-without-current-approval", async () => ({ path: "/forms/" + f.formId + "/publish", method: "POST", expected: 409, idempotent: true, code: "APPROVAL_REQUIRED",
      body: { version: (await form()).version } }));
    const manifest = await read<AuthorAssetManifest>("read immutable approval assets", "/author-assets?kind=approval&id=" + state.firstApproval.id);
    const image = manifest.items.find(item => item.id === state!.firstApproval!.imageKey); assert(image);
    await download("old approval image remains authorized", "/author-assets/" + image.id + "/download?kind=approval&id=" + state.firstApproval.id, image, f.cookie);
    proof = { oldApprovalSuperseded: true, staleDecisionAndPublishBlocked: true };
  } else if (mode === "approval-rerequest") {
    assert(state.firstApproval && state.completed["approval-invalidate"]);
    await changeDraft("restore-image-for-current-approval", content => { content.questions[0].questionImageKey = state!.firstApproval!.imageKey; content.questions[0].additionalExplanation = "QI current approval snapshot"; });
    const approval = await approvalRequest("request-current-approval"); assert.notEqual(approval.id, state.firstApproval.id);
    state.secondApproval = { id: approval.id, version: approval.version }; await save(); await preserveApproval();
    proof = { currentApprovalId: approval.id, previousApprovalSnapshotUnchanged: true };
  } else if (mode === "approval-publish") {
    assert(state.secondApproval && state.completed["approval-rerequest"]);
    await mutate("approve-current-snapshot", async () => ({ path: "/approvals/" + state!.secondApproval!.id + "/decision", method: "POST", expected: 200,
      body: { version: state!.secondApproval!.version, decision: "approved", reason: "Local QI snapshot verified" } }));
    await mutate("publish-approved-snapshot", async () => ({ path: "/forms/" + f.formId + "/publish", method: "POST", expected: 201, idempotent: true, body: { version: (await form()).version } }));
    assert.equal((await db.approvalRequest.findUniqueOrThrow({ where: { id: state.secondApproval.id } })).status, "consumed");
    await preserveApproval(); proof = { approvalConsumedByPublication: true };
  } else if (mode === "share-create") {
    assert(state.completed["approval-publish"]);
    const email = "question-images-viewer@example.test";
    const grant = (await mutate<{ id: string; version: number }>("create-selected-question-share", async () => ({ path: "/share-grants", method: "POST", expected: 201, idempotent: true,
      body: { formId: f.formId, formVersionId: f.original.versionId, questionIds: [f.questionIds[0]], email, expiresAt: new Date(Date.now() + 86400000).toISOString() } }))).value;
    state.share = { ...grant, email }; await save(); proof = { shareId: grant.id, selectedQuestionCount: 1, publication: "original response version" };
  } else if (mode === "viewer-auth") {
    assert(state.share && state.completed["share-create"]);
    const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + state.share.id + ":invite:1" } })).payloadCipher);
    const invitationCode = mail.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)?.[1]; assert(invitationCode);
    const challenge = await mutate<{ id: string }>("viewer-challenge", async () => ({ path: "/viewer/challenges", method: "POST", expected: 202, cookie: "",
      body: { formCode: f.formId, invitationCode, email: state!.share!.email, consent: true } }));
    assert(challenge.cookies);
    const otpMail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + state.share.id + ":challenge:" + challenge.value.id } })).payloadCipher);
    const code = otpMail.text.match(/인증코드: (\d{6})/)?.[1]; assert(code);
    const verified = await mutate<{ expiresAt: string }>("viewer-verify-local-otp", async () => ({ path: "/viewer/challenges/" + challenge.value.id + "/verify", method: "POST", expected: 200,
      cookie: challenge.cookies, body: { code } }));
    assert(verified.cookies);
    state.viewerCookie = verified.cookies; state.viewerExpiresAt = verified.value.expiresAt; await save();
    proof = { authenticated: true, deliveryEvidence: "OTP read from local encrypted mail job; external email delivery not verified" };
  } else if (mode === "viewer-check") {
    assert(state.viewerCookie && state.completed["viewer-auth"]);
    const page = await read<SharedPage>("viewer selected question projection", "/viewer/submissions?page=1&pageSize=20", 200, state.viewerCookie);
    assert.deepEqual(page.viewer.questions.map(q => q.id), [f.questionIds[0]]); assert(page.items.some(row => row.id === f.submission.id));
    assert.equal(page.viewer.questions[0].questionImageKey, f.original.questionImageKeys[0]);
    const manifest = await read<AuthorAssetManifest>("viewer selected question manifest", "/viewer/author-assets?submissionId=" + f.submission.id, 200, state.viewerCookie);
    assert.deepEqual(manifest.items.map(a => a.id), [f.original.questionImageKeys[0]]);
    const image = manifest.items[0];
    const bytes = await download("viewer authorized original image bytes", "/viewer/author-assets/" + image.id + "/download?submissionId=" + f.submission.id, image, state.viewerCookie);
    state.viewerBytesHash = bytes.sha256; await save();
    await read("viewer unselected question image is 404", "/viewer/author-assets/" + f.original.questionImageKeys[1] + "/download?submissionId=" + f.submission.id, 404, state.viewerCookie, "NOT_FOUND");
    proof = { selectedImageHash: bytes.sha256, selectedQuestionCount: 1, unselectedImageRejected: true };
  } else if (mode === "share-revoke") {
    assert(state.share && state.viewerCookie && state.completed["viewer-check"]);
    await mutate("revoke-only-lifecycle-share", async () => ({ path: "/share-grants/" + state!.share!.id, method: "DELETE", expected: 200,
      headers: { "if-match": String(state!.share!.version) } }));
    await read("revoked viewer image URL is 401", "/viewer/author-assets/" + f.original.questionImageKeys[0] + "/download?submissionId=" + f.submission.id, 401, state.viewerCookie, "VIEWER_SESSION_EXPIRED");
    proof = { shareRevoked: true, previouslyAuthorizedImageNowRejected: true };
  } else if (mode === "policy-restore") {
    assert(state.policyBefore && state.completed["approval-publish"]);
    await mutate("restore-only-original-approval-policy-fields", async () => {
      const current = await read<PolicyRecord>("read policy before scoped restore", "/security/policy"); assert.equal(current.tenantId, f.companyId);
      const settings = policySettings.parse(Object.fromEntries(Object.keys(policySettings.shape).map(key => [key, current[key as keyof PolicyRecord]])));
      return { path: "/security/policy", method: "PATCH", expected: 200, body: { ...settings,
        requireApproval: state!.policyBefore!.requireApproval, approvalRoles: state!.policyBefore!.approvalRoles,
        approvalReferenceRequired: state!.policyBefore!.approvalReferenceRequired, approvalRequestTemplate: state!.policyBefore!.approvalRequestTemplate,
        tenantId: f.companyId, version: current.version, password: f.password } };
    });
    proof = { originalApprovalSettingsRestoredThroughApi: true };
  } else throw new Error("UnsupportedMode");
  proof = { ...proof, ...await preserveOriginal() };
  state.completed[mode] = new Date().toISOString(); await save();
}
try {
  assert(modes.includes(mode));
  const database = new URL(process.env.DATABASE_URL!); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
  const application = new URL(process.env.BETTER_AUTH_URL!);
  assert.equal(application.protocol, "http:"); assert.equal(application.hostname, "localhost");
  assert(["3100", "3108"].includes(application.port));
  assert.equal(application.username + application.password + application.search + application.hash, ""); assert.equal(application.pathname, "/");
  origin = application.origin;
  f = await guard(); await chmod(directory, 0o700);
  await writeFile(lockFile, JSON.stringify({ pid: process.pid, runId, mode }) + "\n", { flag: "wx", mode: 0o600 }); locked = true;
  if (mode === "init") {
    const originalProofHash = await originalProof();
    state = { format: 1, companyId: f.companyId, serviceId: f.serviceId, memberId: f.memberId, formId: f.formId,
      originalVersionId: f.original.versionId, submissionId: f.submission.id, createdAt: new Date().toISOString(), operations: {}, completed: { init: new Date().toISOString() }, originalProofHash };
    await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 }); proof = { initialized: true, originalProofHash };
  } else {
    state = JSON.parse(await readFile(stateFile, "utf8")); assert(state?.format === 1);
    for (const key of ["companyId", "serviceId", "memberId", "formId"] as const) assert.equal(state[key], f[key]);
    await guard(); await preserveOriginal(); await execute();
  }
} catch (error) { failure = { step, errorType: errType(error) }; process.exitCode = 1; }
finally {
  if (locked) await unlink(lockFile).catch(() => {});
  await db.$disconnect();
  // Response bodies, passwords, OTPs, cookies and token-bearing URLs are private only.
  const report = { mode, runId, recordedAt: new Date().toISOString(), result: failure ? "failed" : "passed", checks, proof, ...(failure ? { failure } : {}),
    boundary: "Actual local API and DB observations when invoked; OTP uses local outbox. No original-site or external delivery/provider success claim.",
    failurePolicy: "No automatic rollback/cleanup on failure; inspect private lifecycle state before continuing." };
  await mkdir(output, { recursive: true });
  const reportFile = output + "/" + mode + "-" + runId + ".json";
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ mode, result: report.result, checks: checks.length, report: reportFile }));
}
