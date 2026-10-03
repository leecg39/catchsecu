/** Assertions and private OTP preparation for the existing local synthetic Ego scenario. */
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const scope = { tenantId: "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc", serviceId: "08e5858c-6d69-451d-b509-7facf4e1867f" };
const recipient = "subject-csv-qa-20261003@catchsecu.local.test", address = "campaign-qa@catchsecu-campaign-qa-20261003.test";
const dir = resolve("docs/qa/campaigns"), fixturePath = resolve(dir, "browser-fixture.json"), phase = process.argv[2];
const fixture: Record<string, string> = JSON.parse(await readFile(fixturePath, "utf8").catch(() => "{}"));
async function save(name: string, data: object) { await writeFile(resolve(dir, name + ".json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), ...data }, null, 2)); }
async function campaign(part: string) {
  const row = await db.campaign.findFirstOrThrow({ where: { ...scope, title: "캠페인 브라우저 QA " + part + " 2026-10-03" } });
  fixture[part] = row.id; return row;
}
if (phase === "prepare") {
  await writeFile(".local/campaign-targets.csv", "email\r\n" + recipient + "\r\n" + recipient.toUpperCase() + "\r\ninvalid-address\r\nunknown@catchsecu.local.test", { mode: 0o600 });
} else if (phase === "code") {
  const sender = await db.sender.findFirstOrThrow({ where: { ...scope, label: "발신자 브라우저 QA 캠페인 2026-10-03", status: { not: "deleted" } } });
  fixture.senderId = sender.id; assert.equal(decrypt(sender.addressCipher!), address);
  const proof = await db.senderVerification.findFirstOrThrow({ where: { senderId: sender.id, method: "email", status: "pending" }, orderBy: { createdAt: "desc" } });
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sender-verification:" + proof.id } }); assert.equal(job.status, "done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")); assert.equal(mail.to, address);
  const code = /인증번호: (\d{6})/.exec(mail.text)?.[1]; assert.ok(code); await writeFile(".local/campaign-code", code, { mode: 0o600 });
  await save("sender-authentication", { senderId: sender.id, jobId: job.id, actualLocalCode: true, secretExcluded: true });
} else if (phase === "sent") {
  const row = await campaign("실제 전달"); assert.equal(row.status, "partial_failed"); assert.ok(row.archivedAt);
  const recipients = await db.campaignDelivery.findMany({ where: { campaignId: row.id }, orderBy: { position: "asc" } });
  assert.deepEqual(recipients.map(r => r.status), ["local_delivered", "excluded", "excluded"]);
  const job = await db.job.findFirstOrThrow({ where: { campaignDeliveryId: recipients[0].id } }); assert.equal(job.status, "done"); assert.equal(job.type, "mail.campaign.v1");
  const sender = await db.sender.findUniqueOrThrow({ where: { id: fixture.senderId } }), mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8"));
  assert.equal(mail.to, recipient); assert.deepEqual(mail.from, { name: sender.label, address }); assert.ok(mail.text.includes(recipient)); assert.ok(!mail.text.includes("{{"));
  assert.equal(decrypt<{ text: string }>(row.contentCipher!).text, "{{name}} 님, 수정한 캠페인 안내입니다. 연락처: {{contact}}");
  await save("actual-local-delivery", { campaignId: row.id, jobId: job.id, status: row.status, archived: true, persistedEditedText: true, duplicateRemoved: true, recipientResults: recipients.map(r => ({ status: r.status, reason: r.reason })), actualRecipientAndFromMatch: true, variablesRendered: true, externalSmtpTested: false });
} else if (phase === "reserved" || phase === "cancelled") {
  const row = await campaign("예약 취소"), job = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: row.id } } });
  assert.equal(row.status, phase === "reserved" ? "scheduled" : "cancelled"); assert.equal(job.status, phase === "reserved" ? "queued" : "cancelled");
  if (phase === "reserved") { assert.ok(row.scheduledAt! > new Date()); assert.equal(job.dueAt.toISOString(), row.scheduledAt!.toISOString()); }
  await assert.rejects(access(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")));
  await save(phase, { campaignId: row.id, jobId: job.id, campaignStatus: row.status, jobStatus: job.status, scheduledAt: row.scheduledAt, noLocalMailFile: true });
} else if (phase === "draft") {
  const row = await campaign("삭제 초안"); assert.equal(row.status, "draft"); await save("draft-before-delete", { id: row.id, version: row.version });
} else if (phase === "deleted") {
  const row = await db.campaign.findUniqueOrThrow({ where: { id: fixture["삭제 초안"] } }); assert.equal(row.status, "deleted"); assert.equal(row.contentCipher, null); assert.equal(await db.campaignDelivery.count({ where: { campaignId: row.id } }), 0);
  await save("draft-deleted", { id: row.id, status: row.status, contentErased: true, recipientsRemoved: true });
} else if (phase === "sources") {
  const row = await campaign("폼 선택"), targets = await db.campaignDelivery.findMany({ where: { campaignId: row.id } });
  assert.equal(row.source, "form"); assert.equal(targets.length, 1); assert.ok(targets[0].sourceSubmissionId); assert.equal(decrypt<{ contact: string }>(targets[0].contactCipher!).contact, recipient);
  const sms = await campaign("문자"); assert.equal(sms.channel, "sms"); assert.equal(sms.status, "draft"); assert.equal(await db.job.count({ where: { campaignDelivery: { campaignId: sms.id } } }), 0);
  const smsForm = await campaign("문자 폼"), selected = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: smsForm.id }, include: { preference: true } });
  assert.equal(smsForm.source, "form"); assert.equal(smsForm.status, "draft"); assert.equal(selected.preference?.status, "withdrawn"); assert.equal(await db.job.count({ where: { campaignDelivery: { campaignId: smsForm.id } } }), 0);
  await save("sources-and-sms", { formCampaignId: row.id, explicitSelectedTargets: 1, sameServiceConsent: true, smsCampaignId: sms.id, smsDraftPersists: true, smsNoFakeDelivery: true, smsFormCampaignId: smsForm.id, withdrawnSourcePreserved: true });
} else if (phase === "csv") {
  const bytes = await readFile(resolve(dir, "downloads/campaign-recipients.csv")); assert.equal(bytes.subarray(0,3).toString("hex"), "efbbbf");
  const { parse } = await import("csv-parse/sync"), rows: string[][] = parse(bytes, { bom: true }); assert.equal(rows.length, 4);
  assert.equal(rows[1][2], recipient); assert.equal(rows[1][3], "로컬 메일함 전달"); assert.deepEqual(rows.slice(2).map(r => r[3]), ["발송 제외", "발송 제외"]);
  await save("csv-download", { browserDownload: true, utf8Bom: true, rows: 3, actualStatusMatches: true, bytes: bytes.length });
} else if (phase === "fail-delivery") {
  const row = await campaign("재처리"), job = await db.job.findFirstOrThrow({ where: { campaignDelivery: { campaignId: row.id } } });
  assert.equal(row.status, "scheduled"); assert.equal(job.status, "queued");
  const due = await db.job.findMany({ where: { status: { in: ["queued", "retry", "leased"] }, dueAt: { lte: new Date() } }, select: { id: true } });
  assert.deepEqual(due.map(j => j.id), [job.id]); // Stop the ordinary local worker before this isolated injection.
  await db.job.update({ where: { id: job.id }, data: { maxAttempts: 1 } }); const previous = env.LOCAL_MAIL_DIR;
  try { env.LOCAL_MAIL_DIR = "/dev/null/campaign-qa-failure"; assert.equal(await runOneJob("campaign-browser-failure"), true); } finally { env.LOCAL_MAIL_DIR = previous; }
  const current = await db.job.findUniqueOrThrow({ where: { id: job.id } }); assert.equal(current.status, "dead");
  assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: row.id } })).status, "failed");
  await save("storage-failure", { campaignId: row.id, jobId: job.id, actualFilesystemFailure: true, jobStatus: current.status, lastError: current.lastError, affectedOnlySyntheticJob: true });
} else if (phase === "retried") {
  const row = await campaign("재처리"); assert.equal(row.status, "completed");
  const target = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: row.id }, include: { jobs: { orderBy: { createdAt: "asc" } } } });
  assert.equal(target.attempt, 2); assert.deepEqual(target.jobs.map(j => j.status), ["dead", "done"]); assert.equal(target.status, "local_delivered");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, target.jobs[1].id + ".json"), "utf8")); assert.equal(mail.to, recipient); assert.equal(mail.from.address, address);
  await save("retried-delivery", { campaignId: row.id, deliveryId: target.id, attempts: 2, jobStatuses: target.jobs.map(j => j.status), actualLocalReceipt: true, recipientAndFromMatch: true });
} else if (phase === "restart") {
  const sent = await campaign("실제 전달"), cancelled = await campaign("예약 취소"), form = await campaign("폼 선택"), sms = await campaign("문자");
  assert.equal(sent.status, "partial_failed"); assert.ok(sent.archivedAt); assert.equal(cancelled.status, "cancelled"); assert.equal(form.status, "draft"); assert.equal(sms.status, "draft");
  const retried = await campaign("재처리"); assert.equal(retried.status, "completed");
  const rows = await db.campaign.findMany({ where: { id: { in: [sent.id, cancelled.id, form.id, sms.id, retried.id, fixture["삭제 초안"], fixture["문자 폼"]] } }, include: { events: { orderBy: { version: "asc" } } } });
  for (const row of rows) assert.deepEqual(row.events.map(e => e.version), Array.from({ length: row.version }, (_, i) => i + 1));
  const logs = JSON.stringify(await db.auditEvent.findMany({ where: { resource: "campaign", resourceId: { in: rows.map(r => r.id) } } })); assert.ok(!logs.includes(recipient)); assert.ok(!logs.includes("수정한 캠페인"));
  await save("restart-persistence", { campaigns: rows.map(r => ({ id: r.id, status: r.status, version: r.version })), eventContinuity: true, auditOmitsContactAndContent: true, database: "catchsecu_dev" });
} else throw new Error("Unknown QA phase");
await writeFile(fixturePath, JSON.stringify(fixture, null, 2)); await db.$disconnect(); console.info("캠페인 합성 QA 단계 통과:", phase);
