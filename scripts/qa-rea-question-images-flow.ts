import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { contentDto, versionInclude } from "../src/server/forms";
import { formContentSchema } from "../src/contracts/domains";
import type { FormRecord } from "../src/contracts/forms";

const directory = resolve(".local/rea-fullstack/question-images"), file = directory + "/fixture.json";
const output = resolve("docs/qa/R08-T02/question-metadata/content-images/flow"), origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert(["http://localhost:3100", "http://localhost:3108"].includes(origin), "Only the isolated local QA server is allowed");
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(new URL(process.env.BETTER_AUTH_URL!).origin, origin);
const mode = process.argv[2], runId = randomUUID(), checks: { action: string; status: number; code?: string }[] = [];
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Fixture = {
  format: 1; startedAt: string; preparedAt?: string; email: string; password: string; cookie: string;
  companyId?: string; serviceId?: string; memberId?: string; formId?: string; questionIds: string[];
  samples: Record<string, { path: string; name: string; mime: string; size: number; sha256: string }>;
  original?: { versionId: string; publicationId: string; token: string; contentHash: string; pinsHash: string; questionImageKeys: string[] };
  submission?: { id: string; receiptHash: string }; historyVerifiedAt?: string; hash?: string;
};
let f: Fixture, step = "initialize", result: unknown;
async function save() {
  assert(!f.hash, "Frozen QA fixture cannot change");
  const temp = file + "." + runId + ".tmp";
  await writeFile(temp, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); await rename(temp, file); await chmod(file, 0o600);
}
async function http<T>(action: string, path: string, status: number, body?: unknown, method?: string) {
  assert(!f.hash, "Frozen QA fixture rejects even HTTP reads that could audit"); step = action;
  const response = await fetch(origin + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), redirect: "error",
    headers: { origin, cookie: f.cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null); checks.push({ action, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
  assert.equal(response.status, status, action); return { response, value: value as T };
}
async function snapshot() {
  assert(f.companyId);
  return db.$transaction(async tx => ({
    forms: await tx.form.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { versions: { include: versionInclude, orderBy: { number: "asc" } }, publications: { orderBy: { id: "asc" } } } }),
    templates: await tx.formTemplate.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    approvals: await tx.approvalRequest.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    assets: await tx.authorAsset.findMany({ where: { tenantId: f.companyId }, include: { blob: true }, orderBy: { id: "asc" } }),
    pins: await tx.authorAssetReference.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    submissions: await tx.submission.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } }),
    corrections: await tx.correction.findMany({ where: { tenantId: f.companyId }, include: { payload: true }, orderBy: { id: "asc" } }),
    shares: await tx.shareGrant.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { fields: { orderBy: { questionId: "asc" } }, sessions: { orderBy: { id: "asc" } }, challenges: { orderBy: { id: "asc" } } } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
async function bytesProof(state: Awaited<ReturnType<typeof snapshot>>) {
  const bytes = [];
  for (const blob of new Map(state.assets.filter(a => a.status === "ready").map(a => [a.blob.id, a.blob])).values()) {
    assert.equal(blob.status, "ready"); assert.equal(blob.scanStatus, "clean"); assert.match(blob.scanEngine!, /^ClamAV /);
    const actual = await privateFiles.read(blob.storageKey); assert.equal(actual.length, blob.size); assert.equal(hash(actual), blob.sha256);
    bytes.push({ sha256: blob.sha256, size: blob.size });
  }
  return bytes.sort((a, b) => a.sha256.localeCompare(b.sha256));
}
try {
  assert(["prepare", "state", "cleanup-unbound", "capture-original", "capture-submission", "assert-history", "freeze", "verify"].includes(mode));
  await mkdir(output, { recursive: true });
  if (mode === "prepare") {
    await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
    f = { format: 1, startedAt: new Date().toISOString(), email: "rea-question-image-" + randomUUID().slice(0, 8) + "@example.test",
      password: randomBytes(24).toString("hex") + "Aa!1", cookie: "", questionIds: Array.from({ length: 3 }, () => randomUUID()), samples: {} };
    step = "exclusive fixture preparation marker"; await writeFile(file, JSON.stringify(f, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    for (const sample of [
      { id: "original", name: "question-blue.png", width: 1200, height: 450, background: "#2574eb", mime: "image/png" },
      { id: "second", name: "question-orange.jpg", width: 600, height: 800, background: "#ee7722", mime: "image/jpeg" },
      { id: "replacement", name: "question-green.png", width: 960, height: 320, background: "#228844", mime: "image/png" },
    ]) {
      const image = sharp({ create: { width: sample.width, height: sample.height, channels: 3, background: sample.background } });
      const bytes = await (sample.mime === "image/png" ? image.png() : image.jpeg({ quality: 90 })).toBuffer(), path = directory + "/" + sample.name;
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); f.samples[sample.id] = { path, name: sample.name, mime: sample.mime, size: bytes.length, sha256: hash(bytes) };
    }
    await save();
    await http("register isolated owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "문항 이미지 검증 소유자" });
    // Local-only fixture bootstrap. This bypass is never described as email-verification acceptance.
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await http("login isolated owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await http<{ id: string }>("create isolated company", "/companies", 201, { name: "문항 이미지 검증", publicName: "문항 이미지 QA" })).value.id; await save();
    f.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: f.companyId }, orderBy: { createdAt: "asc" } })).id;
    f.memberId = (await db.membership.findFirstOrThrow({ where: { tenantId: f.companyId, user: { email: f.email } } })).id; await save();
    const content = formContentSchema.parse({ body: "문항 이미지와 이전 게시본 보존 검증", formLanguage: "ko", consentRequired: true,
      consentPurpose: "실제 이미지 표시 및 응답 저장 기능 검증", retentionDays: 30, maxResponses: 30,
      questions: [
        { id: f.questionIds[0], type: "단문형 답변", label: "첫 번째 그림 확인", required: true, additionalExplanation: "이미지 아래의 설명입니다." },
        { id: f.questionIds[1], type: "객관식 답변", label: "두 번째 그림 확인", required: true, options: ["확인", "미확인"],
          optionDefinitions: ["확인", "미확인"].map(value => ({ id: randomUUID(), label: value, value })) },
        { id: f.questionIds[2], type: "단문형 답변", label: "추가 확인", required: false },
      ] });
    f.formId = (await http<FormRecord>("create draft for actual Ego uploads", "/forms", 201, { serviceId: f.serviceId, title: "문항 이미지 검증", content })).value.id;
    f.preparedAt = new Date().toISOString(); await save(); result = { formId: f.formId, companyId: f.companyId, samples: Object.keys(f.samples) };
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert.equal(f.format, 1); assert(f.preparedAt && f.companyId && f.formId);
    assert(!f.hash || ["state", "verify"].includes(mode), "Frozen fixture is read-only");
    const state = await snapshot();
    if (mode === "state") result = { formId: f.formId, frozen: !!f.hash, forms: state.forms.map(form => ({ id: form.id, title: form.title, version: form.version,
      versions: form.versions.map(v => ({ id: v.id, number: v.number, status: v.status, images: contentDto(v).questions.map(q => q.questionImageKey ?? null) })) })),
      assets: state.assets.map(a => ({ id: a.id, purpose: a.purpose, status: a.status, sha256: a.blob.sha256 })), pins: state.pins.length, submissions: state.submissions.map(s => ({ id: s.id, version: s.version })) };
    else if (mode === "cleanup-unbound") {
      const removed = [];
      for (const asset of state.assets.filter(a => a.status === "ready" && a.expiresAt !== null && !state.pins.some(p => p.assetId === a.id))) {
        assert.equal(asset.createdById, f.memberId); assert.equal(asset.ownerKind, "company"); assert.equal(asset.serviceId, f.serviceId);
        assert.equal(asset.purpose, "QUESTION_IMAGE");
        const current = await http<{ version: number }>("read unused question image reservation", "/author-assets/uploads/" + asset.id, 200);
        await http("remove unused question image reservation", "/author-assets/uploads/" + asset.id + "?version=" + current.value.version, 204, undefined, "DELETE");
        const deleted = await db.authorAsset.findUniqueOrThrow({ where: { id: asset.id } }); assert.equal(deleted.status, "deleted");
        removed.push(asset.id);
      }
      result = { removed };
    } else if (mode === "capture-original") {
      assert(!f.original, "Original publication can be captured once");
      const form = state.forms.find(v => v.id === f.formId)!; assert(form);
      const publication = form.publications.find(p => p.status === "active"); assert(publication);
      const version = form.versions.find(v => v.id === publication.formVersionId)!; assert(version);
      const content = contentDto(version), keys = content.questions.slice(0, 2).map(q => q.questionImageKey); assert(keys.every(Boolean));
      for (const [index, key] of keys.entries()) {
        const asset = state.assets.find(a => a.id === key)!; assert(asset); assert.equal(asset.purpose, "QUESTION_IMAGE"); assert.equal(asset.status, "ready");
        assert.equal(asset.blob.sha256, f.samples[index === 0 ? "original" : "second"].sha256);
        const pins = state.pins.filter(p => p.formVersionId === version.id && p.assetId === key); assert.equal(pins.length, 1);
        assert.equal(pins[0].slot, "question"); assert.equal(pins[0].questionKey, f.questionIds[index]);
      }
      const current = await http<FormRecord>("get actual published token", "/forms/" + f.formId, 200); assert(current.value.publication?.token);
      f.original = { versionId: version.id, publicationId: publication.id, token: current.value.publication.token,
        contentHash: hash(JSON.stringify(version)), pinsHash: hash(JSON.stringify(state.pins.filter(p => p.formVersionId === version.id))), questionImageKeys: keys as string[] };
      await bytesProof(state); await save(); result = { images: keys.length, versionId: version.id };
    } else if (mode === "capture-submission") {
      assert(f.original); assert(!f.submission, "Original submission can be captured once");
      const submission = state.submissions.find(s => s.formVersionId === f.original!.versionId); assert(submission); assert.equal(submission.receipts.length, 1);
      const receipt = submission.receipts[0]; assert.equal(hash(Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64")), receipt.pdfHash);
      f.submission = { id: submission.id, receiptHash: receipt.pdfHash! }; await save(); result = { submissionId: submission.id, receiptHash: receipt.pdfHash };
    } else if (mode === "assert-history") {
      assert(f.original && f.submission);
      const form = state.forms.find(v => v.id === f.formId)!, original = form.versions.find(v => v.id === f.original!.versionId)!;
      assert.equal(hash(JSON.stringify(original)), f.original.contentHash); assert.equal(hash(JSON.stringify(state.pins.filter(p => p.formVersionId === original.id))), f.original.pinsHash);
      const current = form.versions.at(-1)!; assert.notEqual(current.id, original.id);
      assert.notEqual(contentDto(current).questions[0].questionImageKey, f.original.questionImageKeys[0]);
      const submission = state.submissions.find(s => s.id === f.submission!.id)!; assert.equal(submission.formVersionId, original.id);
      assert.equal(submission.receipts[0].pdfHash, f.submission.receiptHash); assert.equal(hash(Buffer.from(decrypt<string>(submission.receipts[0].pdfCipher!), "base64")), f.submission.receiptHash);
      await bytesProof(state); f.historyVerifiedAt = new Date().toISOString(); await save(); result = { history: "passed", receiptHash: f.submission.receiptHash };
    } else {
      assert(f.original && f.submission && f.historyVerifiedAt);
      const bytes = await bytesProof(state), digest = hash(JSON.stringify({ state, bytes }));
      if (mode === "verify") assert.equal(digest, f.hash);
      else { assert(!f.hash); await save(); f.hash = digest; await writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 }); }
      result = { hash: digest, forms: state.forms.length, assets: state.assets.length, pins: state.pins.length, bytes };
    }
  }
  const report = { at: new Date().toISOString(), mode, result: "passed", checks, proof: result };
  await writeFile(output + "/" + mode + "-" + runId + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
} catch (cause) {
  const report = { at: new Date().toISOString(), mode, result: "failed", step, checks, error: cause instanceof Error ? cause.message : String(cause) };
  await mkdir(output, { recursive: true }); await writeFile(output + "/failed-" + runId + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report)); process.exitCode = 1;
} finally { await db.$disconnect(); }
