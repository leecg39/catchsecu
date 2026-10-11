import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert(["localhost", "127.0.0.1"].includes(database.hostname));
const expectedColumns = { BillingMonthClose: 7, ComplianceClose: 7, ComplianceExportJob: 22 } as const;
const tables = Object.keys(expectedColumns);
const directory = "docs/qa/R23-T01/current";

function named<T extends { name: string }>(rows: T[], name: string) {
  const value = rows.find(row => row.name === name);
  assert.ok(value, name);
  return value;
}
function normalized(value: string) { return value.replaceAll('"', "").replace(/\s+/g, " "); }

try {
  const metadata = await db.$transaction(async tx => ({
    columns: await tx.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
      SELECT table_name AS "table",column_name AS "column",data_type AS type,is_nullable AS nullable
      FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}::text[])
      ORDER BY table_name,ordinal_position`,
    constraints: await tx.$queryRaw<{ table: string; name: string; definition: string; validated: boolean }[]>`
      SELECT c.relname AS "table",k.conname AS name,pg_get_constraintdef(k.oid) AS definition,k.convalidated AS validated
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(${tables}::text[]) ORDER BY c.relname,k.conname`,
    indexes: await tx.$queryRaw<{ table: string; name: string; definition: string }[]>`
      SELECT tablename AS "table",indexname AS name,indexdef AS definition FROM pg_indexes
      WHERE schemaname='public' AND tablename=ANY(${tables}::text[]) ORDER BY tablename,indexname`,
    triggers: await tx.$queryRaw<{ table: string; name: string; definition: string; function: string }[]>`
      SELECT c.relname AS "table",t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY(${tables}::text[]) ORDER BY c.relname,t.tgname`,
    migrations: await tx.$queryRaw<{ name: string; checksum: string }[]>`
      SELECT migration_name AS name,checksum FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    invalidServiceScopes: await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "ComplianceClose" c LEFT JOIN "Service" s
        ON s."tenantId"=c."tenantId" AND s.id=c."serviceKey"
      WHERE c."serviceKey"<>'' AND s.id IS NULL`,
    invalidExportScopes: await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "ComplianceExportJob" j
      LEFT JOIN "ComplianceClose" c ON c."tenantId"=j."tenantId" AND c.id=j."closeId"
      LEFT JOIN "Membership" m ON m."tenantId"=j."tenantId" AND m.id=j."memberId" AND m."userId"=j."requesterId"
      WHERE c.id IS NULL OR m.id IS NULL`,
  }), { isolationLevel: "Serializable", timeout: 15000 });

  for (const [table, count] of Object.entries(expectedColumns))
    assert.equal(metadata.columns.filter(row => row.table === table).length, count, `${table} columns`);
  assert.equal(metadata.columns.length, 36);
  assert.ok(metadata.constraints.every(row => row.validated));
  assert.equal(metadata.invalidServiceScopes[0]?.count, 0);
  assert.equal(metadata.invalidExportScopes[0]?.count, 0);

  for (const [name, signature] of Object.entries({
    ComplianceClose_tenant_fkey: "FOREIGN KEY (tenantId) REFERENCES Company(id)",
    ComplianceExportJob_close_fkey: "FOREIGN KEY (tenantId, closeId) REFERENCES ComplianceClose(tenantId, id)",
    ComplianceExportJob_requester_fkey: "FOREIGN KEY (tenantId, memberId, requesterId) REFERENCES Membership(tenantId, id, userId)",
  })) assert.ok(normalized(named(metadata.constraints, name).definition).includes(signature), name);
  for (const name of ["ComplianceClose_month", "ComplianceExportJob_state", "ComplianceExportJob_content",
    "ComplianceExportJob_lease", "ComplianceExportJob_expiry", "BillingMonthClose_shape"])
    named(metadata.constraints, name);
  for (const name of ["ComplianceClose_tenantId_serviceKey_month_key", "ComplianceClose_tenantId_id_key",
    "ComplianceExportJob_tenantId_memberId_requestKeyHash_key", "BillingMonthClose_key"])
    assert.ok(named(metadata.indexes, name).definition.includes("UNIQUE"), name);
  for (const name of ["ComplianceClose_tenantId_createdAt_idx", "ComplianceExportJob_tenantId_memberId_closeId_createdAt_id_idx",
    "ComplianceExportJob_status_leaseUntil_createdAt_idx", "ComplianceExportJob_expiresAt_idx"])
    named(metadata.indexes, name);
  assert.ok(named(metadata.triggers, "compliance_close_immutable").function.includes("compliance closes are immutable"));
  assert.ok(named(metadata.triggers, "compliance_export_transition").function.includes("invalid export transition"));
  assert.ok(named(metadata.triggers, "BillingMonthClose_guard").function.includes("MONTH_CLOSE_IMMUTABLE"));
  for (const name of ["20261005030000_compliance_close", "20261005080000_compliance_exports", "20261006120000_refund_closing"])
    assert.ok(metadata.migrations.some(row => row.name === name), name);

  const sourcePaths = ["prisma/schema.prisma", "src/contracts/analytics.ts", "src/contracts/compliance-evidence.ts",
    "src/contracts/compliance-exports.ts", "src/server/analytics.ts", "src/server/scoped-analytics.ts",
    "src/server/analytics-period.ts", "src/server/compliance-evidence.ts", "src/server/compliance-close.ts",
    "src/server/compliance-exports.ts", "src/server/payments.ts"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path,
    createHash("sha256").update(await readFile(path)).digest("hex")])));
  const definitions = { columns: metadata.columns, constraints: metadata.constraints, indexes: metadata.indexes, triggers: metadata.triggers };
  const report = { result: "passed", checkedAt: new Date().toISOString(), database: database.pathname.slice(1), models: tables,
    scope: "R23 analytics, compliance close, compliance export, and distinct billing month-close metadata audit with immutable snapshots, scoped references, transition constraints, deterministic indexes, migration identity, and live orphan checks.",
    counts: { columns: metadata.columns.length, constraints: metadata.constraints.length, indexes: metadata.indexes.length,
      triggers: metadata.triggers.length, migrations: metadata.migrations.length,
      invalidServiceScopes: metadata.invalidServiceScopes[0]?.count ?? -1, invalidExportScopes: metadata.invalidExportScopes[0]?.count ?? -1 },
    definitionHash: createHash("sha256").update(JSON.stringify(definitions)).digest("hex"),
    migrationHash: createHash("sha256").update(JSON.stringify(metadata.migrations)).digest("hex"), sourceHashes, definitions };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${report.database}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, models: tables.length, ...report.counts,
    definitionHash: report.definitionHash, migrationHash: report.migrationHash }));
} finally {
  await db.$disconnect();
}
