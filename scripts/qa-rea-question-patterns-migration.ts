import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const client = new Client({ connectionString: url.href });
const directory = "docs/qa/R08-T02/question-patterns";
try {
  await client.connect(); await mkdir(directory, { recursive: true });
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const migration = (await client.query(`SELECT finished_at IS NOT NULL AS applied FROM "_prisma_migrations" WHERE migration_name='20261025021000_question_patterns'`)).rows[0];
  assert.equal(migration?.applied, true);
  const questions = await client.query(`SELECT to_jsonb(q)-'infoPatternId' AS row, "infoPatternId" FROM "Question" q ORDER BY (to_jsonb(q)-'infoPatternId')::text`);
  assert(questions.rows.every(row => row.infoPatternId === null), "Pre-existing development questions must remain neutral");
  const hash = createHash("sha256").update(JSON.stringify(questions.rows.map(row => row.row))).digest("hex");
  const constraint = (await client.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='Question_info_pattern_check'`)).rows[0]?.definition as string;
  assert(constraint.includes("infoPatternId") && constraint.includes("subjectRole"));
  await client.query("COMMIT");
  const report = { checkedAt: new Date().toISOString(), result: "passed", existingQuestions: questions.rowCount, nonNeutralPatterns: 0,
    priorColumnsSha256: hash, migrationApplied: true, constraint,
    scope: "Local development PostgreSQL only. Existing Question rows were asserted NULL for the additive field and hashed without that field; no row was modified." };
  await writeFile(directory + "/upgrade-preservation.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", existingQuestions: questions.rowCount, nonNeutralPatterns: 0 }));
} finally { await client.end(); }
