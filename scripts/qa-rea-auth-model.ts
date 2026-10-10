import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { passwordChangeInput, passwordDeferralInput, passwordResetInput } from "../src/contracts/security";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["User", "Account", "Session", "Verification", "TwoFactor", "RateLimit", "PasswordHistory", "PasswordDeferral"];
const requiredColumns: Record<string, string[]> = {
  User: ["id", "email", "emailVerified", "twoFactorEnabled", "status", "version", "passwordChangedAt"],
  Account: ["id", "providerId", "accountId", "userId", "password", "ssoProviderId"],
  Session: ["id", "token", "userId", "expiresAt", "updatedAt", "activeCompanyId", "activeServiceId"],
  Verification: ["id", "identifier", "value", "expiresAt"],
  TwoFactor: ["id", "userId", "secret", "backupCodes", "verified", "failedVerificationCount", "lockedUntil"],
  RateLimit: ["id", "key", "count", "lastRequest"],
  PasswordHistory: ["id", "userId", "passwordHash", "changedAt"],
  PasswordDeferral: ["id", "tenantId", "memberId", "userId", "passwordChangedAt", "passwordRevision", "mode", "sessionId", "expiresAt", "version"],
};
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
  for (const [table, expected] of Object.entries(requiredColumns))
    for (const column of expected) assert.ok(columns.some(item => item.table === table && item.column === column), `${table}.${column}`);
  for (const name of ["User_email_key", "Session_token_key", "Account_providerId_accountId_key", "Account_one_credential_per_user", "RateLimit_key_key", "PasswordDeferral_tenantId_memberId_key"])
    assert.ok(indexes.some(index => index.name === name && index.definition.includes("UNIQUE")), name);
  for (const table of ["Account", "Session", "TwoFactor", "PasswordHistory"])
    assert.ok(constraints.some(key => key.table === table && key.name === table + "_userId_fkey" && key.definition.includes("ON DELETE CASCADE")), table);
  assert.ok(constraints.some(key => key.table === "PasswordDeferral" && key.definition.includes('FOREIGN KEY ("tenantId", "memberId", "userId")')));
  assert.ok(constraints.some(key => key.name === "PasswordDeferral_mode" && key.definition.includes("sessionId")));
  assert.ok(constraints.some(key => key.name === "PasswordDeferral_version" && key.definition.includes("passwordRevision")));
  assert.ok(constraints.some(key => key.name === "User_email_normalized" && key.definition.includes("lower(email)")));
  assert.ok(constraints.some(key => key.name === "User_status_check" && ["active", "suspended", "closed"].every(status => key.definition.includes(status))));
  assert.ok(constraints.some(key => key.name === "Account_sso_provider_match"));
  assert.ok(indexes.some(index => index.table === "Verification" && index.definition.includes("identifier")));
  const credential = triggers.find(trigger => trigger.table === "Account" && trigger.function.includes("record_credential_change"));
  assert.ok(credential?.function.includes("session.ended") && credential.function.includes("PasswordHistory")
    && credential.function.includes('DELETE FROM "Verification"') && credential.function.includes('DELETE FROM "PasswordDeferral"'));
  assert.ok(triggers.some(trigger => trigger.table === "Session" && trigger.name === "session_active_account_guard"));
  assert.ok(passwordDeferralInput.safeParse({ tenantId: randomUUID(), passwordRevision: 1 }).success);
  assert.ok(!passwordDeferralInput.safeParse({ tenantId: randomUUID(), passwordRevision: 0 }).success);
  assert.ok(passwordChangeInput.safeParse({ currentPassword: "old", newPassword: "a".repeat(12), revokeOtherSessions: true }).success);
  assert.ok(!passwordChangeInput.safeParse({ currentPassword: "old", newPassword: "short" }).success);
  assert.ok(passwordResetInput.safeParse({ token: "x".repeat(16), newPassword: "a".repeat(12) }).success);
  assert.ok(!passwordResetInput.safeParse({ token: "short", newPassword: "a".repeat(12) }).success);
  const files = ["prisma/schema.prisma", "prisma/migrations/20261005090000_credential_audit/migration.sql",
    "src/contracts/security.ts", "src/server/auth.ts", "src/server/auth-adapter.ts", "src/server/auth-mutations.ts",
    "src/server/credential-lock.ts", "src/server/password-policy.ts", "src/server/password-deferral.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "Eight existing authentication models; read-only metadata, DTO, uniqueness, relation, deferral and credential-trigger assertions. Dynamic state transitions are verified separately; no new migration was required.",
    tables, columns, constraints, indexes, triggers,
    dtoContract: { passwordDeferral: "strict tenant UUID and positive policy revision", passwordChange: "strict current/new password and optional revoke flag", passwordReset: "strict new password and optional bounded token" },
    sourceFingerprints };
  await mkdir("docs/qa/R02-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R02-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length }));
} finally { await db.$disconnect(); }
