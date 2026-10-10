import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const output = "docs/qa/R10-T03/catalog-flow";
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
const browser = JSON.parse(await readFile(output + "/browser.json", "utf8"));
assert.ok(fixture.owner.email.startsWith("rea-owner-"));
try {
  const purpose = await db.processingPurpose.findUniqueOrThrow({ where: { id: browser.purpose.id }, include: { revisions: { orderBy: { version: "asc" } }, recipients: true } });
  const recipient = await db.recipient.findUniqueOrThrow({ where: { id: browser.recipient.id }, include: { revisions: { orderBy: { version: "asc" } } } });
  for (const [row, ui] of [[purpose, browser.purpose], [recipient, browser.recipient]] as const) {
    assert.equal(row.tenantId, fixture.owner.companyId); assert.equal(row.serviceId, fixture.owner.serviceId);
    assert.equal(row.status, "active"); assert.equal(row.version, ui.version); assert.equal(row.retentionDays, ui.retentionDays);
    assert.equal(row.revisions.length, row.version);
    assert.deepEqual(row.revisions.map(item => item.version), Array.from({ length: row.version }, (_, i) => i + 1));
  }
  assert.equal(purpose.version, 4); assert.equal(purpose.retentionDays, 120);
  assert.equal(recipient.version, 6); assert.equal(recipient.retentionDays, 90); assert.equal(recipient.kind, "processor");
  assert.equal(purpose.recipients.length, 1); assert.equal(purpose.recipients[0].recipientId, recipient.id);
  const original = purpose.revisions[0].snapshot as { retentionDays: number; recipients: { id: string; version: number; retentionDays: number }[] };
  assert.equal(original.retentionDays, 30); assert.equal(original.recipients[0].id, recipient.id);
  assert.equal(original.recipients[0].version, 4); assert.equal(original.recipients[0].retentionDays, 90);
  const events = await db.auditEvent.findMany({ where: { tenantId: fixture.owner.companyId, resourceId: { in: [purpose.id, recipient.id] } }, orderBy: { createdAt: "asc" } });
  assert.equal(events.length, purpose.version + recipient.version);
  for (const id of [purpose.id, recipient.id]) {
    assert.equal(events.filter(event => event.resourceId === id && event.action === "catalog.created").length, 1);
    assert.equal(events.filter(event => event.resourceId === id && event.action === "catalog.archived").length, 1);
    assert.equal(events.filter(event => event.resourceId === id && event.action === "catalog.restored").length, 1);
  }
  const stateHash = createHash("sha256").update(JSON.stringify({ purpose, recipient, events })).digest("hex");
  const report = { checkedAt: new Date().toISOString(), result: "passed", readOnly: true, purposeId: purpose.id, recipientId: recipient.id,
    versions: { purpose: purpose.version, recipient: recipient.version }, revisions: { purpose: purpose.revisions.length, recipient: recipient.revisions.length },
    persistedRelation: true, initialSnapshotUnchanged: true, rejectedWritesCreatedNoRevisionOrAudit: true, auditEvents: events.length, stateHash };
  const restart = process.argv.includes("--after-restart");
  if (restart) {
    const previous = JSON.parse(await readFile(output + "/db.json", "utf8"));
    assert.equal(stateHash, previous.stateHash, "Restart changed catalog business state");
  }
  await writeFile(output + (restart ? "/db-after-restart.json" : "/db.json"), JSON.stringify({ ...report, restartVerified: restart }, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
