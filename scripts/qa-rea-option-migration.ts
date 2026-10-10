import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const client = new Client({ connectionString: url.href }), directory = "docs/qa/R08-T02/identities";
const tables = ["FormVersion", "Question", "QuestionOption", "Answer", "ApprovalRequest", "CorrectionPayload", "ConsentReceipt", "FormTemplate"];
type Summary = { count: number; sha256: string };
const mode = process.argv[2]; assert(["before", "after"].includes(mode));
try {
  await mkdir(directory, { recursive: true }); await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const result: Record<string, Summary> = {};
  for (const table of tables) {
    const projection = table === "FormVersion" ? "to_jsonb(t)-'optionSchemaVersion'" : table === "QuestionOption" ? "to_jsonb(t)-'stableKey'-'label'" : "to_jsonb(t)";
    const rows = (await client.query(`SELECT ${projection} AS row FROM "${table}" t ORDER BY (${projection})::text`)).rows.map(item => item.row);
    result[table] = { count: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  if (mode === "after") {
    assert.equal((await client.query('SELECT count(*)::int AS n FROM "FormVersion" WHERE "optionSchemaVersion"<>0')).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM "QuestionOption" WHERE "stableKey" IS NOT NULL OR label IS NOT NULL')).rows[0].n, 0);
    const before = JSON.parse(await readFile(directory + "/migration-before.json", "utf8"));
    assert.deepEqual(result, before.tables, "Existing data changed during additive migration");
  }
  await client.query("COMMIT");
  const report = { checkedAt: new Date().toISOString(), result: "passed", mode, tables: result,
    scope: "All existing rows, excluding only three newly added columns; after additionally asserts their legacy zero/null defaults. No plaintext data exported." };
  await writeFile(directory + "/migration-" + mode + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ result: "passed", mode, tables: Object.keys(result).length }));
} finally { await client.end(); }
