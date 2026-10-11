import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["SsoProvider", "SsoState", "VirtualOrgMember", "Account", "Session", "IdempotencyRecord", "SsoLoginPolicy", "SsoSessionProof", "SsoPolicyChallenge", "OrgEmailChallenge", "SsoSignupIntent", "SsoSignupAcceptance"];
try {
  const columns = await db.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
    SELECT table_name AS "table", column_name AS "column", data_type AS type, is_nullable AS nullable
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}::text[])
    ORDER BY table_name, ordinal_position`;
  const constraints = await db.$queryRaw<{ table: string; name: string; definition: string; validated: boolean }[]>`
    SELECT c.relname AS "table", k.conname AS name, pg_get_constraintdef(k.oid) AS definition, k.convalidated AS validated
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
  assert.ok(constraints.every(key => key.validated));
  for (const name of ["SsoLoginPolicy_tenantId_fkey", "SsoLoginPolicy_mode_check", "SsoLoginPolicy_version_check",
    "SsoSessionProof_userId_sessionId_fkey", "SsoSessionProof_tenantId_providerId_fkey", "SsoSessionProof_providerId_accountId_userId_fkey", "SsoSessionProof_identityProvider_check",
    "SsoPolicyChallenge_tenantId_fkey", "SsoPolicyChallenge_userId_sessionId_fkey", "SsoPolicyChallenge_mode_check", "SsoPolicyChallenge_version_check", "SsoPolicyChallenge_attempts_check", "SsoPolicyChallenge_hash_check", "SsoPolicyChallenge_expiry_check",
    "OrgEmailChallenge_tenantId_stateId_fkey", "OrgEmailChallenge_attempts_check", "OrgEmailChallenge_hash_check", "OrgEmailChallenge_expiry_check"])
    assert.ok(constraints.some(key => key.name === name), name);
  assert.ok(triggers.some(trigger => trigger.name === "sso_session_proof_immutable" && trigger.definition.includes("BEFORE UPDATE")));
  const migrationRows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const migrations = Number(migrationRows[0].count); assert.equal(migrations, 149);
  for (const name of ["SsoSignupIntent_tenantId_providerId_fkey", "SsoSignupIntent_version_check", "SsoSignupIntent_mode_check", "SsoSignupIntent_hash_check", "SsoSignupIntent_payload_check", "SsoSignupIntent_expiry_check", "SsoSignupAcceptance_userId_fkey", "SsoSignupAcceptance_consent_check"])
    assert.ok(constraints.some(key => key.name === name), name);
  for (const name of ["SsoSignupIntent_stateId_key", "SsoSignupIntent_tokenHash_key"])
    assert.ok(indexes.some(index => index.name === name && index.definition.includes("UNIQUE")), name);
  const files = ["src/server/sso-signup.ts", "src/contracts/sso-signup.ts", "prisma/migrations/20261025030000_sso_signup_consent/migration.sql", "prisma/schema.prisma", "src/contracts/sso.ts", "src/server/sso.ts", "src/server/org-auth.ts", "src/server/idempotency.ts", "src/server/sso-session-proof.ts", "src/server/sso-login-policy.ts", "src/server/sso-identity.ts", "src/server/org-email-mail.ts", "src/contracts/sso-login-policy.ts", "src/server/sso-provider-lifecycle.ts", "src/server/sso-transport.ts", "src/server/public-network.ts",
    "prisma/migrations/20261014110000_sso_state_binding/migration.sql", "prisma/migrations/20261014120000_sso_invitation_binding/migration.sql",
    "prisma/migrations/20261014130000_sso_account_provider_reference/migration.sql", "prisma/migrations/20261016000000_virtual_org_auth/migration.sql",
    "prisma/migrations/20261016100000_virtual_org_protocols/migration.sql"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "Twelve current SSO/directory/account/session/idempotency/policy/challenge/provenance/signup models. Read-only tenant FK, uniqueness, binding and protocol constraints. Expiry/nonce/version consumption also relies on the server transaction checks. orgMemberId is application-checked, not a database FK. Signup consent migration included. No claim of original login-policy/external institution acceptance.",
    migrations, tables, columns, constraints, indexes, triggers, sourceFingerprints };
  await mkdir("docs/qa/R07-T01/current", { recursive: true });
  await writeFile("docs/qa/R07-T01/current/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length }));
} finally { await db.$disconnect(); }
