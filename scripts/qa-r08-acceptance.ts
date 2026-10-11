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
const directory = "docs/qa/R08-T04/current";
const tenantId = "10000000-0000-4000-8000-000000000001";

try {
  const [forms, versions, questions, templates, displays, audits] = await Promise.all([
    db.form.findMany({ where: { tenantId },
      select: { id: true, serviceId: true, title: true, status: true, version: true, publishedVersionId: true, ownerId: true },
      orderBy: { id: "asc" } }),
    db.formVersion.findMany({ where: { tenantId, form: { service: { tenantId } } },
      select: { id: true, formId: true, number: true, status: true, consentItemSchemaVersion: true },
      orderBy: { id: "asc" } }),
    db.question.findMany({ where: { tenantId },
      select: { id: true, formVersionId: true, type: true, required: true, catchFormPersonalInformationRequests: true },
      orderBy: { id: "asc" } }),
    db.formTemplate.findMany({ where: { tenantId },
      select: { id: true, serviceId: true, title: true, status: true, version: true },
      orderBy: { id: "asc" } }),
    db.serviceConsentDisplay.findMany({ where: { tenantId },
      select: { id: true, serviceId: true, kind: true, version: true, nameMode: true, policyMode: true, publicationId: true },
      orderBy: { id: "asc" } }),
    db.auditEvent.findMany({ where: { tenantId, OR: [{ resource: "form" }, { resource: "formTemplate" }, { resource: "service" }] },
      select: { id: true, action: true, resource: true, resourceId: true },
      orderBy: { id: "asc" } }),
  ]);
  const state = {
    ownedScope: "QA tenant A: forms/versions/questions(분류 포함)/templates/consent displays + form·template·service audits",
    counts: {
      forms: forms.length,
      versions: versions.length,
      questions: questions.length,
      classifiedQuestions: questions.filter(question => question.catchFormPersonalInformationRequests !== null).length,
      nlpClassified: questions.filter(question => JSON.stringify(question.catchFormPersonalInformationRequests).includes('"NLP"')).length,
      templates: templates.length,
      templatesByStatus: Object.fromEntries([...templates.reduce((m, t) => m.set(t.status, (m.get(t.status) ?? 0) + 1), new Map<string, number>())].sort()),
      displays: displays.length,
      audits: audits.length,
      auditsByAction: Object.fromEntries([...audits.reduce((m, a) => m.set(a.action, (m.get(a.action) ?? 0) + 1), new Map<string, number>())].sort()),
    },
    forms, versions, templates, displays, audits,
    questions: questions.map(question => ({ ...question, catchFormPersonalInformationRequests: question.catchFormPersonalInformationRequests ?? null })),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(state)).digest("hex");
  if (mode === "restart") {
    const before = JSON.parse(await readFile(`${directory}/acceptance-database-before.json`, "utf8"));
    assert.equal(fingerprint, before.fingerprint, "database fingerprint changed across restart");
  }
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/acceptance-database-${mode === "before" ? "before" : "restart"}.json`,
    JSON.stringify({ result: "passed", checkedAt: new Date().toISOString(), mode, fingerprint, ...state }, null, 2) + "\n");
  console.log({ result: "passed", mode, fingerprint, ...state.counts });
} finally { await db.$disconnect(); }
