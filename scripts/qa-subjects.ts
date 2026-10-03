/** Synthetic local-only verification. Never print authentication links or session cookies. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { enqueueServiceMail } from "../src/server/jobs";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = resolve("docs/qa/subjects"), fixture = JSON.parse(await readFile(resolve(directory, "browser-fixture.json"), "utf8"));
const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, include: { versions: { include: { questions: { orderBy: { order: "asc" } }, submissions: { include: { subject: true, subjectWithdrawals: true, receipts: { include: { events: true } } } } } } } });
assert.equal(form.tenantId, "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc"); assert.equal(form.serviceId, fixture.serviceId); assert.ok(form.title.startsWith("정보주체 브라우저 QA"));
const version = form.versions.find(v => v.status === "published")!; assert.ok(version);
const sub = version.submissions[0]; assert.ok(sub?.subject); assert.equal(version.submissions.length, 1);
assert.deepEqual(version.questions.map(q => q.subjectRole), ["name", "email", null]);
assert.deepEqual(decrypt(sub.subject.contactCipher), { name: fixture.name, email: fixture.email }); assert.ok(!sub.subject.contactCipher.includes(fixture.email));
Object.assign(fixture, { submissionId: sub.id, subjectId: sub.subjectId, formVersionId: version.id, questionIds: version.questions.map(q => q.stableKey) });
await writeFile(resolve(directory, "browser-fixture.json"), JSON.stringify(fixture, null, 2));
const phase = process.argv[2];
if (phase === "mail") {
  assert.equal(env.MAIL_TRANSPORT, "local");
  const request = await db.subjectAccessRequest.findFirstOrThrow({ where: { scopes: { some: { subjectId: sub.subjectId! } } }, orderBy: { createdAt: "desc" } });
  let job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + request.id } });
  for (let i = 0; i < 10 && job.status !== "done"; i++) { await new Promise(r => setTimeout(r, 1000)); job = await db.job.findUniqueOrThrow({ where: { id: job.id } }); }
  assert.equal(job.status, "done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); assert.equal(mail.to, fixture.email);
  const url = mail.text.match(/http:\/\/localhost:3100\/infoOwner\/agree-history\/[A-Za-z0-9_-]{43}/)?.[0]; assert.ok(url);
  await writeFile(resolve(".local/subjects-current-mail.json"), JSON.stringify({ url, requestId: request.id }), { mode: 0o600 });
  await writeFile(resolve(directory, "mail-verification.json"), JSON.stringify({ requestId: request.id, jobId: job.id, deliveredAt: mail.deliveredAt, status: job.status, expiresAt: request.expiresAt, authenticationLinkPresent: true }, null, 2));
  console.log({ phase, delivered: true });
} else if (phase === "final") {
  assert.equal(sub.status, "withdrawn"); assert.equal(sub.version, 2);
  assert.ok(sub.subjectWithdrawals.some(w => w.status === "cancelled")); assert.ok(sub.subjectWithdrawals.some(w => w.status === "completed"));
  assert.equal(sub.receipts.flatMap(r => r.events).filter(e => e.type === "withdrawn").length, 1);
  const suppression = await db.suppression.findFirstOrThrow({ where: { sourceSubmissionId: sub.id } }); assert.equal(suppression.emailHash, sub.subject.emailHash);
  const delivery = await enqueueServiceMail({ to: fixture.email, subject: "발송 차단 합성 확인", text: "전달되면 안 되는 시험 메시지" }, { tenantId: sub.tenantId, serviceId: form.serviceId });
  assert.deepEqual(delivery, { id: null, suppressed: true });
  const audit = await db.auditEvent.findMany({ where: { tenantId: sub.tenantId, resource: "subject", OR: [{ resourceId: sub.id }, { resourceId: { in: sub.subjectWithdrawals.map(r => r.id) } }] } });
  for (const action of ["subject.consents_viewed", "subject.events_viewed", "subject.withdrawal_cancelled", "subject.withdrawn"]) assert.ok(audit.some(e => e.action === action), action);
  assert.ok(!JSON.stringify(audit).includes(fixture.email)); assert.ok(!JSON.stringify(audit).includes(fixture.name));
  const result = { checkedAt: new Date().toISOString(), formId: form.id, submissionId: sub.id, status: sub.status, version: sub.version,
    roles: version.questions.map(q => q.subjectRole), contactEncrypted: true, withdrawalStates: sub.subjectWithdrawals.map(w => w.status), consentEvents: sub.receipts.flatMap(r => r.events).map(e => e.type), suppression: true, futureMailBlocked: true, auditActions: [...new Set(audit.map(e => e.action))], result: "PASS" };
  await writeFile(resolve(directory, "final-verification.json"), JSON.stringify(result, null, 2)); console.log({ phase, result: "PASS", futureMailBlocked: true });
 } else if (phase === "csv") {
  const job = await db.importJob.findUniqueOrThrow({ where: { id: fixture.csvJobId }, include: { file: true, submissions: { include: { subject: true, formVersion: { include: { questions: { orderBy: { order: "asc" } } } } } } } });
  assert.equal(job.tenantId, form.tenantId); assert.equal(job.status, "completed"); assert.equal(job.importedRows, 1); assert.equal(job.invalidRows, 0);
  assert.equal(job.file.scanStatus, "clean"); assert.equal(job.file.status, "deleted"); await assert.rejects(() => privateFiles.read(job.file.storageKey));
  const csvSub = job.submissions[0]; assert.ok(csvSub.subject); assert.deepEqual(csvSub.formVersion.questions.map(q => q.subjectRole), ["name", "email"]);
  assert.deepEqual(decrypt(csvSub.subject.contactCipher), { name: "CSV 정보주체 합성", email: "subject-csv-qa-20261003@catchsecu.local.test" });
  assert.ok((await db.importRow.findMany({ where: { jobId: job.id } })).every(row => row.payloadCipher === null));
  const result = { checkedAt: new Date().toISOString(), jobId: job.id, status: job.status, importedRows: job.importedRows,
    roles: csvSub.formVersion.questions.map(q => q.subjectRole), subjectBound: true, encryptedContactMatches: true, scanStatus: job.file.scanStatus, scanEngine: job.file.scanEngine, fileErased: true, stagedValuesErased: true, result: "PASS" };
  await writeFile(resolve(directory, "csv-verification.json"), JSON.stringify(result, null, 2)); console.log({ phase, result: "PASS", importedRows: job.importedRows });
} else throw Error("Supported phases: mail, final, csv");
await db.$disconnect();
