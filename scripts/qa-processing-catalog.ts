import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import type { PurposeRecord } from "../src/contracts/processing-catalog";

const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const stage = process.argv[2];
const stages = {
  created: { purpose: 1, recipient: 1, status: "active" },
  updated: { purpose: 2, recipient: 2, status: "active" },
  archived: { purpose: 3, recipient: 3, status: "archived" },
  restored: { purpose: 4, recipient: 4, status: "active" },
  final: { purpose: 5, recipient: 4, status: "active" },
};
const expected = stages[stage as keyof typeof stages];
assert.ok(expected, "Choose created, updated, archived, restored or final.");
try {
  const tenantId = "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc";
  const purpose = await db.processingPurpose.findFirstOrThrow({ where: { tenantId, name: "브라우저 QA 상담 수집 목적 2026-10-02" },
    include: { revisions: { orderBy: { version: "asc" } }, recipients: true } });
  const recipient = await db.recipient.findFirstOrThrow({ where: { tenantId, name: "브라우저 QA 국외 수탁자 2026-10-02" }, include: { revisions: true } });
  assert.equal(purpose.version, expected.purpose); assert.equal(recipient.version, expected.recipient);
  assert.equal(purpose.status, expected.status); assert.equal(recipient.status, expected.status);
  assert.equal(purpose.revisions.length, expected.purpose); assert.equal(recipient.revisions.length, expected.recipient);
  assert.equal(purpose.serviceId, recipient.serviceId); assert.equal(purpose.recipients.length, 1); assert.equal(purpose.recipients[0].recipientId, recipient.id);
  const first = purpose.revisions[0].snapshot as unknown as PurposeRecord;
  assert.equal(first.retentionMode, "until_purpose"); assert.equal(first.retentionReason, "상담 종료와 답변 전달이 끝난 때");
  assert.equal(first.recipients[0].version, 1); assert.equal(first.recipients[0].purpose, "상담 접수 알림 전달");
  assert.deepEqual(first.items, [{ name: "이름", kind: "general", required: true }, { name: "이메일", kind: "general", required: false }]);
  if (expected.purpose >= 2) {
    const second = purpose.revisions[1].snapshot as unknown as PurposeRecord;
    assert.equal(second.retentionDays, 45); assert.equal(second.retentionMode, "days");
    assert.equal(second.recipients[0].version, 2); assert.equal(second.recipients[0].purpose, "상담 접수 및 변경 알림 전달");
  }
  if (stage === "final") { assert.equal(purpose.retentionMode, "statutory"); assert.equal(purpose.retentionDays, null); assert.equal(purpose.retentionReason, "시험 계약의 분쟁 처리 종료 시 검토"); }
  const events = await db.auditEvent.findMany({ where: { tenantId, resourceId: { in: [purpose.id, recipient.id] } }, orderBy: { createdAt: "asc" } });
  assert.equal(events.length, expected.purpose + expected.recipient);
  let pagination: { total: number; archived: number; revisions: number } | undefined;
  if (stage === "final") {
    const rows = await db.processingPurpose.findMany({ where: { tenantId, name: { startsWith: "페이지 QA 2026-10-02 " } }, include: { _count: { select: { revisions: true } } } });
    assert.equal(rows.length, 11); assert.ok(rows.every(row => row.status === "archived" && row.version === 2 && row._count.revisions === 2));
    pagination = { total: rows.length, archived: rows.length, revisions: rows.reduce((sum, row) => sum + row._count.revisions, 0) };
  }
  const evidence = { checkedAt: new Date().toISOString(), stage, scope: "localhost catchsecu_dev synthetic browser fixtures",
    purpose: { id: purpose.id, serviceId: purpose.serviceId, name: purpose.name, version: purpose.version, status: purpose.status,
      retentionMode: purpose.retentionMode, retentionDays: purpose.retentionDays, retentionReason: purpose.retentionReason, items: purpose.items },
    recipient: { id: recipient.id, version: recipient.version, status: recipient.status, countryCode: recipient.countryCode, kind: recipient.kind, purpose: recipient.purpose },
    revisions: purpose.revisions.map(row => { const snapshot = row.snapshot as unknown as PurposeRecord; return { version: row.version,
      status: snapshot.status, retentionMode: snapshot.retentionMode, retentionDays: snapshot.retentionDays,
      linkedRecipientVersion: snapshot.recipients[0].version, linkedRecipientPurpose: snapshot.recipients[0].purpose }; }),
    pagination, auditActions: events.map(event => event.action), checks: { serviceAndTenantBinding: true, linkedRecipient: true, allVersionsPersisted: true,
      originalSnapshotPreserved: true, optionalFieldPreserved: true, auditedEveryWrite: true } };
  await writeFile("docs/qa/processing-catalog/database-" + stage + ".json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ stage, purposeVersion: purpose.version, recipientVersion: recipient.version, auditEvents: events.length, passed: true }));
} finally { await db.$disconnect(); }
