import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const client = new Client({ connectionString: url.href });
const directory = "docs/qa/R08-T02/question-metadata/consent-items";
try {
  await client.connect(); await mkdir(directory, { recursive: true });
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const migration = (await client.query(`SELECT finished_at IS NOT NULL AS applied FROM "_prisma_migrations"
    WHERE migration_name='20261025022000_form_consent_items'`)).rows[0];
  assert.equal(migration?.applied, true);
  const versions = await client.query(`SELECT to_jsonb(v)-'consentItemSchemaVersion'-'consentItems' AS row,
    "consentItemSchemaVersion", "consentItems" FROM "FormVersion" v
    ORDER BY (to_jsonb(v)-'consentItemSchemaVersion'-'consentItems')::text`);
  assert(versions.rows.every(row => row.consentItemSchemaVersion === 0 && row.consentItems === null),
    "Pre-migration versions must remain schema 0 with no invented items");
  const classified = (await client.query(`SELECT count(DISTINCT "formVersionId")::int AS versions, count(*)::int AS questions
    FROM "Question" WHERE "catchFormPersonalInformationRequests" IS NOT NULL`)).rows[0] as { versions: number; questions: number };
  const priorColumnsSha256 = createHash("sha256").update(JSON.stringify(versions.rows.map(row => row.row))).digest("hex");
  const constraint = (await client.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname='FormVersion_consent_items_check'`)).rows[0]?.definition as string;
  const triggers = (await client.query(`SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger
    WHERE tgname IN ('FormVersion_consent_items_projection','Question_consent_items_projection') ORDER BY tgname`)).rows;
  assert(constraint.includes("consentItemSchemaVersion") && constraint.includes("valid_form_consent_items"));
  assert.equal(triggers.length, 2); assert(triggers.every(row => row.definition.includes("DEFERRABLE INITIALLY DEFERRED")));
  await client.query("COMMIT");
  const report = { checkedAt: new Date().toISOString(), result: "passed", migrationApplied: true,
    existingVersions: versions.rowCount, legacySchemaZero: versions.rowCount, legacyClassifiedVersions: classified.versions,
    legacyClassifiedQuestions: classified.questions, priorColumnsSha256, constraint, triggers,
    scope: "Local development PostgreSQL only. Existing FormVersion rows, including prior manually classified versions, were checked as schema 0/NULL and hashed without the additive columns; no row was modified and no consent item was invented retroactively." };
  await writeFile(directory + "/upgrade-preservation.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", existingVersions: versions.rowCount, legacySchemaZero: versions.rowCount }));
} finally { await client.end(); }
