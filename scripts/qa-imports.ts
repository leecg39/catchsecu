import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { privateFiles } from "../src/server/file-storage";
import { decrypt } from "../src/server/crypto";
import type { ImportSnapshot } from "../src/contracts/imports";
const database = new URL(env.DATABASE_URL), stage = process.argv[2];
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.ok(["validated", "committed", "corrected", "archived"].includes(stage));
const directory = "docs/qa/imports";
try {
  const { id } = JSON.parse(await readFile(directory + "/browser-job.json", "utf8"));
  const fixture = JSON.parse(await readFile(directory + "/browser-fixture.json", "utf8"));
  const job = await db.importJob.findUniqueOrThrow({ where: { id }, include: { file: true, rows: { orderBy: { rowNo: "asc" } },
    submissions: { orderBy: { importRowNo: "asc" }, include: { answers: { include: { question: true } }, importEvidence: true, receipts: true, corrections: true } }, formVersion: { include: { form: true } } } });
  assert.equal(job.tenantId, "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc"); assert.equal(job.serviceId, fixture.serviceId);
  assert.equal(job.purposeId, fixture.purposeId); assert.equal(job.sourceRecipientId, fixture.recipientId);
  assert.equal(job.totalRows, 4); assert.equal(job.validRows, 2); assert.equal(job.invalidRows, 1); assert.equal(job.skippedRows, 1);
  assert.ok(job.rows.every(row => !row.payloadCipher?.includes("a@example.test")));
  let fileEncrypted = false, originalErased = false;
  const object = resolve(env.PRIVATE_STORAGE_DIR, "objects", job.file.storageKey + ".enc");
  if (stage === "validated") {
    assert.equal(job.status, "validated"); assert.equal(job.submissions.length, 0); assert.equal(job.file.status, "ready"); assert.equal(job.file.scanStatus, "clean");
    assert.deepEqual(await privateFiles.read(job.file.storageKey), await readFile(directory + "/browser-sample.csv"));
    const cipher = await readFile(object); assert.equal(cipher.subarray(0, 4).toString(), "CSF1"); assert.ok(!cipher.includes(Buffer.from("a@example.test"))); fileEncrypted = true;
  } else {
    assert.equal(job.status, stage === "archived" ? "archived" : "partialFailed"); assert.equal(job.submissions.length, 2); assert.equal(job.importedRows, 2);
    assert.equal(job.file.status, "deleted"); assert.equal(job.file.nameCipher, null); await assert.rejects(access(object)); originalErased = true;
    assert.equal(job.formVersion?.form.sourceType, "import"); assert.equal(await db.publication.count({ where: { formId: job.formVersion!.formId } }), 0);
    assert.deepEqual(job.rows.map(row => row.status), ["imported", "error", "duplicate", "imported"]);
    assert.equal(job.rows[0].payloadCipher, null); assert.equal(job.rows[3].payloadCipher, null); assert.equal(job.rows[2].submissionId, job.submissions[0].id);
    for (const sub of job.submissions) {
      assert.equal(sub.publicationId, null); assert.ok(sub.importEvidence); assert.equal(sub.answers.length, 2); assert.equal(sub.receipts.length, 1);
      const evidence = decrypt<{ snapshot: ImportSnapshot; collectedAt: string }>(sub.importEvidence!.payloadCipher);
      assert.equal(evidence.snapshot.recipient?.id, fixture.recipientId); assert.equal(evidence.snapshot.purpose.version, 1);
      assert.equal(sub.retentionUntil.getTime(), Date.parse(evidence.collectedAt) + 30 * 86400000);
    }
    if (["corrected", "archived"].includes(stage)) {
      assert.equal(job.submissions.filter(s => s.status === "corrected").length, 1);
      const corrected = job.submissions.find(s => s.status === "corrected")!; assert.equal(corrected.corrections.length, 1);
      assert.equal(decrypt<string>(corrected.answers.find(a => a.question.label === "이름")!.valueCipher), "CSV 시험 A 정정");
    }
    if (stage === "archived") { assert.ok(job.rows.every(row => row.payloadCipher === null && row.digest === null)); assert.equal(job.snapshotCipher, null); assert.equal(job.mappingCipher, null); assert.equal(job.headersCipher, null); }
  }
  const audit = await db.auditEvent.findMany({ where: { tenantId: job.tenantId, resourceId: id }, orderBy: { createdAt: "asc" }, select: { action: true } });
  const evidence = { checkedAt: new Date().toISOString(), stage, jobId: id, status: job.status, version: job.version,
    total: job.totalRows, valid: job.validRows, invalid: job.invalidRows, duplicate: job.skippedRows, imported: job.importedRows,
    source: { status: job.file.status, scan: job.file.scanStatus, engine: job.file.scanEngine, fileEncrypted, originalErased },
    formId: job.formVersion?.formId, submissions: job.submissions.map(s => ({ id: s.id, rowNo: s.importRowNo, status: s.status, answers: s.answers.length, receipts: s.receipts.length, evidence: !!s.importEvidence })),
    remainingRawRows: job.rows.filter(r => r.payloadCipher !== null).length, audit: audit.map(e => e.action),
    checks: { tenantAndService: true, catalogSnapshot: stage !== "validated", zeroResponsesAtValidation: stage === "validated", noPublicLink: stage !== "validated", encryptedStaging: true } };
  await writeFile(directory + "/database-" + stage + ".json", JSON.stringify(evidence, null, 2) + "\n"); console.log({ stage, status: job.status, submissions: job.submissions.length, checks: "PASS" });
} finally { await db.$disconnect(); }
