import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["SecurityPolicy", "IpRule", "IpAccessPolicy", "MfaException"];
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
  const triggers = await db.$queryRaw<{ table: string; name: string; definition: string; function: string }[]>`
    SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS definition, pg_get_functiondef(t.tgfoid) AS function
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY(${tables}::text[]) ORDER BY c.relname,t.tgname`;
  for (const table of tables) assert.ok(columns.some(column => column.table === table), table);
  for (const name of ["SecurityPolicy_pkey", "IpRule_tenantId_cidr_key", "MfaException_tenantId_memberId_key"])
    assert.ok(indexes.some(index => index.name === name && index.definition.includes("UNIQUE")), name);
  for (const name of ["IpRule_cidr_canonical", "IpRule_version_positive", "MfaException_lifetime", "MfaException_reason_encrypted", "MfaException_other_owner"])
    assert.ok(constraints.some(key => key.name === name), name);
  assert.equal(constraints.filter(key => key.table === "MfaException" && key.definition.startsWith("FOREIGN KEY") && key.definition.includes('"tenantId"')).length, 2);
  for (const table of ["IpRule", "IpAccessPolicy", "MfaException"])
    assert.ok(triggers.some(trigger => trigger.table === table && trigger.function.includes("version")), table);
  const files = ["prisma/schema.prisma", "prisma/migrations/20261004150000_ip_access_control/migration.sql", "prisma/migrations/20261004160000_mfa_exceptions/migration.sql",
    "src/server/security-policy.ts", "src/server/ip-access.ts", "src/server/mfa-policy.ts", "src/server/client-ip.ts", "src/server/context.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "Four existing company security policy/IP/MFA models; read-only metadata, unique keys, tenant relations, CIDR normalization, encrypted reasons, bounded lifetime and version guards. No new migration or claim of full R06 acceptance.",
    tables, columns, constraints, indexes, triggers, sourceFingerprints };
  await mkdir("docs/qa/R06-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R06-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length }));
} finally { await db.$disconnect(); }
