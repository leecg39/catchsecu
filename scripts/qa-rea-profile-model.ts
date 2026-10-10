import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["User", "Session", "Account", "AccountClosure", "ActivityReview", "ActivityReviewMessage"];
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
  for (const name of ["User_email_key", "Session_token_key", "Account_providerId_accountId_key", "AccountClosure_userId_key", "ActivityReview_tenantId_id_key"])
    assert.ok(indexes.some(index => index.name === name && index.definition.includes("UNIQUE")), name);
  assert.ok(indexes.some(index => index.name === "ActivityReview_open_event_key" && index.definition.includes("requested") && index.definition.includes("responded")));
  for (const name of ["ActivityReview_service_fkey", "ActivityReview_auditEvent_fkey", "ActivityReview_recipient_fkey", "ActivityReviewMessage_review_fkey", "ActivityReviewMessage_author_fkey"])
    assert.ok(constraints.some(key => key.name === name && key.definition.includes('"tenantId"')), name);
  for (const name of ["ActivityReview_state", "ActivityReview_dates", "ActivityReview_destruction", "ActivityReviewMessage_kind", "AccountClosure_time_check"])
    assert.ok(constraints.some(key => key.name === name), name);
  assert.ok(triggers.some(trigger => trigger.table === "User" && trigger.function.includes("OWNERSHIP_TRANSFER_REQUIRED") && trigger.function.includes("PLATFORM_ADMIN_REQUIRED")));
  assert.ok(triggers.some(trigger => trigger.table === "Session" && trigger.function.includes("ACCOUNT_UNAVAILABLE")));
  assert.ok(triggers.some(trigger => trigger.table === "AccountClosure" && trigger.function.includes("ACCOUNT_CLOSURE_IMMUTABLE")));
  assert.ok(triggers.some(trigger => trigger.table === "ActivityReviewMessage" && trigger.function.includes("app.activity_review_destroy") && trigger.function.includes("awaiting")));
  assert.ok(triggers.some(trigger => trigger.table === "ActivityReview" && trigger.function.includes("terminal review destruction state") && trigger.function.includes("invalid version")));
  const files = ["prisma/schema.prisma", "prisma/migrations/20261003190000_account_closure/migration.sql", "prisma/migrations/20261005070000_activity_reviews/migration.sql",
    "prisma/migrations/20261014000000_activity_review_retention/migration.sql", "prisma/migrations/20261014100000_activity_review_destruction_tighten/migration.sql",
    "src/app/api/v1/me/route.ts", "src/server/account-closure.ts", "src/server/account-actor.ts", "src/server/activity-reviews.ts", "src/server/activity-review-mail.ts", "src/server/sso-accounts.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "Six existing profile/session/account/closure/review models; read-only metadata, unique keys, tenant relations, immutable messages, destruction approval and account closure guards. No new migration or claim of full R05 acceptance.",
    tables, columns, constraints, indexes, triggers, sourceFingerprints };
  await mkdir("docs/qa/R05-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R05-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length }));
} finally { await db.$disconnect(); }
