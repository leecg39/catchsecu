import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const fixture = JSON.parse(await readFile(".local/rea-fullstack/fixture.json", "utf8"));
assert.ok(fixture.owner.email.startsWith("rea-owner-"));
try {
  const form = await db.form.findUniqueOrThrow({ where: { id:fixture.formId }, include:{publishedVersion:true,publications:true} });
  assert.equal(form.tenantId,fixture.owner.companyId); assert.equal(form.status,"published");
  assert.equal(form.publishedVersion?.retentionDays,null); assert.equal(form.designatedRetentionDays,null);
  const rule = await db.retentionRule.findUniqueOrThrow({where:{id:fixture.ruleId}});
  const policy = await db.securityPolicy.findUniqueOrThrow({where:{tenantId:fixture.owner.companyId}});
  assert.equal(rule.retentionDays,120); assert.equal(rule.status,"active"); assert.equal(policy.retentionDays,365);
  const submissions = await db.submission.findMany({where:{tenantId:fixture.owner.companyId,formVersionId:form.publishedVersionId!},include:{answers:true,receipts:true}});
  assert.equal(submissions.length,1);
  const submission=submissions[0]; assert.equal(submission.status,"submitted");
  const days=(submission.retentionUntil.getTime()-submission.submittedAt.getTime())/86400000;
  assert.ok(Math.abs(days-120)<1/86400,"retention deadline must follow the service rule");
  assert.equal(submission.originalRetentionUntil.getTime(),submission.retentionUntil.getTime());
  const values=submission.answers.map(answer=>decrypt(answer.valueCipher));
  assert.ok(values.includes("REA 시험 응답자")); assert.ok(values.includes("rea-subject@catchsecu.test"));
  assert.ok(submission.subjectId); assert.equal(submission.receipts.length,1); assert.equal(submission.receipts[0].retentionDays,120);
  assert.equal(form.publications[0].responseCount,1);
  const report={checkedAt:new Date().toISOString(),result:"passed",formId:form.id,submissionId:submission.id,
    publishedVersion:form.publishedVersionId,formDays:null,serviceRuleDays:120,companyDays:365,
    storedDays:days,retentionUntil:submission.retentionUntil,answersEncrypted:true,decodedAnswersMatch:true,
    receiptDays:submission.receipts[0].retentionDays,subjectLinked:true,responseCount:form.publications[0].responseCount};
  await writeFile("docs/qa/R08-T04/browser-flow/db.json",JSON.stringify(report,null,2)+"\n");
  await writeFile(".local/rea-fullstack/fixture.json",JSON.stringify({...fixture,submissionId:submission.id},null,2)+"\n",{mode:0o600});
  console.log(JSON.stringify({result:"passed",storedDays:days,receiptDays:120,encryptedAnswerCount:values.length}));
} finally {await db.$disconnect();}
