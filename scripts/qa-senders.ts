/** Local synthetic evidence only; refuses production databases and external mail. */
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { enqueueMarketingMail, SENDER_MAIL_JOB_TYPE } from "../src/server/jobs";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(env.MAIL_TRANSPORT, "local");
const scope = { tenantId: "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc", serviceId: "08e5858c-6d69-451d-b509-7facf4e1867f" };
const dir = resolve("docs/qa/senders"), fixturePath = resolve(dir, "browser-fixture.json");
type Fixture = { senderId?: string; smsId?: string; authJobId?: string; deliveredJobId?: string; queuedJobId?: string; fileIds?: string[] };
const fixture: Fixture = JSON.parse(await readFile(fixturePath, "utf8").catch(() => "{}"));
const sender = fixture.senderId ? await db.sender.findUniqueOrThrow({ where: { id: fixture.senderId } }) : await db.sender.findFirstOrThrow({ where: { ...scope, channel: "email", label: "발신자 브라우저 QA 이메일 2026-10-03" } });
assert.equal(sender.tenantId, scope.tenantId); assert.equal(sender.serviceId, scope.serviceId);
fixture.senderId = sender.id;
const phase = process.argv[2];
async function save(name: string, value: object) { await writeFile(resolve(dir, name + ".json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), ...value }, null, 2)); }
async function waitJob(id: string) {
  for (let n = 0; n < 15; n++) {
    const job = await db.job.findUniqueOrThrow({ where: { id } });
    if (["done", "cancelled", "failed"].includes(job.status)) return job;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw Error("Local worker did not finish the synthetic job");
}
if (phase === "code") {
  const proof = await db.senderVerification.findFirstOrThrow({ where: { senderId: sender.id, generation: sender.generation, method: "email", status: "pending" }, orderBy: { createdAt: "desc" } });
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sender-verification:" + proof.id } });
  assert.equal((await waitJob(job.id)).status, "done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8"));
  assert.equal(mail.to, "sender-qa@catchsecu-sender-qa-20261003.test");
  const code = /인증번호: (\d{6})/.exec(mail.text)?.[1]; assert.ok(code);
  await writeFile(".local/sender-qa-code", code, { mode: 0o600 }); fixture.authJobId = job.id;
  await save("authentication-mail", { jobId: job.id, deliveredLocally: true, recipientMatches: true, secretExcluded: true });
} else if (phase === "verified") {
  assert.equal(sender.status, "verified"); assert.equal(sender.environment, "local"); assert.equal(sender.isDefault, true);
  assert.equal(decrypt(sender.addressCipher!), "sender-qa@catchsecu-sender-qa-20261003.test");
  assert.equal(sender.description, "합성 발신 주소 수정 및 영속성 검증");
  const proofs = await db.senderVerification.findMany({ where: { senderId: sender.id, generation: sender.generation, status: "verified" } });
  assert.deepEqual(proofs.map(p => p.method).sort(), ["dns", "email"]);
  const authJob = await db.job.findUniqueOrThrow({ where: { id: fixture.authJobId! } });
  assert.ok(authJob.payloadErasedAt); assert.deepEqual(decrypt(authJob.payloadCipher), { erased: true });
  await assert.rejects(() => access(resolve(env.LOCAL_MAIL_DIR, authJob.id + ".json")));
  await save("verified-sender", { senderId: sender.id, version: sender.version, status: sender.status, environment: sender.environment, isDefault: true, authenticationPayloadErased: true, authenticationFileErased: true });
} else if (phase === "mail") {
  assert.equal(sender.status, "verified"); assert.equal(sender.environment, "local");
  const to = "subject-csv-qa-20261003@catchsecu.local.test";
  const sent = await enqueueMarketingMail({ to, subject: "발신자 브라우저 QA 실제 로컬 전달", text: "인증된 발신 주소를 사용하는 합성 메시지입니다." }, scope, "sender-browser-delivery-20261003:" + sender.id, new Date(), { id: sender.id, version: sender.version });
  assert.ok(sent.id); fixture.deliveredJobId = sent.id;
  assert.equal((await waitJob(sent.id)).status, "done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, sent.id + ".json"), "utf8"));
  assert.deepEqual(mail.from, { name: sender.label, address: decrypt(sender.addressCipher!) }); assert.equal(mail.to, to);
  const queued = await enqueueMarketingMail({ to, subject: "발신자 중지 후 차단 QA", text: "중지 후 전달되면 안 됩니다." }, scope, "sender-browser-cancel-20261003:" + sender.id, new Date(Date.now() + 3600000), { id: sender.id, version: sender.version });
  assert.ok(queued.id); fixture.queuedJobId = queued.id;
  await save("branded-mail-delivered", { jobId: sent.id, status: "done", actualFromMatches: true, recipientMatches: true, environment: "local", queuedJobId: queued.id });
} else if (phase === "release") {
  assert.equal(sender.status, "disabled"); assert.equal(sender.isDefault, false);
  const job = await db.job.findUniqueOrThrow({ where: { id: fixture.queuedJobId! } });
  assert.equal(job.status, "queued"); assert.ok(job.dueAt > new Date());
  await save("queue-before-release", { senderId: sender.id, senderStatus: sender.status, senderVersion: sender.version, jobId: job.id, jobStatus: job.status, originalDueAt: job.dueAt });
  await db.job.update({ where: { id: job.id }, data: { dueAt: new Date() } });
  const cancelled = await waitJob(job.id); assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.lastError, "SUPPRESSED");
  await assert.rejects(() => access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")));
  await save("queued-mail-blocked", { jobId: job.id, status: cancelled.status, localMailFileAbsent: true, lastError: cancelled.lastError });
} else if (phase === "sms") {
  const sms = await db.sender.findFirstOrThrow({ where: { ...scope, channel: "sms", label: "발신자 브라우저 QA 문자 2026-10-03" } });
  assert.equal(sms.status, "pending"); assert.equal(decrypt(sms.addressCipher!), "01000000104"); fixture.smsId = sms.id;
  const files = await db.fileObject.findMany({ where: { senderId: sms.id } }); assert.ok(files.length);
  assert.ok(files.some(f => f.status === "attached" && f.scanStatus === "clean")); fixture.fileIds = files.map(f => f.id);
  await save("sms-evidence-attached", { senderId: sms.id, status: sms.status, providerNotConfigured: !env.SOLAPI_API_KEY, files: files.map(f => ({ id: f.id, status: f.status, scanStatus: f.scanStatus, size: f.size })) });
} else if (phase === "final") {
  assert.equal(sender.status, "deleted"); assert.equal(sender.addressCipher, null); assert.equal(sender.domain, null); assert.equal(sender.isDefault, false);
  assert.equal(sender.label, ""); assert.equal(sender.description, "");
  const sms = await db.sender.findUniqueOrThrow({ where: { id: fixture.smsId! } }); assert.equal(sms.status, "deleted"); assert.equal(sms.addressCipher, null);
  const files = await db.fileObject.findMany({ where: { id: { in: fixture.fileIds ?? [] } } }); assert.ok(files.length); assert.ok(files.every(f => f.status === "deleted"));
  for (const file of files) await assert.rejects(() => access(resolve(env.PRIVATE_STORAGE_DIR, "objects", file.storageKey + ".enc")));
  const proofs = await db.senderVerification.findMany({ where: { senderId: sender.id } }); assert.ok(proofs.every(p => p.status === "superseded" && p.tokenHash === null && p.valueCipher === null));
  const events = await db.senderEvent.findMany({ where: { senderId: { in: [sender.id, sms.id] } }, orderBy: [{ senderId: "asc" }, { version: "asc" }] });
  for (const row of [sender, sms]) assert.deepEqual(events.filter(e => e.senderId === row.id).map(e => e.version), Array.from({ length: row.version }, (_, i) => i + 1));
  const delivered = await db.job.findUniqueOrThrow({ where: { id: fixture.deliveredJobId! } });
  const blocked = await db.job.findUniqueOrThrow({ where: { id: fixture.queuedJobId! } });
  assert.equal(delivered.type, SENDER_MAIL_JOB_TYPE); assert.equal(delivered.status, "done");
  assert.equal(blocked.type, SENDER_MAIL_JOB_TYPE); assert.equal(blocked.status, "cancelled");
  await assert.rejects(() => access(resolve(env.LOCAL_MAIL_DIR, blocked.id + ".json")));
  const audits = await db.auditEvent.findMany({ where: { resource: "sender", resourceId: { in: [sender.id, sms.id] } } });
  const auditText = JSON.stringify(audits); assert.ok(!auditText.includes("sender-qa@")); assert.ok(!auditText.includes("01000000104"));
  await save("final-verification", { senderStatus: sender.status, smsStatus: sms.status, deletedAddressCipherAbsent: true, proofSecretsErased: true, fileCount: files.length, filesDeleted: true, auditContactAbsent: true, mailProtocol: delivered.type, deliveredStatus: delivered.status, blockedStatus: blocked.status, blockedLocalMailFileAbsent: true, contiguousEvents: true, events: events.map(e => ({ senderId: e.senderId, kind: e.kind, version: e.version })) });
} else throw Error("Use code, verified, mail, release, sms, final");
await writeFile(fixturePath, JSON.stringify(fixture, null, 2)); console.log({ phase, result: "PASS" }); await db.$disconnect();
