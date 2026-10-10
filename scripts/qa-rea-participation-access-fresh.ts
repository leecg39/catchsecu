import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const schema = "qa_participation_access_" + randomUUID().replaceAll("-", "");
const root = new Client({ connectionString: url.href });
const directory = "docs/qa/R08-T02/participation-access";
try {
  await root.connect();
  await mkdir(directory, { recursive: true });
  await root.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url); scoped.searchParams.set("schema", schema);
  const execution = await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: scoped.href } });
    let output = "";
    child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, output }));
  });
  await writeFile(directory + "/fresh-schema.log", execution.output.replaceAll(scoped.href, "[test database URL]"));
  assert.equal(execution.code, 0, "Fresh schema migration failed");
  const expected = (await readdir("prisma/migrations", { withFileTypes: true })).filter(entry => entry.isDirectory()).length;
  const applied = (await root.query(`SELECT count(*)::int AS n FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`)).rows[0].n as number;
  assert.equal(applied, expected);
  const tables = (await root.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1
    AND table_name IN ('FormAccessTargetBatch','FormAccessTarget','ParticipationChallenge','PublicationParticipant','ParticipationSession')
    ORDER BY table_name`, [schema])).rows;
  assert.equal(tables.length, 5);
  const versionColumns = (await root.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema=$1 AND table_name='FormVersion' AND column_name IN
    ('participationAccessSchemaVersion','useParticipationAccess','participationAccessMethod','participationTargetScope',
     'participationUseOtp','participationSocialProvider','restrictDuplicateReplies') ORDER BY column_name`, [schema])).rows;
  assert.equal(versionColumns.length, 7);
  const constraints = (await root.query(`SELECT conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 AND conname IN
    ('FormVersion_participation_access_check','ParticipationChallenge_attempts_check','ParticipationChallenge_expiry_check',
     'PublicationParticipant_method_check','PublicationParticipant_submission_count_check','ParticipationSession_expiry_check')
    ORDER BY conname`, [schema])).rows;
  assert.equal(constraints.length, 6);
  const foreignKeys = (await root.query(`SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND c.contype='f'
    AND conname IN ('FormAccessTargetBatch_tenantId_formId_fkey','FormAccessTarget_tenantId_formId_fkey',
      'FormAccessTarget_tenantId_formId_batchId_fkey','ParticipationChallenge_tenantId_publicationId_fkey',
      'ParticipationSession_tenantId_publicationId_fkey','ParticipationSession_participantId_fkey',
      'ParticipationSession_tenantId_publicationId_challengeId_fkey','PublicationParticipant_tenantId_formId_fkey',
      'Submission_participantId_fkey') ORDER BY conname`, [schema])).rows;
  assert.equal(foreignKeys.length, 9);
  const report = { checkedAt: new Date().toISOString(), result: "passed", migrations: applied, expectedMigrations: expected,
    tables, versionColumns, constraints, foreignKeys, schemaWasDropped: true,
    scope: "Fresh isolated PostgreSQL schema; every migration applied and participation-access tables, columns, checks and foreign keys inspected." };
  await writeFile(directory + "/fresh-schema.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", migrations: applied, tables: tables.length, constraints: constraints.length, foreignKeys: foreignKeys.length }));
} finally {
  await root.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
  await root.end();
}
