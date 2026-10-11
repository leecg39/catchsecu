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
const directory = "docs/qa/R09-T04/current";

const urlFixture = JSON.parse(await readFile(".local/rea-fullstack/r09-list.json", "utf8")) as {
  tenantId: string; serviceId: string; formId: string; ids: string[];
};
const approvalFixture = JSON.parse(await readFile(".local/rea-fullstack/r09-approval-list.json", "utf8")) as {
  tenantId: string; serviceId: string; entries: { formId: string; approvalId: string }[];
};

try {
  const tenants = [urlFixture.tenantId, approvalFixture.tenantId];
  const formIds = [urlFixture.formId, ...approvalFixture.entries.map(e => e.formId)];
  const approvalIds = approvalFixture.entries.map(e => e.approvalId);
  const [forms, approvals, publications, fixedUrls, audits] = await Promise.all([
    db.form.findMany({ where: { tenantId: { in: tenants } },
      select: { id: true, tenantId: true, status: true, version: true, publishedVersionId: true, serviceId: true },
      orderBy: { id: "asc" } }),
    db.approvalRequest.findMany({ where: { tenantId: approvalFixture.tenantId },
      select: { id: true, formId: true, status: true, version: true, contentHash: true, policyRevision: true, decidedBy: true, formVersionId: true },
      orderBy: { id: "asc" } }),
    db.publication.findMany({ where: { tenantId: { in: tenants } },
      select: { id: true, formId: true, formVersionId: true, approvalId: true, status: true, version: true },
      orderBy: { id: "asc" } }),
    db.fixedUrl.findMany({ where: { tenantId: urlFixture.tenantId },
      select: { id: true, name: true, slug: true, status: true, version: true, publicationId: true },
      orderBy: { id: "asc" } }),
    db.auditEvent.findMany({ where: { tenantId: { in: tenants }, resourceId: { in: [...formIds, ...approvalIds] } },
      select: { id: true, resourceId: true, action: true },
      orderBy: { id: "asc" } }),
  ]);
  const state = {
    ownedScope: "R09 fixtures only: 2 tenants' forms/approvals/publications/fixed URLs + their business audits",
    counts: {
      forms: forms.length,
      approvals: approvals.length,
      approvalsByStatus: Object.fromEntries([...approvals.reduce((m, a) => m.set(a.status, (m.get(a.status) ?? 0) + 1), new Map<string, number>())].sort()),
      publications: publications.length,
      publicationsByStatus: Object.fromEntries([...publications.reduce((m, p) => m.set(p.status, (m.get(p.status) ?? 0) + 1), new Map<string, number>())].sort()),
      fixedUrls: fixedUrls.length,
      fixedUrlsByStatus: Object.fromEntries([...fixedUrls.reduce((m, u) => m.set(u.status, (m.get(u.status) ?? 0) + 1), new Map<string, number>())].sort()),
      audits: audits.length,
    },
    forms, approvals, publications, fixedUrls, audits,
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(state)).digest("hex");
  if (mode === "restart") {
    const before = JSON.parse(await readFile(`${directory}/acceptance-database-before.json`, "utf8"));
    assert.equal(fingerprint, before.fingerprint, "database fingerprint changed across restart");
  }
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/acceptance-database-${mode}.json`, JSON.stringify({
    result: "passed", checkedAt: new Date().toISOString(), mode, fingerprint, ...state,
  }, null, 2) + "\n");
  console.log({ result: "passed", mode, fingerprint, ...state.counts });
} finally {
  await db.$disconnect();
}
