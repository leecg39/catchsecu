import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["Company", "Service", "Membership", "ServiceGrant", "AccessRequest", "CompanyBusinessFile"];
try {
  const columns = await db.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
    SELECT table_name AS "table", column_name AS "column", data_type AS type, is_nullable AS nullable
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}::text[])
    ORDER BY table_name, ordinal_position`;
  const constraints = await db.$queryRaw<{ table: string; name: string; definition: string }[]>`
    SELECT c.relname AS "table", k.conname AS name, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(${tables}::text[]) ORDER BY c.relname,k.conname`;
  const indexes = await db.$queryRaw<{ table: string; name: string; definition: string }[]>`
    SELECT tablename AS "table", indexname AS name, indexdef AS definition
    FROM pg_indexes WHERE schemaname='public' AND tablename=ANY(${tables}::text[]) ORDER BY tablename,indexname`;
  for (const table of tables) assert.ok(columns.some(column => column.table === table), table);
  const pending = indexes.find(index => index.name === "AccessRequest_one_pending_key");
  assert.ok(pending?.definition.includes("UNIQUE") && pending.definition.includes("pending"));
  for (const kind of ["requester", "service", "reviewer"]) {
    const key = constraints.find(item => item.name === "AccessRequest_" + kind + "_fkey");
    assert.ok(key?.definition.includes('"tenantId"') && key.definition.includes("ON DELETE RESTRICT"));
  }
  assert.ok(constraints.some(item => item.name === "AccessRequest_state_check" && item.definition.includes("resolvedAt")));
  assert.ok(indexes.some(item => item.table === "Service" && item.definition.includes("UNIQUE") && item.definition.includes('"tenantId", name')));
  assert.ok(indexes.some(item => item.table === "ServiceGrant" && item.definition.includes("UNIQUE") && item.definition.includes('"tenantId", "memberId", "serviceId"')));
  const files = ["prisma/schema.prisma", "prisma/migrations/20261003140000_service_access_requests/migration.sql",
    "src/server/company-management.ts", "src/server/service-management.ts", "src/server/access-requests.ts", "src/contracts/access-requests.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file =>
    [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "six management models; metadata and explicit tenant/state/uniqueness assertions, not all business acceptance",
    tables, columns, constraints, indexes, sourceFingerprints };
  await mkdir("docs/qa/R03-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R03-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length }));
} finally { await db.$disconnect(); }
