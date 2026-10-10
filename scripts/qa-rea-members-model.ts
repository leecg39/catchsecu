import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["Membership", "ServiceGrant", "Invitation", "ExpertAssignment", "ExpertAssignmentService"];
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
  for (const name of ["Membership_tenantId_userId_key", "ServiceGrant_tenantId_memberId_serviceId_key", "Invitation_tokenHash_key", "ExpertAssignment_tenant_user_key", "ExpertAssignmentService_scope_key"])
    assert.ok(indexes.some(index => index.name === name && index.definition.includes("UNIQUE")), name);
  assert.ok(indexes.some(index => index.name === "Invitation_pending_unique" && index.definition.includes("lower(email)") && index.definition.includes("pending")));
  for (const name of ["ServiceGrant_tenantId_memberId_fkey", "ServiceGrant_tenantId_serviceId_fkey", "ExpertAssignmentService_assignment_fkey", "ExpertAssignmentService_service_fkey", "Membership_expertAssignment_fkey"])
    assert.ok(constraints.some(key => key.name === name && key.definition.includes('"tenantId"')), name);
  assert.ok(constraints.some(key => key.name === "Invitation_status_check" && key.definition.includes("accepted")));
  assert.ok(constraints.some(key => key.name === "ExpertAssignment_state_check" && key.definition.includes('"revokedAt"')));
  assert.ok(triggers.some(trigger => trigger.table === "Membership" && trigger.function.includes("protect_last_company_owner") && trigger.function.includes("FOR UPDATE")));
  const files = ["prisma/schema.prisma", "prisma/migrations/20261002110000_last_owner_guard/migration.sql", "prisma/migrations/20261003150000_expert_assignments/migration.sql",
    "src/server/members.ts", "src/server/expert-assignments.ts", "src/contracts/members.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "Five existing membership/invitation/expert models; read-only metadata, uniqueness, tenant relations, state constraints and last-owner trigger assertions. No new migration or claim of full R04 acceptance.",
    tables, columns, constraints, indexes, triggers, sourceFingerprints };
  await mkdir("docs/qa/R04-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R04-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length }));
} finally { await db.$disconnect(); }
