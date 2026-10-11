import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert(["localhost", "127.0.0.1"].includes(database.hostname));

const expectedColumns = {
  BillingMonthClose: 7,
  BillingPlan: 4,
  BillingPlanVersion: 16,
  BillingSubscription: 14,
  BillingSubscriptionEvent: 6,
  CreditAccount: 6,
  LedgerEntry: 6,
  LedgerTransaction: 10,
  PaymentEvent: 5,
  PaymentMethod: 12,
  PaymentOrder: 10,
  PaymentRefund: 11,
} as const;
const tables = Object.keys(expectedColumns);
const directory = "docs/qa/R21-T01/current";

function findNamed<T extends { name: string }>(rows: T[], name: string) {
  const row = rows.find(item => item.name === name);
  assert.ok(row, name);
  return row;
}

function normalized(value: string) {
  return value.replaceAll('"', "").replace(/\s+/g, " ");
}

try {
  const metadata = await db.$transaction(async tx => ({
    columns: await tx.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
      SELECT table_name AS "table", column_name AS "column", data_type AS type, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY(${tables}::text[])
      ORDER BY table_name, ordinal_position`,
    constraints: await tx.$queryRaw<{ table: string; name: string; definition: string; validated: boolean }[]>`
      SELECT c.relname AS "table", k.conname AS name, pg_get_constraintdef(k.oid) AS definition, k.convalidated AS validated
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${tables}::text[])
      ORDER BY c.relname, k.conname`,
    indexes: await tx.$queryRaw<{ table: string; name: string; definition: string }[]>`
      SELECT tablename AS "table", indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY(${tables}::text[])
      ORDER BY tablename, indexname`,
    triggers: await tx.$queryRaw<{ table: string; name: string; definition: string; function: string }[]>`
      SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS definition,
        pg_get_functiondef(t.tgfoid) AS function
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND c.relname = ANY(${tables}::text[])
      ORDER BY c.relname, t.tgname`,
    migrations: await tx.$queryRaw<{ name: string; checksum: string }[]>`
      SELECT migration_name AS name, checksum
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`,
    crossTenantOrders: await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "PaymentOrder" payment_order
      JOIN "BillingSubscription" subscription ON subscription.id = payment_order."subscriptionId"
      WHERE payment_order."tenantId" <> subscription."tenantId"`,
  }), { isolationLevel: "Serializable", timeout: 15000 });

  for (const [table, count] of Object.entries(expectedColumns))
    assert.equal(metadata.columns.filter(row => row.table === table).length, count, `${table} columns`);
  assert.equal(metadata.columns.length, 107);
  assert.ok(metadata.constraints.every(row => row.validated), "all constraints validated");
  assert.equal(metadata.crossTenantOrders[0]?.count, 0, "cross-tenant payment orders");

  const subscriptionRelation = findNamed(metadata.constraints, "PaymentOrder_subscription_fkey");
  assert.ok(normalized(subscriptionRelation.definition).includes("FOREIGN KEY (tenantId, subscriptionId) REFERENCES BillingSubscription(tenantId, id)"));
  const methodRelation = findNamed(metadata.constraints, "PaymentOrder_method_fkey");
  assert.ok(normalized(methodRelation.definition).includes("FOREIGN KEY (tenantId, methodId) REFERENCES PaymentMethod(tenantId, id)"));
  const refundRelation = findNamed(metadata.constraints, "PaymentRefund_order_fkey");
  assert.ok(normalized(refundRelation.definition).includes("FOREIGN KEY (tenantId, orderId) REFERENCES PaymentOrder(tenantId, id)"));

  for (const name of [
    "BillingPlanVersion_cycle_check",
    "BillingPlanVersion_currency_check",
    "BillingSubscription_check",
    "BillingSubscription_status_check",
    "PaymentMethod_shape",
    "PaymentOrder_status",
    "PaymentEvent_outcome",
    "PaymentRefund_shape",
    "BillingMonthClose_shape",
    "CreditAccount_available_check",
    "CreditAccount_held_check",
    "LedgerTransaction_shape_check",
    "LedgerEntry_account_check",
  ]) findNamed(metadata.constraints, name);

  for (const name of [
    "BillingPlanVersion_planId_number_cycle_key",
    "billing_subscription_live_plan",
    "BillingSubscriptionEvent_subscriptionId_version_key",
    "PaymentMethod_single_default",
    "PaymentMethod_tokenHash_key",
    "PaymentEvent_providerEventId_key",
    "PaymentRefund_tenant_id",
    "BillingMonthClose_key",
    "LedgerTransaction_tenantId_kind_sourceKind_sourceId_key",
    "LedgerEntry_transactionId_account_key",
  ]) assert.ok(findNamed(metadata.indexes, name).definition.includes("UNIQUE"), name);

  const triggerExpectations = {
    billing_plan_version_immutable: "BILLING_PLAN_VERSION_IMMUTABLE",
    billing_subscription_guard: "BILLING_PRICE_MISMATCH",
    billing_subscription_event_guard: "BILLING_EVENT_IMMUTABLE",
    PaymentMethod_guard: "immutable payment method token",
    PaymentRefund_guard: "REFUND_EXCEEDS_PAID",
    BillingMonthClose_guard: "MONTH_CLOSE_IMMUTABLE",
    credit_account_guard: "CREDIT_ACCOUNT_DIRECT_CHANGE_DENIED",
    ledger_transaction_immutable: "LEDGER_TRANSACTION_IMMUTABLE",
    ledger_entry_guard: "LEDGER_ENTRY_DIRECT_CHANGE_DENIED",
    post_ledger_transaction: "REFUND_EXCEEDS_BALANCE",
  } as const;
  for (const [name, signature] of Object.entries(triggerExpectations))
    assert.ok(findNamed(metadata.triggers, name).function.includes(signature), `${name} function`);
  assert.equal(metadata.triggers.length, 10);
  assert.ok(metadata.migrations.some(row => row.name === "20261025031000_payment_order_subscription_scope"));
  assert.ok(metadata.migrations.length >= 150);

  const sources = [
    "prisma/schema.prisma",
    "src/contracts/admin-plans.ts",
    "src/contracts/billing-history.ts",
    "src/contracts/billing-settlement.ts",
    "src/contracts/ledger.ts",
    "src/contracts/payment-events.ts",
    "src/contracts/payment-methods.ts",
    "src/contracts/subscriptions.ts",
    "src/server/admin-plans.ts",
    "src/server/billing-history.ts",
    "src/server/billing-reads.ts",
    "src/server/billing-settlement.ts",
    "src/server/ledger.ts",
    "src/server/payment-methods.ts",
    "src/server/payments.ts",
    "src/server/subscription-worker.ts",
    "src/server/subscriptions.ts",
  ];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [
    path, createHash("sha256").update(await readFile(path)).digest("hex"),
  ])));
  const definitions = {
    columns: metadata.columns,
    constraints: metadata.constraints,
    indexes: metadata.indexes,
    triggers: metadata.triggers,
  };
  const definitionHash = createHash("sha256").update(JSON.stringify(definitions)).digest("hex");
  const migrationHash = createHash("sha256").update(JSON.stringify(metadata.migrations)).digest("hex");
  const report = {
    result: "passed",
    checkedAt: new Date().toISOString(),
    database: database.pathname.slice(1),
    models: tables,
    scope: "Read-only R21 billing and double-entry ledger metadata audit with tenant-scoped payment relations, validated constraints, unique indexes, trigger signatures, migration identity, and live cross-tenant data check.",
    counts: {
      columns: metadata.columns.length,
      constraints: metadata.constraints.length,
      indexes: metadata.indexes.length,
      triggers: metadata.triggers.length,
      migrations: metadata.migrations.length,
      crossTenantOrders: metadata.crossTenantOrders[0]?.count ?? -1,
    },
    definitionHash,
    migrationHash,
    sourceHashes,
    definitions,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${report.database}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, models: tables.length, ...report.counts, definitionHash, migrationHash }));
} finally {
  await db.$disconnect();
}
