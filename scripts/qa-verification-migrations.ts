import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const target = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || !["/catchsecu_dev", "/catchsecu_test"].includes(target.pathname)) throw new Error("Local development/test schema inspection only.");
const tables = ["VerificationIntegration", "VerificationIntegrationRevision", "VerificationAttempt", "VerificationEvent", "VerificationReceipt"];
const client = new Client({ connectionString: target.href }); await client.connect();
try {
  const migrations = (await client.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows as { migration_name: string; checksum: string }[];
  assert.equal(migrations.length, 61);
  for (const row of migrations) assert.equal(createHash("sha256").update(await readFile(`prisma/migrations/${row.migration_name}/migration.sql`)).digest("hex"), row.checksum);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')).rows[0].count, 0);
  const constraints = (await client.query("SELECT c.conname AS name,c.contype AS type,t.relname AS table,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,c.conname", [tables])).rows as { name: string; type: string; table: string; definition: string }[];
  assert.equal(constraints.filter(row => row.type === "f").length, 11); assert.equal(constraints.filter(row => row.type === "c").length, 5);
  const triggers = (await client.query("SELECT t.tgname AS name,c.relname AS table,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname=ANY($1::text[]) AND t.tgname LIKE 'verification_%' ORDER BY c.relname,t.tgname", [tables])).rows;
  assert.equal(triggers.length, 5);
  const indexes = (await client.query("SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND (tablename=ANY($1::text[]) OR indexname='Publication_tenantId_formId_id_formVersionId_key') ORDER BY indexname", [tables])).rows as { name: string; definition: string }[];
  assert(indexes.some(row => row.name === "VerificationReceipt_tenantId_submissionId_kind_key" && row.definition.includes('"tenantId", "submissionId", kind')));
  assert(!indexes.some(row => row.name === "VerificationReceipt_submissionId_key"));
  assert(indexes.some(row => row.name === "Publication_tenantId_formId_id_formVersionId_key"));
  const rolledBackAttempts = (await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NOT NULL ORDER BY migration_name')).rows;
  const report = { checkedAt: new Date().toISOString(), result: "passed", database: target.pathname.slice(1), checksumMatches: migrations.length,
    existingMigrationChecksumsPreserved: 59, newMigrations: migrations.slice(-2).map(row => row.migration_name), tables: tables.length, foreignKeys: 11, checks: 5, triggers: 5,
    constraints, triggerDefinitions: triggers, indexes, rolledBackAttempts, providerSandboxVerified: false, readOnly: true };
  await writeFile(`docs/qa/P06-T06/${target.pathname === "/catchsecu_dev" ? "dev" : "test"}-schema.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, checksums: report.checksumMatches, foreignKeys: report.foreignKeys, checks: report.checks, triggers: report.triggers }));
} finally { await client.end(); }
