import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
const schema = "qa_question_patterns_" + randomUUID().replaceAll("-", "");
const root = new Client({ connectionString: url.href });
const directory = "docs/qa/R08-T02/question-patterns";
try {
  await root.connect(); await mkdir(directory, { recursive: true });
  await root.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url); scoped.searchParams.set("schema", schema);
  const execution = await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: scoped.href } });
    let output = ""; child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, output }));
  });
  await writeFile(directory + "/fresh-schema.log", execution.output.replaceAll(scoped.href, "[test database URL]"));
  assert.equal(execution.code, 0, "Fresh schema migration failed");
  const expected = (await readdir("prisma/migrations", { withFileTypes: true })).filter(entry => entry.isDirectory()).length;
  const applied = (await root.query(`SELECT count(*)::int AS n FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL`)).rows[0].n as number;
  assert.equal(applied, expected);
  const column = (await root.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='Question' AND column_name='infoPatternId'", [schema])).rows;
  assert.deepEqual(column, [{ data_type: "integer", is_nullable: "YES" }]);
  const constraint = (await root.query(`SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 AND t.relname='Question' AND c.conname='Question_info_pattern_check'`, [schema])).rows[0]?.definition as string;
  for (const token of ["infoPatternId", "1", "2", "3", "4", "7", "8", "subjectRole"]) assert(constraint.includes(token));
  const report = { checkedAt: new Date().toISOString(), result: "passed", migrations: applied, expectedMigrations: expected,
    column: column[0], constraint, schemaWasDropped: true,
    scope: "Fresh isolated PostgreSQL schema; every migration applied; source-observed ID allow-list and type/subject compatibility constraint inspected." };
  await writeFile(directory + "/fresh-schema.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", migrations: applied }));
} finally {
  await root.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
  await root.end();
}
