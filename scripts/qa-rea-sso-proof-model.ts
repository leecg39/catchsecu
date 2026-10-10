import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const url = new URL(env.DATABASE_URL), tables = ["SsoLoginPolicy", "SsoSessionProof"];
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(url.pathname)); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
try {
  const columns = await db.$queryRaw<{ table: string; column: string; nullable: string }[]>`SELECT table_name AS "table", column_name AS "column", is_nullable AS nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}::text[]) ORDER BY table_name,ordinal_position`;
  const constraints = await db.$queryRaw<{ name: string; definition: string; validated: boolean }[]>`SELECT conname AS name,pg_get_constraintdef(oid) AS definition, convalidated AS validated FROM pg_constraint WHERE conrelid IN ('"SsoLoginPolicy"'::regclass,'"SsoSessionProof"'::regclass) ORDER BY conname`;
  const triggers = await db.$queryRaw<{ name: string; definition: string }[]>`SELECT tgname AS name,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='"SsoSessionProof"'::regclass AND NOT tgisinternal ORDER BY tgname`;
  assert.equal(columns.length, 11); assert.ok(columns.every(c => c.nullable === "NO"));
  for (const name of ["SsoLoginPolicy_tenantId_fkey", "SsoSessionProof_userId_sessionId_fkey", "SsoSessionProof_tenantId_providerId_fkey", "SsoSessionProof_providerId_accountId_userId_fkey", "SsoLoginPolicy_mode_check", "SsoLoginPolicy_version_check", "SsoSessionProof_identityProvider_check"]) assert.ok(constraints.some(c => c.name === name && c.validated), name);
  assert.ok(triggers.some(t => t.name === "sso_session_proof_immutable" && t.definition.includes("BEFORE UPDATE")));
  const count = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const report = { result: "passed", readOnly: true, checkedAt: new Date().toISOString(), database: url.pathname.slice(1), migrations: Number(count[0].count),
    scope: "Two new policy/provenance models; policy write API and runtime policy enforcement remain pending.", columns, constraints, triggers };
  await mkdir("docs/qa/R07-T01/session-evidence", { recursive: true });
  await writeFile(`docs/qa/R07-T01/session-evidence/${report.database}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log({ result: report.result, database: report.database, migrations: report.migrations, columns: columns.length, constraints: constraints.length });
} finally { await db.$disconnect(); }
