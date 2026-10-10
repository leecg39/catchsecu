import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const suffix = randomUUID().replaceAll("-", ""), freshSchema = `qa_form_sections_fresh_${suffix}`, upgradeSchema = `qa_form_sections_upgrade_${suffix}`;
const working = resolve(`.local/qa-form-sections-${suffix}`), evidence = "docs/qa/R08-T02/body-images/form-sections";
const prismaCli = resolve("node_modules/prisma/build/index.js");
const migrations = ["20261025017000_form_sections", "20261025018000_form_section_trigger_fix"];
const logs: Record<string, string> = {};

async function migrate(schema: string, directory: string, label: string) {
  const scoped = new URL(url); scoped.searchParams.set("schema", schema);
  const result = await new Promise<{ code: number; output: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: directory, env: { ...process.env, DATABASE_URL: scoped.href },
    });
    let output = "";
    child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    child.once("error", reject); child.once("close", code => resolvePromise({ code: code ?? 1, output }));
  });
  logs[label] = result.output.replaceAll(scoped.href, "[isolated test database URL]");
  assert.equal(result.code, 0, `${label} migration failed`);
}

async function schemaClient(schema: string) {
  const client = new Client({ connectionString: url.href });
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);
  return client;
}

async function migrationCount(client: Client) {
  return (await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count as number;
}

const root = new Client({ connectionString: url.href });
try {
  await mkdir(evidence, { recursive: true }); await mkdir(working, { recursive: true }); await root.connect();
  await root.query(`CREATE SCHEMA "${freshSchema}"`); await root.query(`CREATE SCHEMA "${upgradeSchema}"`);

  const freshProject = join(working, "fresh");
  await mkdir(freshProject, { recursive: true }); await cp("prisma", join(freshProject, "prisma"), { recursive: true });
  await writeFile(join(freshProject, "prisma.config.ts"), 'import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: env("DATABASE_URL") } });\n');
  await migrate(freshSchema, freshProject, "fresh");
  const fresh = await schemaClient(freshSchema);
  const freshCount = await migrationCount(fresh);
  assert.equal(freshCount, 128);
  const freshColumns = (await fresh.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=$1 AND ((table_name='FormVersion' AND column_name IN ('sectionSchemaVersion','completionPageMode','completionPageBody','completionPageBodyRich','closedPageMode','closedPageBody','closedPageBodyRich'))
      OR (table_name='Question' AND column_name='sectionId') OR table_name='FormSection')`, [freshSchema])).rows;
  assert.ok(freshColumns.some(row => row.table_name === "FormSection" && row.column_name === "pageKey"));
  assert.equal((await fresh.query(`SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal
      AND t.tgname IN ('FormVersion_section_graph','FormSection_graph','Question_section_graph','published_section_immutable')`, [freshSchema])).rows[0].count, 4);
  await fresh.end();

  const upgradeProject = join(working, "upgrade");
  await mkdir(upgradeProject, { recursive: true }); await cp("prisma", join(upgradeProject, "prisma"), { recursive: true });
  for (const migration of migrations) await rm(join(upgradeProject, "prisma/migrations", migration), { recursive: true, force: true });
  await writeFile(join(upgradeProject, "prisma.config.ts"), 'import { defineConfig, env } from "prisma/config";\nexport default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: env("DATABASE_URL") } });\n');
  await migrate(upgradeSchema, upgradeProject, "upgrade-before");
  const upgrade = await schemaClient(upgradeSchema);
  assert.equal(await migrationCount(upgrade), 126);
  const ids = { tenant: randomUUID(), service: randomUUID(), user: randomUUID(), member: randomUUID(), form: randomUUID(), version: randomUUID(), question: randomUUID(), questionKey: randomUUID() };
  await upgrade.query(`INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,'Legacy owner',$2,true,now())`, [ids.user, `legacy-${suffix}@example.test`]);
  await upgrade.query(`INSERT INTO "Company" (id,name,"publicName","updatedAt") VALUES ($1,'Legacy company','Legacy company',now())`, [ids.tenant]);
  await upgrade.query(`INSERT INTO "Membership" (id,"tenantId","userId",role,"updatedAt") VALUES ($1,$2,$3,'owner',now())`, [ids.member, ids.tenant, ids.user]);
  await upgrade.query(`INSERT INTO "Service" (id,"tenantId",name,"externalName","updatedAt") VALUES ($1,$2,'Legacy service','Legacy service',now())`, [ids.service, ids.tenant]);
  await upgrade.query(`INSERT INTO "Form" (id,"tenantId","serviceId","ownerId",title,"updatedAt") VALUES ($1,$2,$3,$4,'Legacy form',now())`, [ids.form, ids.tenant, ids.service, ids.user]);
  await upgrade.query(`INSERT INTO "FormVersion" (id,"tenantId","formId",number,title,body,"consentRequired","consentPurpose","retentionDays","maxResponses","updatedAt")
    VALUES ($1,$2,$3,1,'Legacy form','Legacy body',false,'',30,100,now())`, [ids.version, ids.tenant, ids.form]);
  await upgrade.query(`INSERT INTO "Question" (id,"tenantId","formVersionId","stableKey",type,label,required,"order")
    VALUES ($1,$2,$3,$4,'단문형 답변','Legacy question',true,0)`, [ids.question, ids.tenant, ids.version, ids.questionKey]);
  const before = (await upgrade.query(`SELECT jsonb_build_object('version',to_jsonb(v),'question',to_jsonb(q)) AS snapshot
    FROM "FormVersion" v JOIN "Question" q ON q."formVersionId"=v.id WHERE v.id=$1`, [ids.version])).rows[0].snapshot;
  await upgrade.end();

  for (const migration of migrations) await cp(join("prisma/migrations", migration), join(upgradeProject, "prisma/migrations", migration), { recursive: true });
  await migrate(upgradeSchema, upgradeProject, "upgrade-after");
  const upgraded = await schemaClient(upgradeSchema);
  assert.equal(await migrationCount(upgraded), 128);
  const after = (await upgraded.query(`SELECT jsonb_build_object(
      'version',to_jsonb(v) - ARRAY['sectionSchemaVersion','completionPageMode','completionPageBody','completionPageBodyRich','closedPageMode','closedPageBody','closedPageBodyRich'],
      'question',to_jsonb(q) - 'sectionId') AS snapshot
    FROM "FormVersion" v JOIN "Question" q ON q."formVersionId"=v.id WHERE v.id=$1`, [ids.version])).rows[0].snapshot;
  assert.deepEqual(after, before);
  const defaults = (await upgraded.query(`SELECT v."sectionSchemaVersion",v."completionPageMode",v."closedPageMode",q."sectionId",
    (SELECT count(*)::int FROM "FormSection" s WHERE s."formVersionId"=v.id) AS sections
    FROM "FormVersion" v JOIN "Question" q ON q."formVersionId"=v.id WHERE v.id=$1`, [ids.version])).rows[0];
  assert.deepEqual(defaults, { sectionSchemaVersion: 0, completionPageMode: null, closedPageMode: null, sectionId: null, sections: 0 });
  await upgraded.end();

  for (const [name, output] of Object.entries(logs)) await writeFile(join(evidence, `migration-${name}.log`), output);
  const report = { result: "passed", checkedAt: new Date().toISOString(), migrations: 128,
    fresh: { schema: freshSchema, columns: freshColumns.length, graphTriggers: 4 },
    upgrade: { schema: upgradeSchema, beforeMigrations: 126, afterMigrations: 128, legacyRowsUnchanged: true, newDefaults: defaults },
    scope: "Ephemeral schemas in catchsecu_test; legacy fixture common columns compared before/after; schemas removed after verification." };
  await writeFile(join(evidence, "migration-install-final.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  if ((root as unknown as { _connected?: boolean })._connected !== false) {
    await root.query(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE`).catch(() => undefined);
    await root.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`).catch(() => undefined);
  }
  await root.end().catch(() => undefined); await rm(working, { recursive: true, force: true });
}
