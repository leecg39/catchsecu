/** Read-only assertions for the fixed localhost synthetic Ego scenario. Never uses production accounts. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { sha256 } from "../src/server/file-validation";
import { renderMessageContent } from "../src/server/message-content";
import type { MessageContent } from "../src/contracts/message-content";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const scope = { tenantId: "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc", serviceId: "08e5858c-6d69-451d-b509-7facf4e1867f" }, directory = resolve("docs/qa/email-content");
const filename = resolve(directory, "browser-fixture.json"), fixture: Record<string, string> = JSON.parse(await readFile(filename, "utf8").catch(() => "{}")), mode = process.argv[2];
async function save(name: string, value: object) { await writeFile(resolve(directory, name + ".json"), JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), ...value }, null, 2)); }
async function campaign(part: string) {
  const rows = await db.campaign.findMany({ where: { ...scope, title: "이메일 내용 QA " + part + " 2026-10-03" } }); assert.equal(rows.length, 1); return rows[0];
}
if (mode === "template") {
  const rows = await db.messageTemplate.findMany({ where: { ...scope, name: "이메일 내용 QA 템플릿 2026-10-03" } }); assert.equal(rows.length, 1); const row = rows[0];
  assert.equal(row.status, "active"); assert.equal(row.version, 4); fixture.templateId = row.id;
  const revisions = await db.messageTemplateRevision.findMany({ where: { templateId: row.id }, orderBy: { version: "asc" } });
  assert.deepEqual(revisions.map(r => r.kind), ["created", "updated", "archived", "restored"]);
  const first = decrypt<MessageContent>(revisions[0].contentCipher!), current = decrypt<MessageContent>(row.contentCipher!); assert.equal(first.format, "html"); assert.equal(current.format, "html");
  if (first.format === "html" && current.format === "html") { assert.ok(!/<script|<img|onclick=|style=/.test(first.html)); assert.ok(current.html.includes("수정한 HTML")); assert.notEqual(first.html, current.html); }
  await save("template-crud", { templateId: row.id, version: row.version, revisionKinds: revisions.map(r => r.kind), sanitized: true, historicalVersionPreserved: true });
} else if (mode === "sent") {
  const row = await campaign("발송"); fixture.campaignId = row.id; assert.equal(row.status, "completed"); assert.equal(row.messageTemplateId, fixture.templateId); assert.equal(row.messageTemplateVersion, 4); assert.equal(row.mailProtocol, "mail.campaign.v2");
  const delivery = await db.campaignDelivery.findFirstOrThrow({ where: { campaignId: row.id } }); assert.equal(delivery.status, "local_delivered");
  const job = await db.job.findFirstOrThrow({ where: { campaignDeliveryId: delivery.id } }); assert.equal(job.status, "done");
  const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8")), original = await readFile(".local/email-content-attachment.txt");
  assert.equal(mail.to, "subject-csv-qa-20261003@catchsecu.local.test"); assert.equal(mail.from.address, "campaign-qa@catchsecu-campaign-qa-20261003.test");
  const rendered = renderMessageContent(decrypt<MessageContent>(row.contentCipher!), decrypt<{ name: string; contact: string }>(delivery.contactCipher!));
  assert.ok(rendered?.format === "html"); assert.equal(mail.html, rendered.html); assert.equal(mail.text, rendered.text); assert.equal(mail.subject, rendered.subject);
  assert.equal(mail.attachments.length, 1); assert.equal(mail.attachments[0].sha256, sha256(original)); assert.deepEqual(Buffer.from(mail.attachments[0].contentBase64, "base64"), original);
  const file = await db.fileObject.findFirstOrThrow({ where: { campaignId: row.id, status: "attached" } }); fixture.fileId = file.id;
  assert.equal(file.scanStatus, "clean"); assert.match(file.scanEngine!, /^ClamAV /); assert.deepEqual(await privateFiles.read(file.storageKey), original);
  const downloaded = await readFile(resolve(directory, "downloads/email-content-attachment.txt")); assert.deepEqual(downloaded, original);
  const audits = await db.auditEvent.findMany({ where: { resourceId: row.id } }); assert.ok(!JSON.stringify(audits).includes(mail.to)); assert.ok(!JSON.stringify(audits).includes(mail.html));
  await save("actual-html-attachment", { campaignId: row.id, templateVersion: row.messageTemplateVersion, deliveryId: delivery.id, jobId: job.id, protocol: job.type, status: row.status, scanner: file.scanEngine, size: original.length, sha256: sha256(original), htmlAndFallbackMatch: true, downloadedBytesMatch: true, attachmentBytesMatch: true, recipientAndFromMatch: true, auditHasNoMessageOrContact: true });
} else if (mode === "template-deleted") {
  const row = await db.messageTemplate.findUniqueOrThrow({ where: { id: fixture.templateId } }); assert.equal(row.status, "deleted"); assert.equal(row.contentCipher, null); assert.equal(row.name, "");
  assert.equal(await db.messageTemplateRevision.count({ where: { templateId: row.id, OR: [{ contentCipher: { not: null } }, { name: { not: "" } }] } }), 0);
  const copied = await db.campaign.findUniqueOrThrow({ where: { id: fixture.campaignId } }); assert.ok(copied.contentCipher); assert.equal(copied.messageTemplateVersion, 4);
  await save("template-erasure", { templateId: row.id, version: row.version, originalAndRevisionsErased: true, copiedCampaignRetained: true });
} else if (mode === "cleanup-draft") {
  const row = await campaign("정리"); fixture.cleanupId = row.id;
  await save("cleanup-draft", { id: row.id, version: row.version, status: row.status });
} else if (mode === "cleanup") {
  const row = await db.campaign.findUniqueOrThrow({ where: { id: fixture.cleanupId } }); assert.equal(row.status, "deleted"); assert.equal(row.contentCipher, null);
  const files = await db.fileObject.findMany({ where: { campaignId: row.id } }); assert.equal(files.length, 2);
  for (const file of files) { assert.equal(file.status, "deleted"); assert.equal(file.nameCipher, null); await assert.rejects(privateFiles.read(file.storageKey)); }
  await save("attachment-erasure", { campaignId: row.id, files: files.map(f => ({ id: f.id, status: f.status })), actualBytesRemoved: true });
} else if (mode === "restart") {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: fixture.campaignId } }); assert.equal(campaign.status, "completed"); assert.equal(campaign.messageTemplateVersion, 4);
  const file = await db.fileObject.findUniqueOrThrow({ where: { id: fixture.fileId } }); const bytes = await privateFiles.read(file.storageKey); assert.equal(sha256(bytes), file.sha256);
  const template = await db.messageTemplate.findUniqueOrThrow({ where: { id: fixture.templateId } }); assert.equal(template.status, "deleted");
  await save("restart-persistence", { campaignId: campaign.id, status: campaign.status, templateStatus: template.status, attachmentHashUnchanged: true, fileId: file.id });
} else throw new Error("Unknown QA phase");
await writeFile(filename, JSON.stringify(fixture, null, 2)); await db.$disconnect(); console.info("합성 이메일 내용 검증 완료:", mode);
