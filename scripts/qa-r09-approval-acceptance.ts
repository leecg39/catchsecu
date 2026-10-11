import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const mode = process.argv[2];
assert.ok(["before", "restart"].includes(mode));
const directory = "docs/qa/R09-T03/current";
const fixture = JSON.parse(await readFile(".local/rea-fullstack/r09-approval-list.json", "utf8")) as {
  tenantId: string; serviceId: string; entries: { formId: string; approvalId: string; desired: string }[];
};

try {
  const approvalIds = fixture.entries.map(entry => entry.approvalId);
  const formIds = fixture.entries.map(entry => entry.formId);
  const approvals = await db.approvalRequest.findMany({
    where: { id: { in: approvalIds }, tenantId: fixture.tenantId },
    select: {
      id: true, formId: true, formVersionId: true, status: true, version: true,
      contentHash: true, policyRevision: true, requestedBy: true, decidedBy: true,
    },
    orderBy: { id: "asc" },
  });
  const forms = await db.form.findMany({
    where: { id: { in: formIds }, tenantId: fixture.tenantId },
    select: { id: true, serviceId: true, status: true, version: true, publishedVersionId: true },
    orderBy: { id: "asc" },
  });
  const publications = await db.publication.findMany({
    where: { tenantId: fixture.tenantId, formId: { in: formIds } },
    select: { id: true, formId: true, formVersionId: true, approvalId: true, status: true, version: true, maxResponses: true, responseCount: true },
    orderBy: { id: "asc" },
  });
  const audits = await db.auditEvent.findMany({
    where: { tenantId: fixture.tenantId, resourceId: { in: [...approvalIds, ...formIds] } },
    select: { id: true, resourceId: true, resource: true, action: true },
    orderBy: { id: "asc" },
  });
  assert.equal(approvals.length, 12);
  assert.equal(forms.length, 12);
  assert.equal(publications.length, 3);
  for (const status of ["pending", "rejected", "approved", "consumed"])
    assert.equal(approvals.filter(row => row.status === status).length, 3);
  assert.ok(forms.every(row => row.serviceId === fixture.serviceId));
  assert.ok(publications.every(row => row.approvalId && approvals.some(approval => approval.id === row.approvalId)));
  const state = { approvals, forms, publications, audits };
  const fingerprint = createHash("sha256").update(JSON.stringify(state)).digest("hex");
  if (mode === "restart") {
    const before = JSON.parse(await readFile(`${directory}/approval-database-before.json`, "utf8"));
    assert.equal(fingerprint, before.fingerprint);
  }
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/approval-database-${mode}.json`, JSON.stringify({
    result: "passed", checkedAt: new Date().toISOString(), mode, fingerprint,
    fingerprintScope: "Only the owned R09 approval-list forms, approvals, publications and business audits",
    ...state,
  }, null, 2) + "\n");
  console.log({ result: "passed", mode, approvals: approvals.length, forms: forms.length, publications: publications.length, audits: audits.length, fingerprint });
} finally {
  await db.$disconnect();
}
