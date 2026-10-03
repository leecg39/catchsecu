import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
const target = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || !["/catchsecu_dev", "/catchsecu_test"].includes(target.pathname)) throw new Error("Local schema inspection only.");
const client = new Client({ connectionString: target.href }); await client.connect();
try {
  const migrations = (await client.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows as { migration_name: string; checksum: string }[];
  assert.equal(migrations.length, 64);
  for (const row of migrations) assert.equal(createHash("sha256").update(await readFile("prisma/migrations/" + row.migration_name + "/migration.sql")).digest("hex"), row.checksum);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')).rows[0].count, 0);
  const triggers = (await client.query("SELECT t.tgname AS name,c.relname AS table,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname=ANY($1::text[]) ORDER BY t.tgname", [["marketing_local_copy_guard", "certificate_marketing_copy_guard"]])).rows;
  assert.equal(triggers.length, 2);
  const functions = (await client.query("SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname", [["guard_marketing_local_copy", "require_marketing_copy_erasure"]])).rows;
  assert.equal(functions.length, 2);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conname='marketing_local_copy_erasure' AND convalidated")).rows[0].count, 1);
  await writeFile("docs/qa/P07-T02/" + (target.pathname === "/catchsecu_dev" ? "dev" : "test") + "-schema.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", database: target.pathname.slice(1), readOnly: true, checksumMatches: 64, previouslyAppliedFilesPreserved: 63, migrations, triggers, functions }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", database: target.pathname.slice(1), checksums: 64, newTriggers: 2 }));
} finally { await client.end(); }
