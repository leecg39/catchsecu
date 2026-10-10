import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const after = process.argv.includes("--after-migration");
const directory = "docs/qa/R10-T01/public-recipient-snapshots";
const client = new Client({ connectionString: url.href });
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tables: Record<string, { count: number; sha256: string }> = {};
  for (const name of ["Document", "DocumentVersion", "DocumentPublication", "DocumentPdf", "FormDocumentBinding", "ConsentReceipt", "ConsentEvent"]) {
    const result = await client.query(`SELECT row_to_json(t)::text AS value FROM "${name}" t ORDER BY 1`);
    tables[name] = { count: result.rows.length, sha256: createHash("sha256").update(JSON.stringify(result.rows.map(row => row.value))).digest("hex") };
  }
  const migrations = (await client.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  assert.equal(migrations.length, after ? 103 : 102);
  let relationRows: number | null = null;
  if (after) {
    const before = JSON.parse(await readFile(directory + "/migration-before.json", "utf8"));
    assert.deepEqual(tables, before.tables, "Migration changed existing document, PDF or receipt bytes");
    assert.deepEqual(migrations.slice(0, -1), before.migrations, "Existing migration checksums changed");
    relationRows = Number((await client.query('SELECT count(*) AS count FROM "DocumentVersionRecipient"')).rows[0].count);
    assert.equal(relationRows, 0, "Migration guessed source identities for historical versions");
    const sql = await readFile("prisma/migrations/20261018000000_document_version_recipients/migration.sql");
    assert.equal(migrations.at(-1).checksum, createHash("sha256").update(sql).digest("hex"));
  }
  await client.query("COMMIT");
  const report = { checkedAt: new Date().toISOString(), result: "passed", readOnly: true, afterMigration: after,
    migrationCount: migrations.length, migrations, tables, historicalSourcesBackfilled: false, relationRows };
  await writeFile(directory + (after ? "/migration-after.json" : "/migration-before.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", migrationCount: migrations.length, tables, relationRows }));
} finally { await client.end(); }
