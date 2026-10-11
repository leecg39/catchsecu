import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const mode = process.argv[2]; assert.ok(["before", "after", "restart"].includes(mode));
const directory = "docs/qa/R08-T03/current";
const fixture = JSON.parse(await readFile(".local/rea-fullstack/r08-template-list.json", "utf8")) as { tenantId: string; serviceId: string; templateIds: string[]; formId: string };
try {
  const templates = await db.formTemplate.findMany({ where: { id: { in: fixture.templateIds } }, select: { id: true, tenantId: true, serviceId: true, title: true, status: true, version: true }, orderBy: { id: "asc" } });
  const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, select: { id: true, tenantId: true, serviceId: true, title: true, status: true, version: true, updatedAt: true } });
  const audits = await db.auditEvent.findMany({ where: { resourceId: { in: [...fixture.templateIds, fixture.formId] } }, select: { id: true, action: true, resourceId: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  assert.ok(templates.every(row => row.tenantId === fixture.tenantId && row.serviceId === fixture.serviceId));
  assert.equal(form.tenantId, fixture.tenantId); assert.equal(form.serviceId, fixture.serviceId); assert.equal(form.version, 1); assert.equal(form.status, "draft");
  const deletedIds = fixture.templateIds.filter(id => !templates.some(row => row.id === id));
  assert.equal(templates.length, mode === "before" ? 13 : 11);
  assert.equal(templates.filter(row => row.status === "archived").length, 1);
  if (mode !== "before") assert.deepEqual(deletedIds, fixture.templateIds.slice(0, 2));
  const deletedAudits = audits.filter(row => row.action === "template.deleted");
  assert.equal(deletedAudits.length, mode === "before" ? 0 : 2);
  if (mode !== "before") assert.deepEqual(deletedAudits.map(row => row.resourceId).sort(), deletedIds.toSorted());
  const state = { templates, form, audits }, fingerprint = createHash("sha256").update(JSON.stringify(state)).digest("hex");
  if (mode === "restart") {
    const previous = JSON.parse(await readFile(directory + "/list-after-database.json", "utf8"));
    assert.equal(fingerprint, previous.fingerprint);
  }
  const report = { at: new Date().toISOString(), result: "passed", mode, deletedIds, fingerprint, fingerprintScope: "Only the synthetic list templates/form and their audit events", ...state };
  await writeFile(directory + "/list-" + mode + "-database.json", JSON.stringify(report, null, 2) + "\n");
  console.log({ result: "passed", mode, templates: templates.length, deleted: deletedIds.length, formVersion: form.version, audits: audits.length, fingerprint });
} finally { await db.$disconnect(); }
