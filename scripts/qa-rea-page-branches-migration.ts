import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const suffix = randomUUID().replaceAll("-", "");
const freshSchema = `qa_page_branches_fresh_${suffix}`, upgradeSchema = `qa_page_branches_upgrade_${suffix}`;
const working = resolve(`.local/qa-page-branches-${suffix}`), evidence = "docs/qa/R08-T02/body-images/page-branches";
const prismaCli = resolve("node_modules/prisma/build/index.js");
const additions = [
  "20261025020000_form_page_branches", "20261025020100_form_page_branch_trigger_scope",
  "20261025020200_form_page_branch_lookup", "20261025020300_author_asset_trigger_scope",
  "20261025020400_submission_page_path_validator_fix", "20261025020500_submission_page_path_edges",
  "20261025020600_option_trigger_metadata_scope", "20261025020700_submission_ineligible_guard",
];
const logs: Record<string, string> = {};

async function project(directory: string, full: boolean) {
  await mkdir(directory, { recursive: true }); await cp("prisma", join(directory, "prisma"), { recursive: true });
  if (!full) for (const name of additions) await rm(join(directory, "prisma/migrations", name), { recursive: true, force: true });
  await writeFile(join(directory, "prisma.config.ts"),
    'import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: env("DATABASE_URL") } });\n');
}
async function migrate(schema: string, directory: string, label: string) {
  const scoped = new URL(url); scoped.searchParams.set("schema", schema);
  const result = await new Promise<{ code: number; output: string }>((done, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: directory, env: { ...process.env, DATABASE_URL: scoped.href } });
    let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    child.once("error", reject); child.once("close", code => done({ code: code ?? 1, output }));
  });
  logs[label] = result.output.replaceAll(scoped.href, "[isolated test database URL]");
  assert.equal(result.code, 0, `${label} migration failed`);
}
async function client(schema: string) {
  const result = new Client({ connectionString: url.href }); await result.connect(); await result.query(`SET search_path TO "${schema}"`); return result;
}
async function migrationCount(connection: Client) {
  return Number((await connection.query('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count);
}

const root = new Client({ connectionString: url.href });
try {
  await mkdir(evidence, { recursive: true }); await mkdir(working, { recursive: true }); await root.connect();
  await root.query(`CREATE SCHEMA "${freshSchema}"`); await root.query(`CREATE SCHEMA "${upgradeSchema}"`);
  const freshProject = join(working, "fresh"); await project(freshProject, true); await migrate(freshSchema, freshProject, "fresh");
  const fresh = await client(freshSchema); assert.equal(await migrationCount(fresh), 137);
  const columns = (await fresh.query(`SELECT table_name,column_name,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema=$1 AND ((table_name='QuestionOption' AND column_name IN ('branchDestinationKind','branchDestinationSectionId'))
      OR (table_name='Submission' AND column_name IN ('pagePathVersion','visitedPageKeys','terminationKind'))) ORDER BY table_name,column_name`, [freshSchema])).rows;
  assert.equal(columns.length, 5);
  const triggerCount = Number((await fresh.query(`SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgname IN ('submission_page_path_guard','QuestionOption_section_graph_insert','QuestionOption_section_graph_update','QuestionOption_section_graph_delete')`, [freshSchema])).rows[0].count);
  assert.equal(triggerCount, 4);
  const branchIndex = (await fresh.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='QuestionOption_branch_question_idx'`, [freshSchema])).rows;
  assert.equal(branchIndex.length, 1); await fresh.end();

  const upgradeProject = join(working, "upgrade"); await project(upgradeProject, false); await migrate(upgradeSchema, upgradeProject, "upgrade-before");
  const before = await client(upgradeSchema); assert.equal(await migrationCount(before), 129);
  const ids = { tenant: randomUUID(), service: randomUUID(), user: randomUUID(), member: randomUUID(), form: randomUUID(), version: randomUUID(),
    question: randomUUID(), questionKey: randomUUID(), option: randomUUID(), optionKey: randomUUID(), publication: randomUUID(), submission: randomUUID() };
  const email = `page-upgrade-${suffix}@example.test`, tokenHash = createHash("sha256").update(suffix).digest("hex");
  await before.query("BEGIN");
  await before.query(`INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,'Page owner',$2,true,now())`, [ids.user, email]);
  await before.query(`INSERT INTO "Company" (id,name,"publicName","updatedAt") VALUES ($1,'Page upgrade','Page upgrade',now())`, [ids.tenant]);
  await before.query(`INSERT INTO "Membership" (id,"tenantId","userId",role,"updatedAt") VALUES ($1,$2,$3,'owner',now())`, [ids.member, ids.tenant, ids.user]);
  await before.query(`INSERT INTO "Service" (id,"tenantId",name,"externalName","updatedAt") VALUES ($1,$2,'Page service','Page service',now())`, [ids.service, ids.tenant]);
  await before.query(`INSERT INTO "Form" (id,"tenantId","serviceId","ownerId",title,"updatedAt") VALUES ($1,$2,$3,$4,'Legacy page form',now())`, [ids.form, ids.tenant, ids.service, ids.user]);
  await before.query(`INSERT INTO "FormVersion" (id,"tenantId","formId",number,title,body,"consentRequired","consentPurpose","retentionDays","maxResponses","updatedAt")
    VALUES ($1,$2,$3,1,'Legacy page form','',false,'',30,100,now())`, [ids.version, ids.tenant, ids.form]);
  await before.query(`INSERT INTO "Question" (id,"tenantId","formVersionId","stableKey",type,label,required,"order") VALUES ($1,$2,$3,$4,'객관식 답변','Route',true,0)`,
    [ids.question, ids.tenant, ids.version, ids.questionKey]);
  await before.query(`INSERT INTO "QuestionOption" (id,"questionId",value,"stableKey",label,"order") VALUES ($1,$2,'one',$3,'One',0)`, [ids.option, ids.question, ids.optionKey]);
  await before.query(`INSERT INTO "Publication" (id,"tenantId","formId","formVersionId","tokenHash","tokenCipher","maxResponses","updatedAt") VALUES ($1,$2,$3,$4,$5,'fixture',100,now())`,
    [ids.publication, ids.tenant, ids.form, ids.version, tokenHash]);
  await before.query(`INSERT INTO "Submission" (id,"tenantId","formVersionId","publicationId","retentionUntil","originalRetentionUntil","updatedAt")
    VALUES ($1,$2,$3,$4,now()+interval '30 days',now()+interval '30 days',now())`, [ids.submission, ids.tenant, ids.version, ids.publication]);
  await before.query("COMMIT"); await before.end();

  for (const name of additions) await cp(join("prisma/migrations", name), join(upgradeProject, "prisma/migrations", name), { recursive: true });
  await migrate(upgradeSchema, upgradeProject, "upgrade-after");
  const upgraded = await client(upgradeSchema); assert.equal(await migrationCount(upgraded), 137);
  assert.deepEqual((await upgraded.query(`SELECT "branchDestinationKind","branchDestinationSectionId" FROM "QuestionOption" WHERE id=$1`, [ids.option])).rows[0],
    { branchDestinationKind: null, branchDestinationSectionId: null });
  assert.deepEqual((await upgraded.query(`SELECT "pagePathVersion","visitedPageKeys","terminationKind" FROM "Submission" WHERE id=$1`, [ids.submission])).rows[0],
    { pagePathVersion: 0, visitedPageKeys: null, terminationKind: null });
  await upgraded.end();

  for (const [name, output] of Object.entries(logs)) await writeFile(join(evidence, `migration-${name}.log`), output);
  const report = { result: "passed", checkedAt: new Date().toISOString(), migrations: 137,
    fresh: { schema: freshSchema, columns, branchTriggers: triggerCount, partialBranchIndex: true },
    upgrade: { schema: upgradeSchema, beforeMigrations: 129, afterMigrations: 137, legacyOptionUnchanged: true, legacySubmissionPath: { pagePathVersion: 0 } },
    scope: "Ephemeral schemas in catchsecu_test; fresh install and 129→137 upgrade; schemas removed after verification." };
  await writeFile(join(evidence, "migration-install-final.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
} finally {
  if ((root as unknown as { _connected?: boolean })._connected !== false) {
    await root.query(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE`).catch(() => undefined);
    await root.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`).catch(() => undefined);
  }
  await root.end().catch(() => undefined); await rm(working, { recursive: true, force: true });
}
