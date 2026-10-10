import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "pg";

const migration = "20261025029000_form_template_archive_state";
const source = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(source.hostname));
assert.equal(source.pathname, "/catchsecu_dev");
const migrationSql = await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8");
const checksum = createHash("sha256").update(migrationSql).digest("hex");

async function inspect(database: "catchsecu_dev" | "catchsecu_test" | "catchsecu_shadow") {
  const url = new URL(source.href); url.pathname = "/" + database;
  const client = new Client({ connectionString: url.href }); await client.connect();
  try {
    const applied = await client.query(`SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations"
      WHERE migration_name=$1 ORDER BY started_at DESC`, [migration]);
    assert.equal(applied.rows.length, 1); assert.equal(applied.rows[0].checksum, checksum);
    assert.ok(applied.rows[0].finished_at); assert.equal(applied.rows[0].rolled_back_at, null);
    const constraint = await client.query(`SELECT pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname='FormTemplate' AND c.conname='FormTemplate_status_check'`);
    assert.deepEqual(constraint.rows, [{ definition: "CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))", validated: true }]);
    const statuses = await client.query(`SELECT status,count(*)::int AS count FROM "FormTemplate" GROUP BY status ORDER BY status`);
    return { database, migrationApplied: true, constraint: constraint.rows[0], statuses: statuses.rows };
  } finally { await client.end(); }
}

async function freshInstall() {
  const url = new URL(source.href); url.pathname = "/catchsecu_shadow";
  const client = new Client({ connectionString: url.href }); await client.connect();
  try {
    assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, "catchsecu_shadow");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO catchsecu_app");
  } finally { await client.end(); }
  const result = await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url.href },
    });
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, output }));
  });
  assert.equal(result.code, 0, result.output.replaceAll(url.href, "[database URL]"));
  const checked = await inspect("catchsecu_shadow");
  const probe = new Client({ connectionString: url.href }); await probe.connect();
  let invalidStatusSqlState = "";
  try {
    await probe.query("BEGIN");
    await probe.query(`INSERT INTO "FormTemplate" (id,title,category,"licenseScope",content,status,"updatedAt")
      VALUES ('30000000-0000-4000-8000-000000000099','invalid','QA','ACTIVE_SUBSCRIPTION','{}'::jsonb,'deleted',now())`);
  } catch (error) { invalidStatusSqlState = (error as { code?: string }).code ?? ""; }
  finally { await probe.query("ROLLBACK"); await probe.end(); }
  assert.equal(invalidStatusSqlState, "23514");
  return { ...checked, invalidStatusSqlState };
}

const report = { checkedAt: new Date().toISOString(), result: "passed", migration, checksum,
  existingDatabases: [await inspect("catchsecu_dev"), await inspect("catchsecu_test")], freshInstall: await freshInstall() };
await mkdir("docs/qa/R08-T03/template-archive", { recursive: true });
await writeFile("docs/qa/R08-T03/template-archive/migration-verification.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, migration, databases: ["catchsecu_dev", "catchsecu_test", "catchsecu_shadow"], invalidStatusSqlState: report.freshInstall.invalidStatusSqlState }));
