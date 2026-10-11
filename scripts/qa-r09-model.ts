import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["SecurityPolicy", "Form", "ApprovalRequest", "Publication", "FixedUrl"];
const directory = "docs/qa/R09-T01/current";

function includes(rows: { definition: string }[], text: string) {
  return rows.some(row => row.definition.includes(text));
}

try {
  const metadata = await db.$transaction(async tx => ({
    columns: await tx.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
      SELECT table_name AS "table", column_name AS "column", data_type AS type, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY(${tables}::text[])
      ORDER BY table_name, ordinal_position`,
    constraints: await tx.$queryRaw<{ table: string; name: string; definition: string; validated: boolean }[]>`
      SELECT c.relname AS "table", k.conname AS name, pg_get_constraintdef(k.oid) AS definition, k.convalidated AS validated
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${tables}::text[])
      ORDER BY c.relname, k.conname`,
    indexes: await tx.$queryRaw<{ table: string; name: string; definition: string }[]>`
      SELECT tablename AS "table", indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY(${tables}::text[])
      ORDER BY tablename, indexname`,
    triggers: await tx.$queryRaw<{ table: string; name: string; definition: string; function: string }[]>`
      SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS definition,
        pg_get_functiondef(t.tgfoid) AS function
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND c.relname = ANY(${tables}::text[])
      ORDER BY c.relname, t.tgname`,
    migrations: await tx.$queryRaw<{ name: string; checksum: string }[]>`
      SELECT migration_name AS name, checksum
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`,
  }), { isolationLevel: "Serializable", timeout: 15000 });

  assert.equal(metadata.columns.filter(row => row.table === "ApprovalRequest").length, 17);
  assert.equal(metadata.columns.filter(row => row.table === "Publication").length, 15);
  assert.equal(metadata.columns.filter(row => row.table === "FixedUrl").length, 9);
  assert.ok(metadata.constraints.every(row => row.validated));
  assert.ok(includes(metadata.constraints.filter(row => row.table === "ApprovalRequest"), "pending"));
  assert.ok(includes(metadata.constraints.filter(row => row.table === "ApprovalRequest"), "decidedBy"));
  assert.ok(includes(metadata.constraints.filter(row => row.table === "Publication"), "responseCount"));
  assert.ok(includes(metadata.constraints.filter(row => row.table === "Publication"), "opensAt"));
  assert.ok(metadata.indexes.some(row => row.name === "ApprovalRequest_one_active_per_form" && row.definition.includes("pending") && row.definition.includes("approved")));
  assert.ok(metadata.indexes.some(row => row.name === "Publication_tokenHash_key" && row.definition.includes("UNIQUE")));
  assert.ok(metadata.indexes.some(row => row.name === "Publication_approvalId_key" && row.definition.includes("UNIQUE")));
  assert.ok(metadata.indexes.some(row => row.name === "FixedUrl_slug_key" && row.definition.includes("UNIQUE")));
  const approvalGuard = metadata.triggers.find(row => row.name === "ApprovalRequest_evidence_guard");
  assert.ok(approvalGuard?.function.includes("Approval evidence cannot be deleted"));
  assert.ok(approvalGuard?.function.includes("Approval snapshot is immutable"));
  assert.ok(approvalGuard?.function.includes("Invalid approval transition"));
  const publicationGuard = metadata.triggers.find(row => row.name === "Publication_approval_guard");
  assert.ok(publicationGuard?.function.includes("Publication requires approval"));
  assert.ok(publicationGuard?.function.includes("Publication approval is invalid"));

  const sources = [
    "prisma/schema.prisma",
    "src/contracts/security.ts",
    "src/server/approvals.ts",
    "src/server/forms.ts",
    "src/server/public-publication.ts",
    "src/server/fixed-urls.ts",
  ];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [
    path, createHash("sha256").update(await readFile(path)).digest("hex"),
  ])));
  const definitions = {
    columns: metadata.columns,
    constraints: metadata.constraints,
    indexes: metadata.indexes,
    triggers: metadata.triggers,
  };
  const definitionHash = createHash("sha256").update(JSON.stringify(definitions)).digest("hex");
  const report = {
    result: "passed",
    checkedAt: new Date().toISOString(),
    database: database.pathname.slice(1),
    models: tables,
    counts: {
      columns: metadata.columns.length,
      constraints: metadata.constraints.length,
      indexes: metadata.indexes.length,
      triggers: metadata.triggers.length,
      migrations: metadata.migrations.length,
    },
    definitionHash,
    migrationHash: createHash("sha256").update(JSON.stringify(metadata.migrations)).digest("hex"),
    sourceHashes,
    definitions,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${report.database}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log({ result: report.result, database: report.database, ...report.counts, definitionHash, migrationHash: report.migrationHash });
} finally {
  await db.$disconnect();
}
