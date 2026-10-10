import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { env } from "../src/server/env";
import { parse } from "csv-parse/sync";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
assert.ok(fixture.owner.email.startsWith("rea-owner-"));
const output = "docs/qa/R11-T04/browser-flow";
const afterConflict = process.argv.includes("--after-conflict");
try {
  const row = await db.submission.findUniqueOrThrow({ where: { id: fixture.submissionId }, include: {
    answers: true, notes: true, corrections: { include: { payload: true }, orderBy: { createdAt: "asc" } }, receipts: true,
  } });
  assert.equal(row.tenantId, fixture.owner.companyId);
  assert.equal(row.status, "corrected");
  assert.equal(row.notes.length, 0);
  assert.equal(row.corrections.length, afterConflict ? 3 : 1);
  const correction = row.corrections[0];
  assert.ok(correction.payload);
  const before = decrypt<{ answers: Record<string, string>; reason: string }>(correction.payload.beforeCipher);
  const after = decrypt<Record<string, string>>(correction.payload.afterCipher);
  assert.equal(before.reason, "REA 정정 이력 검증");
  assert.deepEqual(Object.values(before.answers), ["REA 시험 응답자"]);
  assert.deepEqual(Object.values(after), ["REA 정정 응답자"]);
  assert.equal(correction.reason, "answers_corrected");
  assert.ok(row.answers.map(answer => decrypt(answer.valueCipher)).includes(afterConflict ? "REA 최종 정정 응답자" : "REA 정정 응답자"));
  const events = await db.auditEvent.findMany({ where: { tenantId: row.tenantId, resourceId: row.id }, orderBy: { createdAt: "asc" } });
  for (const action of ["submission.note_created", "submission.note_updated", "submission.note_deleted", "submission.corrected"]) {
    assert.equal(events.filter(event => event.action === action).length, afterConflict && action === "submission.corrected" ? 3 : 1, action);
  }
  assert.ok(!JSON.stringify(events).includes("REA 정정 응답자"));
  assert.ok(!JSON.stringify(events).includes("REA 정정 이력 검증"));
  const pdf = await readFile(output + "/consent-receipt.pdf");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pdfHash = createHash("sha256").update(pdf).digest("hex");
  assert.equal(pdfHash, row.receipts[0].pdfHash);
  if (afterConflict) {
    assert.equal(row.version, 4);
    const csv = parse(await readFile("docs/qa/R22-T02/audit-resources/browser-audit.csv", "utf8"), { bom: true, columns: true }) as Record<string, string>[];
    assert.equal(csv.length, 3);
    assert.deepEqual(csv.map(record => record["이벤트 ID"]).sort(), events.filter(event => event.action === "submission.corrected").map(event => event.id).sort());
    assert.ok(csv.every(record => record["응답 ID"] === row.id && record["캐치폼·개인정보 업로드명"] === "REA 실제 응답 검증"));
  }
  const report = { checkedAt: new Date().toISOString(), result: "passed", submissionId: row.id, status: row.status,
    version: row.version, notesRemaining: 0, correctionCount: row.corrections.length, encryptedBeforeAfterVerified: true,
    afterConflict, csvMatchesAuditDatabase: afterConflict,
    reasonEncrypted: true, auditContainsPersonalValues: false, auditActions: events.map(event => event.action),
    downloadedPdfBytes: pdf.length, downloadedPdfHash: pdfHash, databasePdfHashMatches: true };
  await writeFile(output + (afterConflict ? "/db-after-conflict.json" : "/db.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
