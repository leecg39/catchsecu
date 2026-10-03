/** Independently inspect synthetic local sharing fixtures; never logs codes or session tokens. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = resolve("docs/qa/sharing"), fixture = JSON.parse(await readFile(resolve(directory, "browser-fixture.json"), "utf8"));
const grant = await db.shareGrant.findUniqueOrThrow({ where: { id: fixture.grantId }, include: { fields: { include: { question: true } }, form: true, sessions: true } });
assert.equal(grant.tenantId, "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc"); assert.equal(grant.formId, fixture.formId);
assert.ok(grant.form.title.startsWith("외부 공유 브라우저 QA")); assert.ok(decrypt<string>(grant.emailCipher).endsWith("@catchsecu.local.test"));
const phase = process.argv[2];
if (phase === "invite" || phase === "challenge") {
  assert.equal(env.MAIL_TRANSPORT, "local");
  const key = phase === "invite" ? `mail:share:${grant.id}:invite:${grant.version}` : `mail:share:${grant.id}:challenge:${fixture.challengeId}`;
  let job = await db.job.findUniqueOrThrow({ where: { dedupeKey: key } });
  for (let i=0; i<10 && job.status !== "done"; i++) { await new Promise(resolve => setTimeout(resolve, 1000)); job=await db.job.findUniqueOrThrow({ where: { id: job.id } }); }
  assert.equal(job.status, "done", "local worker must actually deliver the mail");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8"));
  const code = phase === "invite" ? mail.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)?.[1] : mail.text.match(/인증코드: (\d{6})/)?.[1];
  assert.ok(code);
  await writeFile(resolve(".local/sharing-current-mail.json"), JSON.stringify({ code, email: mail.to, formId: grant.formId }), { mode: 0o600 });
  await writeFile(resolve(directory, `mail-${phase}-v${grant.version}.json`), JSON.stringify({ phase, jobId: job.id, status: job.status, attempts: job.attempts, deliveredAt: mail.deliveredAt, verifiedCodePresent: true }, null, 2));
  console.log({ phase, delivered: true, grantVersion: grant.version });
} else if (phase === "final") {
  const data = await readFile(resolve(directory, "browser-attachment.txt"));
  const file = await db.fileObject.findUniqueOrThrow({ where: { id: fixture.fileId } });
  assert.equal(data.length, fixture.fileSize); assert.equal(createHash("sha256").update(data).digest("hex"), fixture.fileSha256);
  assert.equal(file.sha256, fixture.fileSha256); assert.equal(file.scanStatus, "clean"); assert.equal(file.status, "attached");
  assert.ok(grant.revokedAt); assert.ok(grant.sessions.length >= 2); assert.ok(grant.sessions.every(s => !!s.revokedAt));
  const logs = await db.auditEvent.findMany({ where: { resource: "shareGrant", resourceId: grant.id }, orderBy: { createdAt: "asc" } });
  for (const action of ["share.created", "share.authenticated", "share.responses_viewed", "share.file_downloaded", "share.updated", "share.revoked"])
    assert.ok(logs.some(event => event.action === action), action);
  assert.ok(!JSON.stringify(logs).includes(fixture.email));
  assert.ok(!JSON.stringify(logs).includes("외부 열람 합성 응답자"));
  assert.ok(!grant.emailCipher.includes(fixture.email));
  const report = { checkedAt: new Date().toISOString(), grantId: grant.id, grantVersion: grant.version, revoked: true,
    invalidatedSessions: grant.sessions.length, fileBytes: data.length, fileSha256: file.sha256, fileScanEngine: file.scanEngine,
    selectedFields: grant.fields.map(f => f.question.stableKey), auditActions: logs.map(event => event.action), result: "PASS" };
  await writeFile(resolve(directory, "final-verification.json"), JSON.stringify(report, null, 2)); console.log({ phase, result: "PASS", invalidatedSessions: grant.sessions.length, fileBytes: data.length });
} else throw Error("Supported phases: invite, challenge, final");
await db.$disconnect();
