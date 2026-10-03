import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
const id = "c3553650-5694-4bd9-b179-12e398b96eef";
const form = await db.form.findUniqueOrThrow({ where: { id }, include: { versions: { include: { questions: true } }, publications: true } });
const rows = await db.submission.findMany({ where: { publication: { formId: id } }, include: { answers: true, receipts: true } });
assert.equal(form.status, "published");
assert.equal(rows.length, 1);
assert.equal(rows[0].receipts.length, 1);
const values = rows[0].answers.map(answer => decrypt<string>(answer.valueCipher));
assert(values.includes("브라우저 시험 참가자"));
assert(values.includes("온라인"));
assert(rows[0].answers.every(answer => !answer.valueCipher.includes("브라우저 시험 참가자")));
assert.equal(form.publications[0].responseCount, 1);
assert.equal(form.versions.find(version => version.status === "published")?.retentionDays, 30);
await mkdir("docs/qa/forms", { recursive: true });
await writeFile("docs/qa/forms/database-evidence.json", JSON.stringify({
  checkedAt: new Date().toISOString(), formId: id, status: form.status, version: form.version,
  versions: form.versions.length, questionCount: form.versions[0].questions.length,
  submissionCount: rows.length, submissionId: rows[0].id,
  consentReceiptCount: rows[0].receipts.length, encryptedAtRest: true, submittedValuesMatched: true,
  publicationResponseCount: form.publications[0].responseCount, retentionDays: 30,
  auditActions: (await db.auditEvent.findMany({ where: { OR: [{ resourceId: id }, { resourceId: rows[0].id }] }, orderBy: { createdAt: "asc" }, select: { action: true } })).map(row => row.action),
}, null, 2));
console.log("Browser-created form and encrypted submission verified in PostgreSQL.");
await db.$disconnect();
