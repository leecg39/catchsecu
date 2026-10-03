import assert from "node:assert/strict";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { privateFiles } from "../src/server/file-storage";
import { certificateDigest } from "../src/server/destruction";
import { sha256 } from "../src/server/file-validation";

const fixture = JSON.parse(await readFile(".local/destruction-qa/browser.json", "utf8"));
const originalFileQaId = "449cbb40-42ad-430d-a0c2-70a8434fc5d9";
const rows = await db.submission.findMany({ where: { formVersion: { formId: fixture.formId } },
  include: { files: true, answers: true, notes: true, corrections: { include: { payload: true } }, receipts: { include: { events: true } },
    destructions: true, certificate: true, formVersion: true } });
assert.equal(rows.length, 1);
const sub = rows[0];
assert.equal(sub.formVersion.title, "실제 파기 흐름 QA 2026-10-02");
const untouched = await db.submission.findUniqueOrThrow({ where: { id: originalFileQaId }, include: { files: true, answers: true } });
const untouchedHash = sha256(Buffer.from(JSON.stringify(untouched)));
if (process.argv.includes("before")) {
  assert.equal(sub.status, "pendingDestruction"); assert.equal(sub.legalHold, true);
  assert.equal(sub.answers.length, 2); assert.equal(sub.notes.length, 1); assert.equal(sub.files.length, 1);
  const file = sub.files[0], path = resolve(env.PRIVATE_STORAGE_DIR, "objects", file.storageKey + ".enc");
  const source = await readFile(".local/destruction-qa/삭제 증빙.txt"), stored = await privateFiles.read(file.storageKey);
  assert.deepEqual(stored, source); assert.equal(file.sha256, sha256(source)); assert.equal(file.status, "attached");
  assert.equal((await readFile(path)).includes(source), false);
  const result = { submissionId: sub.id, formId: fixture.formId, tenantId: sub.tenantId,
    recordedAt: new Date().toISOString(), status: sub.status, legalHold: sub.legalHold, untouchedHash,
    answers: sub.answers.length, notes: sub.notes.length, corrections: sub.corrections.length, receipts: sub.receipts.length,
    files: [{ id: file.id, storageKey: file.storageKey, sha256: file.sha256, size: file.size, encrypted: true, mode: (await lstat(path)).mode & 0o777 }],
    originalMatches: true };
  await writeFile(".local/destruction-qa/before.json", JSON.stringify(result, null, 2), { mode: 0o600 });
  await writeFile("docs/qa/destruction/database-before.json", JSON.stringify(result, null, 2));
  console.log({ before: "PASS", submissionId: sub.id, originalMatches: true });
} else {
  const before = JSON.parse(await readFile(".local/destruction-qa/before.json", "utf8"));
  assert.equal(sub.status, "destroyed"); assert.equal(sub.legalHold, false); assert.equal(untouchedHash, before.untouchedHash);
  for (const list of [sub.answers, sub.notes, sub.corrections, sub.receipts]) assert.equal(list.length, 0);
  for (const file of sub.files) {
    assert.equal(file.status, "deleted"); assert.equal(file.nameCipher, null); assert.equal(file.sha256, null); assert.equal(file.size, 0);
    await assert.rejects(lstat(resolve(env.PRIVATE_STORAGE_DIR, "objects", file.storageKey + ".enc")), { code: "ENOENT" });
  }
  const caches = await db.idempotencyRecord.findMany({ where: { tenantId: sub.tenantId, resourceId: { in: [sub.id, ...sub.files.map(file => file.id)] } } });
  assert.equal(caches.length, 3);
  for (const row of caches) { assert.equal(row.responseCipher, null); assert.equal(row.requestHash, null); assert.ok(row.invalidatedAt); }
  for (const job of sub.destructions) { assert.equal(job.reasonCipher, null); assert.equal(job.decisionCipher, null); }
  assert.ok(sub.certificate); assert.equal(sub.certificate.digest, certificateDigest(sub.certificate));
  const downloaded = JSON.parse(await readFile("docs/qa/destruction/certificate.json", "utf8"));
  assert.equal(downloaded.id, sub.certificate.id); assert.equal(downloaded.digest, sub.certificate.digest); assert.deepEqual(downloaded.counts, sub.certificate.counts);
  const audits = await db.auditEvent.findMany({ where: { tenantId: sub.tenantId, resourceId: { in: [sub.id, ...sub.destructions.map(row => row.id), ...sub.files.map(row => row.id)] } } });
  const auditText = JSON.stringify(audits);
  for (const value of ["파기검증 가상응답자", "삭제 증빙", "파기 대상 메모", "정정 원문까지 삭제"]) assert.equal(auditText.includes(value), false);
  const result = { verifiedAt: new Date().toISOString(), submissionId: sub.id, formId: fixture.formId, status: sub.status,
    originalAnswers: sub.answers.length, notes: sub.notes.length, corrections: sub.corrections.length, consentReceipts: sub.receipts.length,
    filesAbsent: sub.files.length, fileMetadataCleared: true, invalidatedResponseCaches: caches.length, requestReasonsCleared: true,
    certificateId: sub.certificate.id, counts: sub.certificate.counts, certificateVerified: true, downloadedCertificateMatches: true,
    auditContainsPrivateValues: false, previousFileQaUnchanged: true, requestStates: sub.destructions.map(row => ({ id: row.id, status: row.status })) };
  await writeFile("docs/qa/destruction/database-after.json", JSON.stringify(result, null, 2)); console.log(result);
}
await db.$disconnect();
