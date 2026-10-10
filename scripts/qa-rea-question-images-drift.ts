import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";

// 개발 DB에는 읽기 전용 트랜잭션만 사용한다. 설치는 매번 새 시험 schema에서 수행한다.
const source = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(source.hostname));
assert.equal(source.pathname, "/catchsecu_dev");
assert.ok(!source.searchParams.get("schema") || source.searchParams.get("schema") === "public");
const schema = "qa_drift_" + randomBytes(8).toString("hex");
const freshUrl = new URL(source.href);
freshUrl.pathname = "/catchsecu_test";
freshUrl.searchParams.set("schema", schema);
const dev = new Client({ connectionString: source.href });
const fresh = new Client({ connectionString: freshUrl.href });
const output = "docs/qa/R08-T02/question-metadata/content-images/schema-drift";
mkdirSync(output, { recursive: true });
const hash = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const migrations = readdirSync("prisma/migrations").filter(name => /^\d/.test(name)).sort();
type Entry = { kind: string; key: string; definition: string };

async function catalog(client: Client, namespace: string): Promise<Entry[]> {
  await client.query('SET LOCAL search_path TO "' + namespace + '", public');
  const queries: Record<string, string> = {
    table: `SELECT c.relname AS key, json_build_object('kind',c.relkind,'rls',c.relrowsecurity,
      'forceRls',c.relforcerowsecurity,'persistence',c.relpersistence,'options',c.reloptions)::text AS definition
      FROM pg_class c WHERE c.relnamespace=$1::regnamespace AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'`,
    column: `SELECT c.relname||'.'||a.attname AS key, json_build_object('position',a.attnum,
      'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,
      'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))::text AS definition
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE c.relnamespace=$1::regnamespace AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'
        AND a.attnum>0 AND NOT a.attisdropped`,
    constraint: `SELECT c.relname||'.'||x.conname AS key,
      json_build_object('definition',pg_get_constraintdef(x.oid),'validated',x.convalidated)::text AS definition
      FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
      WHERE x.connamespace=$1::regnamespace AND c.relname<>'_prisma_migrations'`,
    index: `SELECT c.relname AS key, json_build_object('definition',pg_get_indexdef(c.oid),
      'valid',i.indisvalid,'ready',i.indisready)::text AS definition
      FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid JOIN pg_class t ON t.oid=i.indrelid
      WHERE c.relnamespace=$1::regnamespace AND t.relname<>'_prisma_migrations'`,
    trigger: `SELECT c.relname||'.'||t.tgname AS key,
      json_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)::text AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace=$1::regnamespace AND NOT t.tgisinternal`,
    function: `SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS key,
      pg_get_functiondef(p.oid) AS definition FROM pg_proc p
      WHERE p.pronamespace=$1::regnamespace AND p.prokind IN ('f','p')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`,
    enum: `SELECT t.typname AS key, json_agg(e.enumlabel ORDER BY e.enumsortorder)::text AS definition
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace=$1::regnamespace GROUP BY t.typname`,
    view: `SELECT c.relname AS key, pg_get_viewdef(c.oid) AS definition FROM pg_class c
      WHERE c.relnamespace=$1::regnamespace AND c.relkind IN ('v','m')`,
    policy: `SELECT tablename||'.'||policyname AS key,
      json_build_object('permissive',permissive,'roles',roles,'cmd',cmd,'qual',qual,'check',with_check)::text AS definition
      FROM pg_policies WHERE schemaname=$1`,
  };
  const entries: Entry[] = [];
  for (const [kind, sql] of Object.entries(queries)) {
    const rows = (await client.query<{ key: string; definition: string }>(sql, [namespace])).rows;
    for (const row of rows) entries.push({ kind, key: row.key,
      definition: row.definition.replaceAll('"' + namespace + '".', "__schema__.").replaceAll(namespace + ".", "__schema__.") });
  }
  return entries.sort((a, b) => (a.kind + "/" + a.key).localeCompare(b.kind + "/" + b.key));
}

async function history(client: Client) {
  const rows = (await client.query<{ migration_name: string; checksum: string }>(
    'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  return { count: rows.length, mismatches: rows.flatMap(row => {
    const path = "prisma/migrations/" + row.migration_name + "/migration.sql";
    const checksum = hash(readFileSync(path));
    if (checksum === row.checksum) return [];
    const commits = execFileSync("git", ["log", "--all", "--format=%H", "--", path], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    const versions = commits.map(commit => {
      const content = execFileSync("git", ["show", commit + ":" + path]);
      return { commit, checksum: hash(content) };
    });
    return [{ migration: row.migration_name, sourceChecksum: checksum, appliedChecksum: row.checksum,
      gitVersions: versions, appliedVersionFoundInGitHistory: versions.some(v => v.checksum === row.checksum) }];
  }) };
}

await dev.connect();
await fresh.connect();
try {
  await fresh.query('CREATE SCHEMA "' + schema + '"');
  const deployment = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: freshUrl.href }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(output + "/fresh-install.log", deployment.replaceAll(freshUrl.href, "[redacted]"));
  await fresh.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await dev.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const devCatalog = await catalog(dev, "public"), freshCatalog = await catalog(fresh, schema);
  const devHistory = await history(dev), freshHistory = await history(fresh);
  assert.equal(freshHistory.count, migrations.length);
  assert.deepEqual(freshHistory.mismatches, []);
  const actual = new Map(devCatalog.map(entry => [entry.kind + "/" + entry.key, entry]));
  const expected = new Map(freshCatalog.map(entry => [entry.kind + "/" + entry.key, entry]));
  const keys = [...new Set([...actual.keys(), ...expected.keys()])].sort();
  const differences = keys.flatMap(key => actual.get(key)?.definition === expected.get(key)?.definition ? [] : [{ key,
    development: actual.get(key)?.definition ?? null, freshInstall: expected.get(key)?.definition ?? null }]);
  const report = { at: new Date().toISOString(), developmentReadOnly: true, freshSchema: schema,
    migrationCount: migrations.length, developmentHistory: devHistory, freshHistory,
    catalogCounts: { development: devCatalog.length, freshInstall: freshCatalog.length },
    catalogHashes: { development: hash(JSON.stringify(devCatalog)), freshInstall: hash(JSON.stringify(freshCatalog)) },
    differences, allChecksumsMatch: devHistory.mismatches.length === 0,
    ddlMatches: differences.length === 0,
    limitations: ["Database/role grants, extension versions and runtime behavior are outside this catalog comparison.",
      "Whitespace and SQL source differences in stored routines are reported without assuming semantic equivalence."] };
  writeFileSync(output + "/catalog-comparison.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ migrations: migrations.length, checksumMismatches: devHistory.mismatches.length,
    catalogObjects: devCatalog.length, ddlDifferences: differences.length }));
  if (differences.length || devHistory.mismatches.length) process.exitCode = 1;
} finally {
  await dev.query("ROLLBACK");
  await fresh.query("ROLLBACK");
  await fresh.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await dev.end();
  await fresh.end();
}
