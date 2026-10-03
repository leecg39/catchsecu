import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
const id = "4b1cc8f4-02e4-445b-b5cf-3ddb28a6af60";
const row = await db.submission.findUniqueOrThrow({ where: { id }, include: { answers: true, corrections: { include: { payload: true } }, notes: true } });
assert.equal(row.status, "corrected"); assert.equal(row.version, 2);
assert.equal(row.corrections.length, 1); assert.equal(row.notes.length, 0);
assert(row.answers.some(answer => decrypt(answer.valueCipher) === "브라우저 정정 참가자"));
const snapshot = decrypt<{ answers: Record<string,string>; reason: string }>(row.corrections[0].payload!.beforeCipher);
assert(Object.values(snapshot.answers).includes("브라우저 시험 참가자"));
assert.equal(snapshot.reason, "참가자 요청에 따른 이름 정정 시험");
const events = await db.auditEvent.findMany({ where: { resourceId: id }, select: { action: true } });
for (const action of ["submission.corrected", "submission.note_created", "submission.note_updated", "submission.note_deleted"]) assert(events.some(event => event.action === action));
await writeFile("docs/qa/forms/database-history-evidence.json", JSON.stringify({
  checkedAt: new Date().toISOString(), submissionId: id, status: row.status, version: row.version,
  correctionCount: row.corrections.length, originalPreservedEncrypted: true, correctionReasonEncrypted: true,
  currentValueMatched: true, noteCreateUpdateDeleteAudited: true, remainingNotes: row.notes.length,
  auditActions: events.map(event => event.action),
}, null, 2));
console.log("Browser correction, encrypted history and note CRUD verified in PostgreSQL.");
await db.$disconnect();
