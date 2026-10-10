import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = "docs/qa/R08-T02/body-images/form-sections";
const migrations = ["20261025017000_form_sections", "20261025018000_form_section_trigger_fix"];
const checks = [
  "FormVersion_sectionSchemaVersion_check", "FormVersion_completionPage_state", "FormVersion_closedPage_state",
  "FormVersion_notice_body_length", "FormVersion_completionPageRich_shape", "FormVersion_closedPageRich_shape",
  "FormSection_pageKey_uuid", "FormSection_content_limits", "FormSection_destination_state", "FormSection_bodyRich_shape",
];
const foreignKeys = ["FormSection_tenantId_formVersionId_fkey", "FormSection_tenantId_formVersionId_destinationSectionId_fkey", "Question_tenantId_formVersionId_sectionId_fkey"];
const triggerExpectations = new Map([
  ["FormVersion_section_graph", { table: "FormVersion", fn: "check_form_section_graph", deferred: true }],
  ["FormSection_graph", { table: "FormSection", fn: "check_form_section_graph", deferred: true }],
  ["Question_section_graph", { table: "Question", fn: "check_form_section_graph", deferred: true }],
  ["published_section_immutable", { table: "FormSection", fn: "protect_published_section", deferred: false }],
]);

const client = new Client({ connectionString: url.href });
const report: Record<string, unknown> = { result: "failed", checkedAt: new Date().toISOString(), database: "catchsecu_test", readOnly: true };
try {
  await mkdir(directory, { recursive: true }); await client.connect();
  const sources = new Map<string, string>();
  for (const migration of migrations) {
    const sql = await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8");
    sources.set(migration, sql);
    const row = await client.query('SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1', [migration]);
    assert.equal(row.rows.length, 1); assert.ok(row.rows[0].finished_at); assert.equal(row.rows[0].rolled_back_at, null);
    assert.equal(row.rows[0].checksum, createHash("sha256").update(sql).digest("hex"), `Applied migration was edited: ${migration}`);
  }

  const actualChecks = await client.query(`SELECT c.conname,c.convalidated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND c.conname=ANY($1) AND c.contype='c'`, [checks]);
  assert.equal(actualChecks.rows.length, checks.length);
  assert.ok(actualChecks.rows.every(row => row.convalidated));
  const actualForeignKeys = await client.query(`SELECT c.conname,c.convalidated,c.confdeltype,c.confupdtype FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.conname=ANY($1) AND c.contype='f'`, [foreignKeys]);
  assert.equal(actualForeignKeys.rows.length, foreignKeys.length);
  assert.ok(actualForeignKeys.rows.every(row => row.convalidated && row.confdeltype === "r" && row.confupdtype === "a"));
  const orderUnique = await client.query(`SELECT condeferrable,condeferred,convalidated FROM pg_constraint
    WHERE conname='FormSection_tenantId_formVersionId_order_key' AND contype='u'`);
  assert.deepEqual(orderUnique.rows, [{ condeferrable: true, condeferred: true, convalidated: true }]);

  for (const [name, expected] of triggerExpectations) {
    const result = await client.query(`SELECT c.relname,p.proname,t.tgdeferrable,t.tginitdeferred,t.tgenabled FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='public' AND t.tgname=$1 AND NOT t.tgisinternal`, [name]);
    assert.deepEqual(result.rows, [{ relname: expected.table, proname: expected.fn, tgdeferrable: expected.deferred,
      tginitdeferred: expected.deferred, tgenabled: "O" }]);
  }

  const functionSources = new Map<string, string>();
  const functionPattern = /CREATE(?: OR REPLACE)? FUNCTION (\w+)\([^)]*\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g;
  for (const migration of migrations) for (const match of sources.get(migration)!.matchAll(functionPattern)) functionSources.set(match[1], match[2].trim());
  assert.deepEqual([...functionSources.keys()].sort(), ["assert_form_section_graph", "check_form_section_graph", "protect_published_section"]);
  for (const [name, body] of functionSources) {
    const result = await client.query(`SELECT p.prosrc,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1`, [name]);
    assert.deepEqual(result.rows.map(row => ({ ...row, prosrc: row.prosrc.trim() })), [{ prosrc: body, prosecdef: false, proconfig: null }]);
  }

  const columns = await client.query(`SELECT table_name,column_name,is_nullable,column_default,data_type FROM information_schema.columns
    WHERE table_schema='public' AND ((table_name='FormVersion' AND column_name=ANY($1))
      OR (table_name='Question' AND column_name='sectionId') OR table_name='FormSection')`, [["sectionSchemaVersion", "completionPageMode", "completionPageBody", "completionPageBodyRich", "closedPageMode", "closedPageBody", "closedPageBodyRich"]]);
  assert.equal(columns.rows.length, 21);
  report.result = "passed"; report.migrations = migrations; report.checks = checks.length; report.foreignKeys = foreignKeys.length;
  report.functions = functionSources.size; report.triggers = triggerExpectations.size; report.columns = columns.rows.length;
  console.log(JSON.stringify(report));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
  console.error(JSON.stringify(report));
} finally {
  await client.end(); await writeFile(`${directory}/schema-guards-final.json`, JSON.stringify(report, null, 2) + "\n");
}
