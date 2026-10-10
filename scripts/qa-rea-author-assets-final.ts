import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { contentDto, versionInclude } from "../src/server/forms";

// Read-only assertions for the actual Ego journey, including its second viewer grant.
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = ".local/rea-fullstack/author-assets";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
let step = "load recorded QA identifiers";
try {
  const f = JSON.parse(await readFile(directory + "/fixture.json", "utf8"));
  const second = JSON.parse(await readFile(directory + "/viewer-second.json", "utf8"));
  const cleanup = JSON.parse(await readFile(directory + "/copy-cleanup.json", "utf8"));
  step = "old approval snapshot remains immutable after a new approval";
  const oldApproval = await db.approvalRequest.findFirstOrThrow({ where: { id: f.approval.id, tenantId: f.companyId } });
  assert.equal(oldApproval.status, "superseded");
  assert.equal(hash(JSON.stringify(oldApproval.snapshot)), f.approval.snapshotHash);
  const oldPins = await db.authorAssetReference.findMany({ where: { approvalId: oldApproval.id }, orderBy: { id: "asc" } });
  assert.equal(hash(JSON.stringify(oldPins)), f.approval.pinHash);
  step = "latest approved snapshot consumed by actual publication";
  const latestApproval = await db.approvalRequest.findFirstOrThrow({ where: { formId: f.formId, tenantId: f.companyId }, orderBy: { createdAt: "desc" } });
  assert.notEqual(latestApproval.id, oldApproval.id); assert.equal(latestApproval.status, "consumed");
  assert.equal(await db.authorAssetReference.count({ where: { approvalId: latestApproval.id } }), 2);
  step = "actual correction preserves the receipt and source question version";
  const submission = await db.submission.findFirstOrThrow({ where: { id: f.submission.id, tenantId: f.companyId }, include: { answers: { include: { question: true } }, receipts: true } });
  assert.equal(submission.status, "corrected"); assert.equal(submission.version, 2);
  assert.equal(submission.formVersionId, f.original.versionId);
  assert.equal(await db.correction.count({ where: { submissionId: submission.id } }), 1);
  const values = Object.fromEntries(submission.answers.map(a => [a.question.stableKey, decrypt(a.valueCipher)]));
  assert.deepEqual(values, { [f.questionIds[0]]: "보기 A", [f.questionIds[1]]: ["항목 A"], [f.questionIds[2]]: "이전 버전 자료 확인 후 정정" });
  assert.equal(submission.receipts.length, 1);
  assert.equal(submission.receipts[0].pdfHash, f.submission.receiptHash);
  assert.equal(hash(Buffer.from(decrypt<string>(submission.receipts[0].pdfCipher!), "base64")), f.submission.receiptHash);
  step = "template source removed and copied assets survive";
  assert.equal(await db.formTemplate.count({ where: { id: f.templateId } }), 0);
  assert.equal(await db.authorAssetReference.count({ where: { templateId: f.templateId } }), 0);
  const used = await db.form.findFirstOrThrow({ where: { id: f.templateUsedId, tenantId: f.companyId }, include: { versions: { include: versionInclude, orderBy: { number: "desc" } } } });
  const usedPins = await db.authorAssetReference.findMany({ where: { formVersionId: used.versions[0].id }, include: { asset: { include: { blob: true } } } });
  assert.equal(usedPins.length, 2);
  const copiedBytes = [];
  for (const pin of usedPins) {
    assert.equal(pin.asset.status, "ready"); assert.equal(pin.asset.expiresAt, null);
    assert.equal(pin.asset.blob.status, "ready"); assert.equal(pin.asset.blob.scanStatus, "clean");
    assert(!f.original.assetIds.includes(pin.assetId));
    const bytes = await privateFiles.read(pin.asset.blob.storageKey);
    assert.equal(hash(bytes), pin.asset.blob.sha256);
    copiedBytes.push({ sha256: pin.asset.blob.sha256, size: bytes.length });
  }
  const cleared = await db.form.findFirstOrThrow({ where: { id: f.copies[0], tenantId: f.companyId }, include: { versions: { include: versionInclude } } });
  for (const version of cleared.versions) {
    assert.equal(await db.authorAssetReference.count({ where: { formVersionId: version.id } }), 0);
    assert(contentDto(version).questions.every(q => !q.materialList?.length && !q.optionDefinitions?.some(o => o.optionImageKey)));
  }
  for (const id of cleanup.assetIds) {
    const asset = await db.authorAsset.findFirstOrThrow({ where: { id, tenantId: f.companyId }, include: { blob: true } });
    assert.equal(asset.status, "deleted"); assert.equal(asset.nameCipher, null); assert.equal(asset.blob.status, "ready");
  }
  step = "both actual viewer grants and sessions revoked";
  const shares = await db.shareGrant.findMany({ where: { id: { in: [f.shareId, second.grantId] }, tenantId: f.companyId }, include: { sessions: true, challenges: true } });
  assert.equal(shares.length, 2);
  for (const share of shares) {
    assert(share.revokedAt); assert.equal(share.sessions.length, 1); assert(share.sessions.every(s => s.revokedAt));
    assert.equal(share.challenges.length, 1); assert(share.challenges.every(c => c.consumedAt));
  }
  const report = { at: new Date().toISOString(), result: "passed", oldApprovalPins: oldPins.length, latestApprovalPins: 2,
    submissionVersion: submission.version, corrections: 1, receiptHash: f.submission.receiptHash,
    deletedTemplate: true, copiedBytes, discardedCopyAssets: cleanup.assetIds.length, revokedGrants: 2,
    method: "Read-only database and actual encrypted-storage bytes after the recorded Ego and HTTP actions." };
  await writeFile("docs/qa/R08-T02/question-metadata/author-assets/flow/final-state-" + randomUUID() + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} catch (error) {
  const report = { at: new Date().toISOString(), result: "failed", step, errorType: error instanceof Error ? error.name : "UnknownError" };
  await writeFile("docs/qa/R08-T02/question-metadata/author-assets/flow/final-state-failed-" + randomUUID() + ".json", JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify(report)); process.exitCode = 1;
} finally { await db.$disconnect(); }
