import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { contentDto, fingerprint, versionInclude } from "../src/server/forms";

assert.equal(new URL(env.DATABASE_URL).pathname, "/catchsecu_dev");
const formId = "abc49595-6bae-4baa-8375-1d5fb6875fa4";
const form = await db.form.findUniqueOrThrow({ where: { id: formId } });
const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: form.tenantId } });
assert.equal(policy.requireApproval, true); assert.equal(policy.sessionMinutes, 45);
assert.deepEqual([...policy.approvalRoles].sort(), ["owner", "security"]);
const approvals = await db.approvalRequest.findMany({ where: { formId }, orderBy: { createdAt: "asc" },
  include: { requester: { include: { user: true } }, reviewer: { include: { user: true } } } });
assert.deepEqual(approvals.map(row => row.status), ["rejected", "cancelled", "consumed"]);
for (const row of approvals) {
  const message = decrypt<{ message: string; reference: string }>(row.requestCipher);
  assert(!row.requestCipher.includes(message.message)); assert(row.snapshot && typeof row.snapshot === "object");
  assert.equal(row.requester.user.email, "owner@catchsecu.local.test");
}
const approved = approvals[2];
assert.equal(approved.reviewer?.user.email, "security@catchsecu.local.test");
const publication = await db.publication.findFirstOrThrow({ where: { formId, status: "active" } });
assert.equal(publication.approvalId, approved.id); assert.equal(publication.formVersionId, approved.formVersionId);
const version = await db.formVersion.findUniqueOrThrow({ where: { id: publication.formVersionId }, include: versionInclude });
assert.equal(fingerprint(version), approved.contentHash);
assert.equal(version.status, "published"); assert.equal(form.status, "published");
assert.deepEqual(approved.snapshot, { title: version.title, content: contentDto(version) });
const submission = await db.submission.findFirstOrThrow({ where: { publicationId: publication.id }, include: { answers: true, receipts: true } });
const answerValues = submission.answers.map(answer => decrypt<string>(answer.valueCipher)).sort();
assert.deepEqual(answerValues, ["승인 브라우저 참가자", "실무 과정"].sort());
assert.equal(publication.responseCount, 1); assert.equal(submission.receipts.length, 1);
const events = await db.auditEvent.findMany({ where: { OR: [{ resourceId: { in: approvals.map(row => row.id) } }, { resourceId: formId, action: "form.published" }] },
  select: { action: true, resourceId: true, createdAt: true }, orderBy: { createdAt: "asc" } });
for (const action of ["approval.requested", "approval.rejected", "approval.cancelled", "approval.approved", "form.published"]) assert(events.some(event => event.action === action));
await writeFile("docs/qa/policy-approvals/database-evidence.json", JSON.stringify({
  checkedAt: new Date().toISOString(), formId, policy: { version: policy.version, approvalRevision: policy.approvalRevision, sessionMinutes: policy.sessionMinutes, requireApproval: policy.requireApproval },
  approvalStates: approvals.map(row => ({ id: row.id, status: row.status, version: row.version })),
  publicationId: publication.id, approvalId: publication.approvalId, immutableSnapshotMatches: true,
  requesterAndReviewerDiffer: true, submissionId: submission.id, responseCount: publication.responseCount,
  encryptedAnswersMatch: true, consentReceiptCount: submission.receipts.length, auditEvents: events,
}, null, 2));
console.log("Policy, request/reject/cancel/approve, publication snapshot and encrypted submission verified in PostgreSQL.");
await db.$disconnect();
