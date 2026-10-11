import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert(["localhost", "127.0.0.1"].includes(database.hostname));
const expectedColumns = { AuditEvent: 10, ActivityReview: 18, ActivityReviewMessage: 7 } as const;
const tables = Object.keys(expectedColumns);
const directory = "docs/qa/R22-T01/current";

function named<T extends { name: string }>(rows: T[], name: string) {
  const value = rows.find(row => row.name === name);
  assert.ok(value, name);
  return value;
}
function normalized(value: string) { return value.replaceAll('"', "").replace(/\s+/g, " "); }

try {
  const metadata = await db.$transaction(async tx => ({
    columns: await tx.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
      SELECT table_name AS "table", column_name AS "column", data_type AS type, is_nullable AS nullable
      FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}::text[])
      ORDER BY table_name,ordinal_position`,
    policyColumn: await tx.$queryRaw<{ column: string; type: string; nullable: string }[]>`
      SELECT column_name AS column,data_type AS type,is_nullable AS nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='SecurityPolicy' AND column_name='activityReviewRetentionDays'`,
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
    invalidReviewReferences: await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "ActivityReview" r
      LEFT JOIN "AuditEvent" a ON a."tenantId"=r."tenantId" AND a."serviceId"=r."serviceId"
        AND a.id=r."auditEventId" AND a."actorId"=r."recipientUserId"
      WHERE a.id IS NULL`,
  }), { isolationLevel: "Serializable", timeout: 15000 });

  for (const [table, count] of Object.entries(expectedColumns))
    assert.equal(metadata.columns.filter(row => row.table === table).length, count, `${table} columns`);
  assert.equal(metadata.columns.length, 35);
  assert.equal(metadata.policyColumn.length, 1);
  assert.ok(metadata.constraints.every(row => row.validated));
  assert.equal(metadata.invalidReviewReferences[0]?.count, 0);

  for (const [name, signature] of Object.entries({
    ActivityReview_auditEvent_fkey: "FOREIGN KEY (tenantId, serviceId, auditEventId, recipientUserId) REFERENCES AuditEvent(tenantId, serviceId, id, actorId)",
    ActivityReview_requester_fkey: "FOREIGN KEY (tenantId, requesterId) REFERENCES Membership(tenantId, id)",
    ActivityReview_recipient_fkey: "FOREIGN KEY (tenantId, recipientId, recipientUserId) REFERENCES Membership(tenantId, id, userId)",
    ActivityReviewMessage_review_fkey: "FOREIGN KEY (tenantId, reviewId) REFERENCES ActivityReview(tenantId, id)",
  })) assert.ok(normalized(named(metadata.constraints, name).definition).includes(signature), name);
  for (const name of ["ActivityReview_state", "ActivityReview_dates", "ActivityReview_destruction", "ActivityReviewMessage_kind"])
    named(metadata.constraints, name);
  for (const name of ["AuditEvent_tenantId_serviceId_id_actorId_key", "ActivityReview_tenantId_id_key", "ActivityReview_open_event_key"])
    assert.ok(named(metadata.indexes, name).definition.includes("UNIQUE"), name);
  for (const name of ["AuditEvent_tenantId_createdAt_id_idx", "ActivityReview_tenantId_recipientId_status_createdAt_id_idx",
    "ActivityReview_tenantId_requesterId_status_createdAt_id_idx", "ActivityReview_tenantId_serviceId_status_createdAt_id_idx",
    "ActivityReviewMessage_tenantId_reviewId_createdAt_id_idx", "ActivityReview_destructionStatus_retentionUntil_idx"])
    named(metadata.indexes, name);
  assert.ok(named(metadata.triggers, "audit_immutable").function.includes("Audit events are immutable"));
  assert.ok(named(metadata.triggers, "activity_review_message_immutable").function.includes("activity review messages are immutable"));
  assert.ok(named(metadata.triggers, "activity_review_transition").function.includes("invalid review transition"));
  for (const name of ["20261005070000_activity_reviews", "20261014000000_activity_review_retention",
    "20261014100000_activity_review_destruction_tighten"])
    assert.ok(metadata.migrations.some(row => row.name === name), name);

  const sourcePaths = ["prisma/schema.prisma", "src/contracts/audit-events.ts", "src/contracts/activity-reviews.ts",
    "src/server/audit.ts", "src/server/audit-events.ts", "src/server/audit-resources.ts", "src/server/form-audit-events.ts",
    "src/server/activity-reviews.ts", "src/components/management/AuditLogs.tsx", "src/components/management/ActivityReviews.tsx"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path,
    createHash("sha256").update(await readFile(path)).digest("hex")])));
  const definitions = { columns: metadata.columns, policyColumn: metadata.policyColumn, constraints: metadata.constraints,
    indexes: metadata.indexes, triggers: metadata.triggers };
  const report = { result: "passed", checkedAt: new Date().toISOString(), database: database.pathname.slice(1), models: tables,
    scope: "Read-only R22 audit ledger and activity-review metadata audit with immutable records, tenant/service/actor composite references, deterministic paging indexes, lifecycle constraints, retention evidence, migration identity, and live orphan check.",
    counts: { columns: metadata.columns.length, constraints: metadata.constraints.length, indexes: metadata.indexes.length,
      triggers: metadata.triggers.length, migrations: metadata.migrations.length, invalidReviewReferences: metadata.invalidReviewReferences[0]?.count ?? -1 },
    definitionHash: createHash("sha256").update(JSON.stringify(definitions)).digest("hex"),
    migrationHash: createHash("sha256").update(JSON.stringify(metadata.migrations)).digest("hex"), sourceHashes, definitions };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${report.database}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, models: tables.length, ...report.counts,
    definitionHash: report.definitionHash, migrationHash: report.migrationHash }));
} finally {
  await db.$disconnect();
}
