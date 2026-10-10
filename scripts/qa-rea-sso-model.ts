import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["SsoProvider", "SsoState", "VirtualOrgMember", "Account", "Session", "IdempotencyRecord"];
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
  for (const name of ["SsoProvider_tenantId_id_key", "SsoState_stateHash_key", "VirtualOrgMember_orgCode_employeeNo_key", "Account_providerId_accountId_key", "IdempotencyRecord_scope_key_key"])
    assert.ok(indexes.some(index => index.name === name && index.definition.includes("UNIQUE")), name);
  for (const name of ["SsoState_tenantId_providerId_fkey", "VirtualOrgMember_tenantId_providerId_fkey"])
    assert.ok(constraints.some(key => key.name === name && key.definition.includes('"tenantId"') && key.definition.includes("ON DELETE CASCADE")), name);
  for (const name of ["SsoState_mode_check", "SsoState_binding_check", "SsoState_invitation_binding_check", "SsoProvider_protocol_check", "SsoProvider_urls_https", "Account_sso_provider_match"])
    assert.ok(constraints.some(key => key.name === name), name);
  assert.ok(constraints.some(key => key.name === "SsoState_userId_sessionId_fkey" && key.definition.includes("ON DELETE CASCADE")));
  assert.ok(constraints.some(key => key.name === "Account_ssoProviderId_fkey" && key.definition.includes("ON DELETE RESTRICT")));
  assert.ok(triggers.some(trigger => trigger.name === "Account_derive_sso_provider"));
  for (const [table, column] of [["SsoProvider", "clientSecretCipher"], ["SsoState", "verifierCipher"], ["SsoState", "expiresAt"], ["VirtualOrgMember", "nameCipher"], ["VirtualOrgMember", "emailCipher"], ["VirtualOrgMember", "pinHash"]])
    assert.ok(columns.some(item => item.table === table && item.column === column));
  const files = ["prisma/schema.prisma", "src/contracts/sso.ts", "src/server/sso.ts", "src/server/org-auth.ts", "src/server/idempotency.ts",
    "prisma/migrations/20261014110000_sso_state_binding/migration.sql", "prisma/migrations/20261014120000_sso_invitation_binding/migration.sql",
    "prisma/migrations/20261014130000_sso_account_provider_reference/migration.sql", "prisma/migrations/20261016000000_virtual_org_auth/migration.sql",
    "prisma/migrations/20261016100000_virtual_org_protocols/migration.sql"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "Six existing SSO/directory/account/session/idempotency models. Read-only tenant FK, uniqueness, binding and protocol constraints. Expiry/nonce/version consumption also relies on the server transaction checks. orgMemberId is application-checked, not a database FK. No new migration or claim of original login-policy/external institution acceptance.",
    tables, columns, constraints, indexes, triggers, sourceFingerprints };
  await mkdir("docs/qa/R07-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R07-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length }));
} finally { await db.$disconnect(); }
