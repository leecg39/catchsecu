import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const target = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || !["/catchsecu_dev", "/catchsecu_test"].includes(target.pathname)) throw new Error("Local schema inspection only.");
const client = new Client({ connectionString: target.href }); await client.connect();
try {
  const migrations = (await client.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows as { migration_name: string; checksum: string }[];
  assert.equal(migrations.length, 62);
  for (const row of migrations) assert.equal(createHash("sha256").update(await readFile("prisma/migrations/" + row.migration_name + "/migration.sql")).digest("hex"), row.checksum);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')).rows[0].count, 0);
  const names = ["verification_receipt_00_live", "verification_receipt_erase_guard", "verification_receipt_erase_related", "certificate_verification_erasure"];
  const triggers = (await client.query("SELECT t.tgname AS name,c.relname AS table,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname=ANY($1::text[]) ORDER BY t.tgname", [names])).rows;
  assert.equal(triggers.length, 4);
  const functions = (await client.query("SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname",
    [["verification_receipt_live_submission", "verification_receipt_erase_guard", "verification_receipt_erase_related", "certificate_requires_verification_erasure", "validate_destruction_certificate"]])).rows as { name: string; definition: string }[];
  assert.equal(functions.length, 5);
  const counts = functions.find(row => row.name === "validate_destruction_certificate")!.definition;
  for (const key of ["verificationReceipts", "verificationEvents", "verificationAttempts", "campaignRecipients", "marketingJobs", "answers"]) assert(counts.includes("'" + key + "'"));
  await writeFile("docs/qa/P07-T03/" + (target.pathname === "/catchsecu_dev" ? "dev" : "test") + "-schema.json", JSON.stringify({
    checkedAt: new Date().toISOString(), result: "passed", database: target.pathname.slice(1), readOnly: true,
    checksumMatches: migrations.length, previouslyAppliedFilesPreserved: 61, newMigration: migrations.at(-1)!.migration_name, migrations, triggers, functions,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", database: target.pathname.slice(1), checksums: migrations.length, newTriggers: triggers.length }));
} finally { await client.end(); }
