import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["User", "Account", "Session", "Verification", "TwoFactor", "RateLimit", "PasswordHistory", "PasswordDeferral"];
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
  for (const name of ["User_email_key", "Session_token_key", "Account_providerId_accountId_key", "RateLimit_key_key", "PasswordDeferral_tenantId_memberId_key"])
    assert.ok(indexes.some(index => index.name === name && index.definition.includes("UNIQUE")), name);
  for (const table of ["Account", "Session", "TwoFactor", "PasswordHistory"])
    assert.ok(constraints.some(key => key.table === table && key.name === table + "_userId_fkey" && key.definition.includes("ON DELETE CASCADE")), table);
  assert.ok(constraints.some(key => key.table === "PasswordDeferral" && key.definition.includes('FOREIGN KEY ("tenantId", "memberId", "userId")')));
  assert.ok(constraints.some(key => key.name === "PasswordDeferral_mode" && key.definition.includes("sessionId")));
  assert.ok(indexes.some(index => index.table === "Verification" && index.definition.includes("identifier")));
  const credential = triggers.find(trigger => trigger.table === "Account" && trigger.function.includes("record_credential_change"));
  assert.ok(credential?.function.includes("session.ended") && credential.function.includes("PasswordHistory") && credential.function.includes('DELETE FROM "Verification"'));
  const files = ["prisma/schema.prisma", "prisma/migrations/20261005090000_credential_audit/migration.sql",
    "src/server/auth.ts", "src/server/auth-adapter.ts", "src/server/auth-mutations.ts", "src/server/credential-lock.ts", "src/server/password-policy.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "Eight existing authentication models; read-only metadata, uniqueness, relation, deferral and credential-trigger assertions. No new migration or claim of full R02 acceptance.",
    tables, columns, constraints, indexes, triggers, sourceFingerprints };
  await mkdir("docs/qa/R02-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R02-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length }));
} finally { await db.$disconnect(); }
