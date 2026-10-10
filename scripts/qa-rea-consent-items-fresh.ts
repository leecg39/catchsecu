import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const schema = "qa_consent_items_" + randomUUID().replaceAll("-", "");
const root = new Client({ connectionString: url.href });
const directory = "docs/qa/R08-T02/question-metadata/consent-items";
try {
  await root.connect(); await mkdir(directory, { recursive: true }); await root.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url); scoped.searchParams.set("schema", schema);
  const execution = await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: scoped.href } });
    let output = ""; child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, output }));
  });
  await writeFile(directory + "/fresh-schema.log", execution.output.replaceAll(scoped.href, "[test database URL]"));
  assert.equal(execution.code, 0, "Fresh schema migration failed");
  const expected = (await readdir("prisma/migrations", { withFileTypes: true })).filter(entry => entry.isDirectory()).length;
  const applied = (await root.query(`SELECT count(*)::int AS n FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`)).rows[0].n as number;
  assert.equal(applied, expected);
  const columns = (await root.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema=$1 AND table_name='FormVersion' AND column_name IN ('consentItemSchemaVersion','consentItems') ORDER BY column_name`, [schema])).rows;
  assert.deepEqual(columns.map(row => [row.column_name, row.data_type, row.is_nullable]),
    [["consentItemSchemaVersion", "integer", "NO"], ["consentItems", "jsonb", "YES"]]);
  const constraints = (await root.query(`SELECT conname, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 AND t.relname='FormVersion' AND conname='FormVersion_consent_items_check'`, [schema])).rows;
  assert.equal(constraints.length, 1); assert(constraints[0].definition.includes("valid_form_consent_items"));
  const triggers = (await root.query(`SELECT tgname, pg_get_triggerdef(g.oid) AS definition FROM pg_trigger g
    JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 AND tgname IN ('FormVersion_consent_items_projection','Question_consent_items_projection') ORDER BY tgname`, [schema])).rows;
  assert.equal(triggers.length, 2); assert(triggers.every(row => row.definition.includes("DEFERRABLE INITIALLY DEFERRED")));
  const report = { checkedAt: new Date().toISOString(), result: "passed", migrations: applied, expectedMigrations: expected,
    columns, constraints, triggers, schemaWasDropped: true,
    scope: "Fresh isolated PostgreSQL schema; all migrations applied; additive columns, strict JSON check and both deferred projection triggers inspected." };
  await writeFile(directory + "/fresh-schema.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", migrations: applied, triggers: triggers.length }));
} finally {
  await root.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined); await root.end();
}
