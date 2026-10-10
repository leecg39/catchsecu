import assert from "node:assert/strict";
import { Client } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
const url = new URL(process.env.DATABASE_URL!);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(url.pathname)); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const connection = new Client({ connectionString: url.href }), directory = "docs/qa/R06-T01/security-entitlements";
try {
  await connection.connect(); await mkdir(directory, { recursive: true });
  const columns = (await connection.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='BillingPlanVersion' AND column_name='capabilities'")).rows;
  assert.equal(columns.length, 1); assert.equal(columns[0].is_nullable, "NO"); assert.equal(columns[0].data_type, "ARRAY");
  const constraints = (await connection.query("SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='BillingPlanVersion_capabilities_check'")).rows;
  assert.equal(constraints.length, 1); assert.equal(constraints[0].convalidated, true);
  const triggers = (await connection.query("SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname='billing_plan_version_immutable' AND tgrelid='\"BillingPlanVersion\"'::regclass")).rows;
  assert.equal(triggers.length, 1); assert.equal(triggers[0].tgenabled, "O");
  const plans = (await connection.query("SELECT id,capabilities FROM \"BillingPlanVersion\" WHERE id IN ('trial-v1','privacy-lifecycle-month-v1','privacy-lifecycle-year-v1','policy-management-month-v1','policy-management-year-v1') ORDER BY id")).rows;
  assert.equal(plans.length, 5);
  for (const plan of plans) assert.equal(plan.capabilities.length, plan.id === "trial-v1" ? 3 : 1);
  const migrations = Number((await connection.query('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count);
  assert.ok(migrations >= 105);
  const report = { checkedAt: new Date().toISOString(), database: url.pathname.slice(1), readOnly: true, columns, constraints, triggers, plans, migrations, passed: true };
  await writeFile(directory + "/" + url.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n"); console.log({ database: report.database, migrations, passed: true });
} finally { await connection.end(); }
