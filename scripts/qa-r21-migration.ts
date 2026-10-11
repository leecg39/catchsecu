import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { env } from "../src/server/env";

const source = new URL(env.DATABASE_URL);
assert(["/catchsecu_dev", "/catchsecu_test"].includes(source.pathname));
assert(["localhost", "127.0.0.1"].includes(source.hostname));
const schema = `catchsecu_r21_migration_${process.pid}`;
const quotedSchema = `"${schema}"`;
const test = new Client({ connectionString: source.toString() });
let connected = false;

try {
  await test.connect();
  connected = true;
  await test.query(`CREATE SCHEMA ${quotedSchema}`);
  await test.query(`SET search_path TO ${quotedSchema}`);
  await test.query(`
    CREATE TABLE "BillingSubscription" (
      id text PRIMARY KEY,
      "tenantId" text NOT NULL,
      UNIQUE ("tenantId", id)
    );
    CREATE TABLE "PaymentOrder" (
      id text PRIMARY KEY,
      "tenantId" text NOT NULL,
      "subscriptionId" text NOT NULL,
      CONSTRAINT "PaymentOrder_subscription_fkey"
        FOREIGN KEY ("subscriptionId") REFERENCES "BillingSubscription"(id)
    );
    INSERT INTO "BillingSubscription" (id, "tenantId") VALUES ('subscription-b', 'tenant-b');
    INSERT INTO "PaymentOrder" (id, "tenantId", "subscriptionId") VALUES ('bad-before', 'tenant-a', 'subscription-b');
  `);
  const migration = await readFile("prisma/migrations/20261025031000_payment_order_subscription_scope/migration.sql", "utf8");
  const blocked = await test.query(migration).then(
    () => ({ blocked: false, code: null, message: null }),
    (error: { code?: string; message?: string }) => ({ blocked: true, code: error.code ?? null, message: error.message ?? null }),
  );
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.message?.includes("PAYMENT_ORDER_SUBSCRIPTION_TENANT_MISMATCH"));
  const before = await test.query<{ definition: string }>(`
    SELECT pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE constraint_row.conname = 'PaymentOrder_subscription_fkey' AND namespace_row.nspname = $1`, [schema]);
  assert.ok(before.rows[0].definition.includes('FOREIGN KEY ("subscriptionId")'));

  await test.query(`DELETE FROM "PaymentOrder" WHERE id = 'bad-before'`);
  await test.query(migration);
  const after = await test.query<{ definition: string }>(`
    SELECT pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE constraint_row.conname = 'PaymentOrder_subscription_fkey' AND namespace_row.nspname = $1`, [schema]);
  assert.ok(after.rows[0].definition.includes('FOREIGN KEY ("tenantId", "subscriptionId")'));
  const rejected = await test.query(
    `INSERT INTO "PaymentOrder" (id, "tenantId", "subscriptionId") VALUES ('bad-after', 'tenant-a', 'subscription-b')`,
  ).then(() => ({ rejected: false, code: null }), (error: { code?: string }) => ({ rejected: true, code: error.code ?? null }));
  assert.deepEqual(rejected, { rejected: true, code: "23503" });
  await test.query(`INSERT INTO "PaymentOrder" (id, "tenantId", "subscriptionId") VALUES ('valid-after', 'tenant-b', 'subscription-b')`);

  const report = {
    result: "passed",
    checkedAt: new Date().toISOString(),
    databaseLifecycle: "temporary isolated local schema created and dropped",
    dirtyDatabaseBlocked: blocked,
    originalConstraint: before.rows[0].definition,
    migratedConstraint: after.rows[0].definition,
    crossTenantInsertAfterMigration: rejected,
    sameTenantInsertAfterMigration: "accepted",
  };
  await mkdir("docs/qa/R21-T01/current", { recursive: true });
  await writeFile("docs/qa/R21-T01/current/migration-guard.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  if (connected) {
    await test.query("SET search_path TO public").catch(() => undefined);
    await test.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => undefined);
    await test.end();
  }
}
