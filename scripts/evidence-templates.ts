import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { contentDto, versionInclude } from "../src/server/forms";
assert.equal(new URL(env.DATABASE_URL).pathname, "/catchsecu_dev");
const dir = "docs/qa/templates";
const ids = JSON.parse(await readFile(dir + "/browser-ids.json", "utf8"));
const form = await db.form.findUniqueOrThrow({ where: { id: ids.formId }, include: { versions: { include: versionInclude } } });
const content = contentDto(form.versions[0]);
assert.equal(form.title, "브라우저 재사용 템플릿"); assert.equal(content.questions.length, 2);
assert.deepEqual(content.questions.map(question => question.label), ["신청자 이름 (수정)", "교육 과정"]);
assert.deepEqual(content.questions[1].options, ["기초 과정", "실무 과정"]);
assert.equal(content.retentionDays, 60); assert.equal(content.maxResponses, 7); assert.equal(content.consentPurpose, "교육 참가 신청 접수");
if (process.argv.includes("--before-delete")) {
  const template = await db.formTemplate.findUniqueOrThrow({ where: { id: ids.templateId } });
  assert.equal(template.version, 2);
  const original = template.content as { questions: { id: string }[] };
  for (const question of content.questions) assert(!original.questions.some(item => item.id === question.id));
  await writeFile(dir + "/copy-before-delete.json", JSON.stringify({ checkedAt: new Date().toISOString(), ...ids, content, originalQuestionIds: original.questions.map(item => item.id) }, null, 2));
  console.log("Full template content and distinct question identities verified in PostgreSQL.");
} else {
  assert.equal(await db.formTemplate.findUnique({ where: { id: ids.templateId } }), null);
  const before = JSON.parse(await readFile(dir + "/copy-before-delete.json", "utf8")); assert.deepEqual(content, before.content);
  const events = await db.auditEvent.findMany({ where: { resourceId: ids.templateId }, orderBy: { createdAt: "asc" }, select: { action: true } });
  for (const action of ["template.created", "template.updated", "template.used", "template.deleted"]) assert(events.some(item => item.action === action));
  await writeFile(dir + "/database-evidence.json", JSON.stringify({ checkedAt: new Date().toISOString(), ...ids, templateDeleted: true,
    copiedFormPreserved: true, distinctQuestionIds: true, questionCount: 2, retentionDays: content.retentionDays, maxResponses: content.maxResponses,
    auditActions: events.map(item => item.action) }, null, 2));
  console.log("Template CRUD and preservation of the copied form verified in PostgreSQL.");
}
await db.$disconnect();
