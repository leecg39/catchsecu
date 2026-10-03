/** Local synthetic QA only. Never use this script against a production database or mail provider. */
import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { enqueueMarketingMail } from "../src/server/jobs";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const dir = resolve("docs/qa/marketing"), file = resolve(dir, "browser-fixture.json");
const fixture = JSON.parse(await readFile(file, "utf8").catch(() => JSON.stringify({ formId: "eda284b9-bad3-4cb0-bede-b7b5d236e5f6", serviceId: "08e5858c-6d69-451d-b509-7facf4e1867f", name: "마케팅 합성 응답자", email: "marketing-browser-qa-20261003@catchsecu.local.test", phone: "+821000000103" })));
const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, include: { versions: { include: { submissions: true, questions: { orderBy: { order: "asc" } } } } } });
assert.equal(form.tenantId, "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc"); assert.equal(form.serviceId, fixture.serviceId); assert.equal(form.title, "마케팅 브라우저 QA 2026-10-03");
const version = form.versions.find(v => v.status === "published")!; assert.ok(version); assert.equal(version.submissions.length, 1);
const sub = version.submissions[0], rows = await db.marketingPreference.findMany({ where: { sourceSubmissionId: sub.id }, include: { events: { orderBy: { version: "asc" } } } }); assert.equal(rows.length, 2);
const email = rows.find(p => p.channel === "email")!, sms = rows.find(p => p.channel === "sms")!; assert.ok(email); assert.ok(sms);
Object.assign(fixture, { submissionId: sub.id, emailPreferenceId: email.id, smsPreferenceId: sms.id, questionIds: version.questions.map(q => q.stableKey) });
const phase = process.argv[2];
if (phase === "baseline") {
  for (const row of rows) { assert.equal(row.status, "granted"); assert.equal(row.excluded, false); assert.ok(row.contactCipher); assert.ok(!row.contactCipher.includes(fixture.email));
    assert.deepEqual(decrypt(row.contactCipher), { name: fixture.name, contact: row.channel === "email" ? fixture.email : fixture.phone }); assert.equal(row.events.length, 1); }
  const sent = await enqueueMarketingMail({ to: fixture.email, subject: "마케팅 실제 로컬 전달 QA", text: "선택 동의 후 전달 검증" }, { tenantId: form.tenantId, serviceId: form.serviceId }); assert.ok(sent.id); fixture.deliveredJobId = sent.id;
  let job = await db.job.findUniqueOrThrow({ where: { id: sent.id } });
  for (let n = 0; n < 10 && job.status !== "done"; n++) { await new Promise(r => setTimeout(r, 1000)); job = await db.job.findUniqueOrThrow({ where: { id: sent.id } }); } assert.equal(job.status, "done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, sent.id + ".json"), "utf8")); assert.equal(mail.to, fixture.email);
  await writeFile(resolve(dir, "mail-delivered.json"), JSON.stringify({ result: "PASS", jobId: job.id, status: job.status, deliveredAt: mail.deliveredAt, recipientMatches: true }, null, 2));
} else if (phase === "queue") {
  assert.equal(email.status, "granted"); assert.equal(email.excluded, false);
  const queued = await enqueueMarketingMail({ to: fixture.email, subject: "마케팅 제외 경합 QA", text: "제외 후 전달되면 안 되는 합성 메시지" }, { tenantId: form.tenantId, serviceId: form.serviceId }, undefined, new Date(Date.now() + 3600000)); assert.ok(queued.id); if (fixture.queuedJobId) fixture.previousQueuedJobIds = [...(fixture.previousQueuedJobIds ?? []), fixture.queuedJobId]; fixture.queuedJobId = queued.id;
} else if (phase === "release") {
  assert.equal(email.excluded, true);
  const job = await db.job.findUniqueOrThrow({ where: { id: fixture.queuedJobId } }); assert.equal(job.status, "queued"); assert.ok(job.dueAt > new Date());
  await writeFile(resolve(dir, "queue-before-release.json"), JSON.stringify({ jobId: job.id, status: job.status, dueAt: job.dueAt, excluded: email.excluded, preferenceVersion: email.version, checkedAt: new Date().toISOString() }, null, 2));
  await db.job.update({ where: { id: job.id }, data: { dueAt: new Date() } });
} else if (phase === "excluded") {
  assert.equal(email.excluded, true); const job = await db.job.findUniqueOrThrow({ where: { id: fixture.queuedJobId } }); assert.equal(job.status, "cancelled"); assert.equal(job.lastError, "SUPPRESSED");
  await assert.rejects(() => access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")));
  await writeFile(resolve(dir, "queued-mail-blocked.json"), JSON.stringify({ result: "PASS", jobId: job.id, status: job.status, lastError: job.lastError, localFileAbsent: true }, null, 2));
} else if (phase === "final") {
  assert.equal(email.status, "erased"); assert.equal(email.contactCipher, null); assert.equal(email.evidenceCipher, null); assert.equal(email.nameHash, null); assert.equal(sms.status, "withdrawn");
  assert.deepEqual(email.events.map(e => e.kind), ["granted", "excluded", "included", "excluded", "included", "excluded", "included", "withdrawn", "erased"]); assert.deepEqual(sms.events.map(e => e.kind), ["granted", "withdrawn"]);
  for (const id of [fixture.deliveredJobId, fixture.queuedJobId, ...(fixture.previousQueuedJobIds ?? [])]) { const job = await db.job.findUniqueOrThrow({ where: { id } }); assert.ok(job.payloadErasedAt); assert.deepEqual(decrypt(job.payloadCipher), { erased: true }); await assert.rejects(() => access(resolve(env.LOCAL_MAIL_DIR, id + ".json"))); }
  const blocked = await enqueueMarketingMail({ to: fixture.email, subject: "철회 후 신규 요청 QA", text: "전달되면 안 됩니다." }, { tenantId: form.tenantId, serviceId: form.serviceId }); assert.deepEqual(blocked, { id: null, suppressed: true });
  const imported = await db.marketingPreference.findFirstOrThrow({ where: { serviceId: form.serviceId, sourceKind: "manual", sourceSubmission: { formVersion: { formId: "2dd8f84d-7888-405d-9b68-6beace8c3813" } } } }); assert.equal(imported.status, "granted");
  const events = await db.auditEvent.findMany({ where: { resource: "marketing", resourceId: { in: [email.id, sms.id, imported.id] } } });
  const text = JSON.stringify(events); for (const value of [fixture.name, fixture.email, fixture.phone]) assert.ok(!text.includes(value));
  await writeFile(resolve(dir, "final-verification.json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), formId: form.id, sourceSubmissionId: sub.id, formStatus: form.status,
    emailStatus: email.status, smsStatus: sms.status, emailEvents: email.events.map(e => e.kind), smsEvents: sms.events.map(e => e.kind), originalSubmissionRetained: sub.status === "submitted", mailPayloadsErased: true, localMailFilesErased: true, futureMarketingMailBlocked: true, importedConsentId: imported.id, importedEvidenceEncrypted: !!imported.evidenceCipher,
    auditActions: [...new Set(events.map(e => e.action))], auditContainsNoContacts: true }, null, 2));
} else throw Error("Use baseline, queue, excluded, final");
await writeFile(file, JSON.stringify(fixture, null, 2)); console.log({ phase, result: "PASS" }); await db.$disconnect();
