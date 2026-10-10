import assert from "node:assert/strict";
import { legacyQuestionImageColumn } from "./qa-legacy-language";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { contentDto, versionInclude } from "../src/server/forms";
import { formContentSchema } from "../src/contracts/domains";
import type { FormRecord } from "../src/contracts/forms";
import type { AuthorAssetInfo, AuthorAssetUploadInfo, AuthorAssetManifest } from "../src/contracts/author-assets";

const origin = "http://localhost:3100", database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(new URL(process.env.BETTER_AUTH_URL!).origin, origin);
const directory = resolve(".local/rea-fullstack/author-assets"), file = directory + "/fixture.json";
const output = resolve("docs/qa/R08-T02/question-metadata/author-assets/flow");
const mode = process.argv[2], argument = process.argv[3], runId = randomUUID();
const readModes = new Set(["state", "assert-authoring", "assert-submission", "assert-history", "assert-approval", "capture-publication", "freeze", "verify"]);
const modes = new Set([...readModes, "prepare", "login", "upload-sample", "publish", "revise", "copy", "template-create", "template-use", "downloads", "share-prepare", "share-revoke"]);
assert(modes.has(mode), "Choose a documented QA mode");
const expectedLinks = [
  { materialType: "LINK" as const, orderNumber: 1, fileKey: null, linkLabel: "개인정보 안내", linkUrl: "https://example.test/privacy" },
  { materialType: "LINK" as const, orderNumber: 2, fileKey: null, linkLabel: "이용 안내", linkUrl: "https://example.test/terms" },
];
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type SampleName = "reference-a" | "reference-b" | "radio" | "checkbox" | "replacement";
type Sample = { path: string; name: string; purpose: "QUESTION_MATERIAL" | "OPTION_IMAGE"; mime: "application/pdf" | "image/png" | "image/jpeg"; size: number; sha256: string };
type Slot = { questionKey: string | null; slot: string; orderNumber: number | null; optionKey: string | null; assetId: string };
type Fixture = {
  format: 1; email: string; password: string; cookie: string; startedAt: string; preparedAt?: string;
  companyId?: string; serviceId?: string; secondServiceId?: string; memberId?: string; formId?: string;
  questionIds: string[]; optionIds: string[][]; expectedLinks: typeof expectedLinks; samples: Partial<Record<SampleName, Sample>>;
  uploads: Partial<Record<SampleName, string>>; keys: Record<string, string>;
  authored?: { slots: Slot[]; assetIds: string[]; checkedAt: string };
  original?: { versionId: string; versionHash: string; pinHash: string; assetIds: string[]; publicationId: string; token: string };
  submission?: { id: string; receiptHash: string; valuesHash: string };
  copies?: string[]; templateId?: string; templateUsedId?: string; publicationToken?: string; historyCheckedAt?: string;
  approval?: { id: string; snapshotHash: string; pinHash: string };
  shareId?: string; shareVersion?: number; viewerEmail?: string; invitationCode?: string;
  hash?: string; frozenAt?: string;
};
let f: Fixture, step = "initialization";
const checks: { action: string; status: number; code?: string }[] = [];
let result: Record<string, unknown> = {};
async function save() {
  assert(!f.hash, "Frozen fixture must never be rewritten");
  const temp = file + "." + runId + ".tmp";
  await writeFile(temp, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); await rename(temp, file); await chmod(file, 0o600);
}
async function persistFrozen(hash: string) {
  assert(!f.hash); f.hash = hash; f.frozenAt = new Date().toISOString();
  const temp = file + "." + runId + ".tmp";
  await writeFile(temp, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); await rename(temp, file); await chmod(file, 0o600);
}
function mutable() { assert(!f.hash, "Frozen fixture rejects every HTTP or database mutation"); }
async function key(label: string) { mutable(); if (!f.keys[label]) { f.keys[label] = randomUUID(); await save(); } return f.keys[label]; }
async function http<T>(action: string, path: string, expected: number, body?: unknown, method = body === undefined ? "GET" : "POST", headers: Record<string, string> = {}) {
  mutable(); step = action;
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "error", headers: { origin, cookie: f.cookie,
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null);
  checks.push({ action, status: response.status, ...(typeof value?.error?.code === "string" ? { code: value.error.code } : {}) });
  assert.equal(response.status, expected, action); return { response, value: value as T };
}
async function makePdf(text: string) {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: text, Author: "Local QA fixture" } });
  const chunks: Buffer[] = [], ready = new Promise<Buffer>((done, reject) => { doc.on("data", chunk => chunks.push(Buffer.from(chunk))); doc.on("end", () => done(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.font("Helvetica").fontSize(22).text(text).moveDown().fontSize(11).text("Author asset reference test. This is a real, local PDFKit document.");
  doc.end(); return ready;
}
async function samples() {
  const data: [SampleName, string, Sample["mime"], Buffer][] = [
    ["reference-a", "reference-a.pdf", "application/pdf", await makePdf("Reference A - original")],
    ["reference-b", "reference-b.pdf", "application/pdf", await makePdf("Reference B - replacement")],
    ["radio", "radio-blue.png", "image/png", await sharp({ create: { width: 320, height: 180, channels: 3, background: "#2574eb" } }).png().toBuffer()],
    ["checkbox", "checkbox-orange.jpg", "image/jpeg", await sharp({ create: { width: 240, height: 180, channels: 3, background: "#ee7722" } }).jpeg({ quality: 90 }).toBuffer()],
    ["replacement", "replacement-green.png", "image/png", await sharp({ create: { width: 320, height: 180, channels: 3, background: "#228844" } }).png().toBuffer()],
  ];
  for (const [id, name, mime, bytes] of data) {
    const path = directory + "/" + name; await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    f.samples[id] = { path, name, mime, purpose: mime === "application/pdf" ? "QUESTION_MATERIAL" : "OPTION_IMAGE", size: bytes.length, sha256: sha(bytes) };
  }
  await save();
}
async function currentForm() { assert(f.formId && f.companyId); return db.form.findFirstOrThrow({ where: { id: f.formId, tenantId: f.companyId }, include: { versions: { include: versionInclude, orderBy: { number: "desc" } } } }); }
const slotSort = (slots: Slot[]) => slots.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function slots(content: ReturnType<typeof contentDto>): Slot[] {
  return slotSort(content.questions.flatMap(q => [
    ...(q.materialList ?? []).filter(m => m.materialType === "FILE").map(m => ({ questionKey: q.id, slot: "material", orderNumber: m.orderNumber, optionKey: null, assetId: m.fileKey! })),
    ...(q.optionDefinitions ?? []).filter(o => !!o.optionImageKey).map(o => ({ questionKey: q.id, slot: "option", orderNumber: null, optionKey: o.id, assetId: o.optionImageKey! })),
  ]));
}
async function graph(versionId: string) {
  const version = await db.formVersion.findFirstOrThrow({ where: { id: versionId, tenantId: f.companyId }, include: versionInclude });
  const expected = slots(contentDto(version)), pins = await db.authorAssetReference.findMany({ where: { formVersionId: versionId }, orderBy: { id: "asc" } });
  assert.deepEqual(slotSort(pins.map(p => ({ questionKey: p.questionKey, slot: p.slot, orderNumber: p.orderNumber, optionKey: p.optionKey, assetId: p.assetId }))), expected);
  for (const pin of pins) {
    assert.equal(pin.tenantId, f.companyId); assert.equal(pin.serviceId, f.serviceId);
    assert.equal(pin.questionId, version.questions.find(q => q.stableKey === pin.questionKey)?.id);
  }
  const assetIds = [...new Set(expected.map(s => s.assetId))].sort();
  const assets = await db.authorAsset.findMany({ where: { id: { in: assetIds } }, include: { blob: true }, orderBy: { id: "asc" } });
  assert.equal(assets.length, assetIds.length);
  for (const asset of assets) {
    assert.equal(asset.tenantId, f.companyId); assert.equal(asset.serviceId, f.serviceId); assert.equal(asset.status, "ready"); assert.equal(asset.expiresAt, null);
    assert.equal(asset.blob.status, "ready"); assert.equal(asset.blob.scanStatus, "clean"); assert.match(asset.blob.scanEngine!, /^ClamAV /);
    const sample = Object.values(f.samples).find(s => s!.sha256 === asset.blob.sha256); assert(sample, "Only actual generated sample bytes belong in this fixture");
    assert.equal(asset.size, sample.size); assert.equal(asset.blob.mime, sample.mime); assert.equal(sha(await privateFiles.read(asset.blob.storageKey)), sample.sha256);
  }
  return { version, pins, expected, assets, assetIds };
}
async function snapshot() {
  assert(f.companyId);
  return db.$transaction(async tx => {
    const assets = await tx.authorAsset.findMany({ where: { tenantId: f.companyId }, include: { blob: true }, orderBy: { id: "asc" } });
    return {
      forms: await tx.form.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { versions: { include: versionInclude, orderBy: { number: "asc" } }, publications: { orderBy: { id: "asc" } } } }),
      templates: await tx.formTemplate.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
      approvals: await tx.approvalRequest.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }), assets,
      pins: await tx.authorAssetReference.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
      submissions: await tx.submission.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } }),
      corrections: await tx.correction.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { payload: true } }),
      shares: await tx.shareGrant.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { fields: { orderBy: { questionId: "asc" } }, challenges: { orderBy: { id: "asc" } }, sessions: { orderBy: { id: "asc" } } } }),
      audits: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    };
  }, { isolationLevel: "RepeatableRead" });
}
async function byteProof(state: Awaited<ReturnType<typeof snapshot>>) {
  const result = [];
  for (const blob of new Map(state.assets.filter(a => a.status === "ready").map(a => [a.blob.id, a.blob])).values()) {
    assert.equal(blob.status, "ready"); assert.equal(blob.scanStatus, "clean");
    const bytes = await privateFiles.read(blob.storageKey); assert.equal(bytes.length, blob.size); assert.equal(sha(bytes), blob.sha256);
    result.push({ sha256: blob.sha256, size: blob.size });
  }
  return result.sort((a, b) => a.sha256.localeCompare(b.sha256));
}
async function copyProof(source: ReturnType<typeof contentDto>, targetId: string) {
  step = "compare distinct logical copy ownership against the source blobs";
  const target = await db.form.findFirstOrThrow({ where: { id: targetId, tenantId: f.companyId }, include: { versions: { include: versionInclude, orderBy: { number: "desc" } } } });
  const content = contentDto(target.versions[0]);
  assert(source.questions.every((q, i) => q.id !== content.questions[i]?.id));
  const before = [...new Set(slots(source).map(s => s.assetId))].sort(), after = [...new Set(slots(content).map(s => s.assetId))].sort();
  assert(before.length > 0); assert.equal(after.length, before.length); assert(after.every(id => !before.includes(id)));
  const sourceAssets = await db.authorAsset.findMany({ where: { id: { in: before } } }), targetAssets = await db.authorAsset.findMany({ where: { id: { in: after } } });
  assert.equal(targetAssets.length, after.length); assert(targetAssets.every(a => a.tenantId === f.companyId && a.serviceId === target.serviceId && a.createdById === f.memberId && a.expiresAt === null));
  assert.deepEqual(sourceAssets.map(a => [a.blobId, a.size, a.purpose]).sort(), targetAssets.map(a => [a.blobId, a.size, a.purpose]).sort());
  const pinCount = await db.authorAssetReference.count({ where: { formVersionId: target.versions[0].id } }); assert.equal(pinCount, slots(content).length);
  return { independentLogicalIds: true, sharedImmutableBlobs: true, copiedAssets: after.length, logicalBytes: targetAssets.reduce((sum, a) => sum + a.size, 0), pins: pinCount };
}
async function download(action: string, path: string, expected: AuthorAssetInfo) {
  mutable(); step = action;
  const response = await fetch(origin + "/api/v1" + path, { redirect: "error", headers: { cookie: f.cookie } });
  checks.push({ action, status: response.status }); assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-type"), expected.mime);
  assert.match(response.headers.get("content-disposition") ?? "", expected.purpose === "OPTION_IMAGE" ? /^inline;/ : /^attachment;/);
  const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(bytes.length, expected.size); assert.equal(sha(bytes), expected.sha256);
  return { assetId: expected.id, size: bytes.length, sha256: expected.sha256 };
}
try {
  if (mode === "prepare") {
    await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
    f = { format: 1, email: "rea-author-assets-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(24).toString("hex") + "Aa!1", cookie: "", startedAt: new Date().toISOString(),
      questionIds: Array.from({ length: 3 }, () => randomUUID()), optionIds: Array.from({ length: 2 }, () => [randomUUID(), randomUUID()]), expectedLinks, samples: {}, uploads: {}, keys: {} };
    // Exclusive durable marker before the first account mutation. A partial run must be inspected, never silently duplicated.
    step = "exclusive preparation marker"; await writeFile(file, JSON.stringify(f, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await samples();
    await http("register isolated QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "작성자 자료 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await http("login isolated QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await http<{ id: string }>("create isolated QA company", "/companies", 201, { name: "작성자 자료 검증", publicName: "작성자 자료 QA" }, "POST", { "idempotency-key": await key("prepare-company") })).value.id; await save();
    f.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: f.companyId }, orderBy: { createdAt: "asc" } })).id;
    f.memberId = (await db.membership.findFirstOrThrow({ where: { tenantId: f.companyId, user: { email: f.email } } })).id; await save();
    const content = formContentSchema.parse({ body: "참고 파일·보기 이미지·복사·게시본 보존 검증", formLanguage: "ko", consentRequired: true, consentPurpose: "작성자 첨부 자료와 응답 저장 기능 검증", retentionDays: 30, maxResponses: 20,
      questions: [
        { id: f.questionIds[0], type: "객관식 답변", label: "자료와 이미지 선택", required: true, options: ["보기 A", "보기 B"], optionDefinitions: f.optionIds[0].map((id, i) => ({ id, label: i ? "보기 B" : "보기 A", value: i ? "보기 B" : "보기 A" })) },
        { id: f.questionIds[1], type: "체크박스", label: "확인한 항목", required: true, options: ["항목 A", "항목 B"], optionDefinitions: f.optionIds[1].map((id, i) => ({ id, label: i ? "항목 B" : "항목 A", value: i ? "항목 B" : "항목 A" })) },
        { id: f.questionIds[2], type: "단문형 답변", label: "확인 내용", required: true },
      ] });
    f.formId = (await http<FormRecord>("create draft for actual Ego asset editing", "/forms", 201, { serviceId: f.serviceId, title: "작성자 자료 검증", content }, "POST", { "idempotency-key": await key("prepare-form") })).value.id;
    f.preparedAt = new Date().toISOString(); await save(); result = { formId: f.formId, companyId: f.companyId, serviceId: f.serviceId, sampleNames: Object.keys(f.samples) };
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert.equal(f.format, 1); assert(f.preparedAt && f.companyId && f.serviceId && f.formId);
    if (!readModes.has(mode)) mutable();
    if (mode === "state") {
      const state = await snapshot(); result = { frozen: !!f.hash, companyId: f.companyId, serviceId: f.serviceId, formId: f.formId,
        forms: state.forms.map(row => ({ id: row.id, version: row.version, status: row.status, versions: row.versions.map(v => ({ number: v.number, status: v.status })) })),
        assets: state.assets.map(a => ({ id: a.id, purpose: a.purpose, status: a.status, sha256: a.blob.sha256, size: a.size, pinCount: state.pins.filter(p => p.assetId === a.id).length })),
        submissions: state.submissions.length, templates: state.templates.length, approvals: state.approvals.length };
    } else if (mode === "capture-publication") {
      step = "capture actual active publication token privately";
      const form = await currentForm(); assert.equal(form.status, "published");
      const publication = await db.publication.findFirstOrThrow({ where: { formId: f.formId, formVersionId: form.publishedVersionId!, status: "active" } });
      const token = decrypt<string>(publication.tokenCipher);
      if (f.hash) assert.equal(f.publicationToken, token); else { f.publicationToken = token; await save(); }
      result = { publicationId: publication.id, tokenStoredPrivately: true };
    } else if (mode === "login") {
      const login = await http("refresh QA login", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
      f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    } else if (mode === "assert-authoring") {
      step = "verify actual Ego-saved sample bindings";
      const form = await currentForm(), g = await graph(form.versions[0].id), dto = contentDto(g.version);
      assert.deepEqual(dto.questions.map(q => q.id), f.questionIds);
      const materials = dto.questions[0].materialList!; assert.equal(materials.length, 3);
      assert.equal(materials[0].materialType, "FILE"); assert.equal(materials[0].orderNumber, 0); assert.deepEqual(materials.slice(1), f.expectedLinks);
      assert.equal(dto.questions[0].optionDefinitions!.filter(o => o.optionImageKey).length, 1);
      assert.equal(dto.questions[1].optionDefinitions!.filter(o => o.optionImageKey).length, 1);
      assert.equal(dto.questions[1].materialList?.length ?? 0, 0); assert.equal(dto.questions[2].materialList?.length ?? 0, 0);
      assert.equal(dto.questions[2].optionDefinitions?.filter(o => o.optionImageKey).length ?? 0, 0);
      assert.equal(g.pins.length, 3);
      const expected = [[f.questionIds[0], "material", null, "reference-a"], [f.questionIds[0], "option", f.optionIds[0][0], "radio"], [f.questionIds[1], "option", f.optionIds[1][0], "checkbox"]] as const;
      for (const [questionKey, slot, optionKey, name] of expected) {
        const pin = g.expected.find(p => p.questionKey === questionKey && p.slot === slot && p.optionKey === optionKey); assert(pin);
        assert.equal(g.assets.find(a => a.id === pin.assetId)!.blob.sha256, f.samples[name]!.sha256);
      }
      if (f.authored) assert.deepEqual(g.expected, f.authored.slots); else { mutable(); f.authored = { slots: g.expected, assetIds: g.assetIds, checkedAt: new Date().toISOString() }; await save(); }
      result = { version: form.version, questionCount: 3, pins: g.pins.length, assets: g.assetIds.length, storedClamAVEvidence: true };
    } else if (mode === "assert-submission") {
      step = "verify actual Ego consent submission and original version";
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId, formVersion: { formId: f.formId } }, include: { answers: { include: { question: true } }, receipts: true } });
      assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.status, "submitted"); assert.equal(row.version, 1);
      const values = Object.fromEntries(row.answers.map(a => [a.question.stableKey, decrypt(a.valueCipher)]));
      assert.deepEqual(values, { [f.questionIds[0]]: "보기 A", [f.questionIds[1]]: ["항목 A"], [f.questionIds[2]]: "작성자 자료 확인" });
      const g = await graph(row.formVersionId); assert.equal(g.version.number, 1); assert.equal(g.version.status, "published");
      assert.equal(row.receipts.length, 1); const receipt = row.receipts[0]; assert(receipt.pdfCipher && receipt.pdfHash);
      assert.equal(sha(Buffer.from(decrypt<string>(receipt.pdfCipher), "base64")), receipt.pdfHash);
      assert(row.publicationId); const publication = await db.publication.findUniqueOrThrow({ where: { id: row.publicationId } });
      const original = { versionId: g.version.id, versionHash: sha(JSON.stringify(g.version)), pinHash: sha(JSON.stringify(g.pins)), assetIds: g.assetIds, publicationId: publication.id, token: decrypt<string>(publication.tokenCipher) };
      const submission = { id: row.id, receiptHash: receipt.pdfHash, valuesHash: sha(JSON.stringify(values)) };
      if (f.original) assert.deepEqual(original, f.original); else { mutable(); f.original = original; }
      if (f.submission) assert.deepEqual(submission, f.submission); else { mutable(); f.submission = submission; }
      if (!f.hash) await save(); result = { sourceVersion: 1, submissions: 1, exactAnswers: true, receiptHash: receipt.pdfHash, historyPins: g.pins.length };
    } else if (mode === "assert-history") {
      step = "verify replacement and immutable historical pins"; assert(f.original && f.submission);
      const old = await graph(f.original.versionId); assert.equal(sha(JSON.stringify(old.version)), f.original.versionHash); assert.equal(sha(JSON.stringify(old.pins)), f.original.pinHash);
      const form = await currentForm(); assert(form.versions[0].number > 1); const next = await graph(form.versions[0].id);
      assert(next.assetIds.some(id => !f.original!.assetIds.includes(id)), "Replace a file or option image in Ego before history assertion");
      assert(next.assets.some(a => [f.samples["reference-b"]!.sha256, f.samples.replacement!.sha256].includes(a.blob.sha256)));
      const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: f.submission.id } }); assert.equal(receipt.pdfHash, f.submission.receiptHash);
      if (!f.hash) { f.historyCheckedAt = new Date().toISOString(); await save(); }
      result = { previousVersion: old.version.number, currentVersion: next.version.number, oldVersionExact: true, oldPinsExact: true, replacementPresent: true, receiptHash: receipt.pdfHash };
    } else if (mode === "assert-approval") {
      step = "verify independently pinned approval snapshot";
      const approval = await db.approvalRequest.findFirstOrThrow({ where: { tenantId: f.companyId, formId: f.formId }, orderBy: { createdAt: "desc" } });
      const content = formContentSchema.parse((approval.snapshot as { content: unknown }).content);
      const pins = await db.authorAssetReference.findMany({ where: { approvalId: approval.id }, orderBy: { id: "asc" } });
      assert.deepEqual(slotSort(pins.map(p => ({ questionKey: p.questionKey, slot: p.slot, orderNumber: p.orderNumber, optionKey: p.optionKey, assetId: p.assetId }))), slots(content));
      assert(pins.length > 0 && pins.every(p => p.questionId === null && p.formVersionId === null));
      const record = { id: approval.id, snapshotHash: sha(JSON.stringify(approval.snapshot)), pinHash: sha(JSON.stringify(pins)) };
      if (f.approval) assert.deepEqual(record, f.approval); else { mutable(); f.approval = record; await save(); }
      result = { status: approval.status, independentPins: pins.length };
    } else if (mode === "upload-sample") {
      assert(argument && Object.hasOwn(f.samples, argument)); const sample = f.samples[argument as SampleName]!;
      assert(!f.uploads[argument as SampleName], "Already uploaded; use the recorded logical ID"); const bytes = await readFile(sample.path); assert.equal(sha(bytes), sample.sha256);
      const initialized = (await http<AuthorAssetUploadInfo>("initialize sample upload", "/author-assets/uploads", 201, { serviceId: f.serviceId, purpose: sample.purpose, name: sample.name, mime: sample.mime, size: sample.size, sha256: sample.sha256 }, "POST", { "idempotency-key": await key("upload-" + argument) })).value;
      step = "write exact sample bytes";
      const uploaded = await fetch(origin + "/api/v1/author-assets/uploads/" + initialized.id + "/content", { method: "PUT", redirect: "error", headers: { origin, cookie: f.cookie, "content-type": sample.mime }, body: new Uint8Array(bytes) });
      checks.push({ action: step, status: uploaded.status }); assert.equal(uploaded.status, 200);
      const completed = (await http<AuthorAssetUploadInfo>("complete real scanner upload", "/author-assets/uploads/" + initialized.id + "/complete", 200, {})).value;
      assert.equal(completed.status, "ready"); assert.equal(completed.sha256, sample.sha256); f.uploads[argument as SampleName] = completed.id; await save(); result = { assetId: completed.id, sample: argument, sha256: completed.sha256 };
    } else if (mode === "publish" || mode === "revise") {
      const form = (await http<FormRecord>("read form before lifecycle action", "/forms/" + f.formId, 200)).value;
      if (mode === "revise") { assert(f.original); assert(!form.hasDraft); }
      else assert(form.hasDraft);
      await http("apply form " + mode, "/forms/" + f.formId + "/" + mode, 201, { version: form.version }, "POST", { "idempotency-key": await key(mode + "-" + form.version) });
      if (mode === "publish") { const publication = await db.publication.findFirstOrThrow({ where: { formId: f.formId, status: "active" } }); f.publicationToken = decrypt<string>(publication.tokenCipher); await save(); }
    } else if (mode === "copy") {
      const source = await currentForm(), sourceContent = contentDto(source.versions[0]);
      const form = (await http<FormRecord>("explicit form copy", "/forms/" + f.formId + "/copy", 201, { title: "작성자 자료 독립 복사" }, "POST", { "idempotency-key": await key("copy") })).value;
      f.copies = [...new Set([...(f.copies ?? []), form.id])]; await save(); result = { copyFormId: form.id, ...await copyProof(sourceContent, form.id) };
    } else if (mode === "template-create") {
      assert(!f.templateId); const form = (await http<FormRecord>("read actual form for template registration", "/forms/" + f.formId, 200)).value;
      f.templateId = (await http<{ id: string }>("register template from saved assets", "/templates", 201, { serviceId: f.serviceId, title: "작성자 자료 양식", category: "QA", content: form.content }, "POST", { "idempotency-key": await key("template-create") })).value.id; await save();
    } else if (mode === "template-use") {
      assert(f.templateId && !f.templateUsedId); const template = (await http<{ version: number; content: ReturnType<typeof contentDto> }>("read template revision", "/templates/" + f.templateId, 200)).value;
      f.templateUsedId = (await http<FormRecord>("use template with independent assets", "/templates/" + f.templateId + "/use", 201,
        { version: template.version, serviceId: f.serviceId, title: "작성자 자료 양식 사용" }, "POST", { "idempotency-key": await key("template-use") })).value.id; await save(); result = await copyProof(template.content, f.templateUsedId);
    } else if (mode === "downloads") {
      const form = (await http<FormRecord>("read current form revision for downloads", "/forms/" + f.formId, 200)).value;
      const query = new URLSearchParams({ kind: "form", id: f.formId, version: String(form.version) });
      const manifest = (await http<AuthorAssetManifest>("read exact member asset manifest", "/author-assets?" + query, 200)).value; assert(manifest.items.length > 0);
      const proof = [];
      for (const asset of manifest.items) proof.push(await download("verify member download bytes", "/author-assets/" + asset.id + "/download?" + query, asset));
      if (f.original && f.submission) {
        const oldQuery = new URLSearchParams({ kind: "submission", id: f.submission.id });
        const old = (await http<AuthorAssetManifest>("read original response asset manifest", "/author-assets?" + oldQuery, 200)).value;
        assert.deepEqual(old.items.map(a => a.id).sort(), f.original.assetIds);
        for (const asset of old.items) proof.push(await download("verify historical response bytes", "/author-assets/" + asset.id + "/download?" + oldQuery, asset));
      }
      if (f.publicationToken) {
        const manifest = (await http<AuthorAssetManifest>("read active public asset manifest", "/public/forms/" + f.publicationToken + "/author-assets", 200)).value;
        for (const asset of manifest.items) proof.push(await download("verify public download bytes", "/public/forms/" + f.publicationToken + "/author-assets/" + asset.id + "/download", asset));
      }
      result = { downloads: proof };
    } else if (mode === "share-prepare") {
      assert(f.original && f.submission && !f.shareId);
      f.viewerEmail = "author-assets-viewer@example.test";
      const shared = (await http<{ id: string; version: number }>("create QA viewer limited to first question", "/share-grants", 201, { formId: f.formId, formVersionId: f.original.versionId,
        questionIds: [f.questionIds[0]], email: f.viewerEmail, expiresAt: new Date(Date.now() + 86400000).toISOString() }, "POST", { "idempotency-key": await key("share-prepare") })).value;
      f.shareId = shared.id; f.shareVersion = shared.version; await save();
      const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + f.shareId + ":invite:1" } })).payloadCipher);
      f.invitationCode = mail.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)?.[1]; assert(f.invitationCode); await save(); result = { shareId: f.shareId };
    } else if (mode === "share-revoke") {
      assert(f.shareId); const grant = await db.shareGrant.findFirstOrThrow({ where: { id: f.shareId, tenantId: f.companyId } }); assert(!grant.revokedAt);
      await http("revoke actual QA share", "/share-grants/" + f.shareId, 200, undefined, "DELETE", { "if-match": String(grant.version) });
      assert((await db.shareGrant.findUniqueOrThrow({ where: { id: f.shareId } })).revokedAt); result = { shareRevoked: true, oldViewerUrlRejection: "must be observed separately in Ego" };
    } else if (mode === "freeze" || mode === "verify") {
      assert(f.original && f.submission && f.authored && f.historyCheckedAt); if (mode === "verify") assert(f.hash); else assert(!f.hash);
      step = "hash persistent tenant graph and actual encrypted-storage contents";
      const state = await snapshot(), bytes = await byteProof(state), hash = sha(JSON.stringify({ state, bytes }, legacyQuestionImageColumn));
      if (mode === "freeze") await persistFrozen(hash); else assert.equal(hash, f.hash);
      result = { hash, forms: state.forms.length, pins: state.pins.length, assets: state.assets.length, blobsRead: bytes.length,
        submissions: state.submissions.length, approvals: state.approvals.length, audits: state.audits.length };
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(output + "/" + mode + "-" + runId + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), mode, result: "passed", checks, ...result }, null, 2) + "\n");
  console.log(JSON.stringify({ mode, result: "passed", checks: checks.length, output, ...result }));
} catch (error) {
  // Never stringify request bodies, fixture values, cookies, URLs containing tokens or assertion actual/expected objects.
  await mkdir(output, { recursive: true });
  const failure = { checkedAt: new Date().toISOString(), mode, result: "failed", step, errorType: error instanceof Error ? error.name : "UnknownError", checks };
  await writeFile(output + "/" + mode + "-" + runId + ".json", JSON.stringify(failure, null, 2) + "\n");
  console.error(JSON.stringify(failure)); process.exitCode = 1;
} finally { await db.$disconnect(); }
