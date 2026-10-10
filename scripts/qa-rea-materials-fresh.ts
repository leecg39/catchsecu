import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const schema = "qa_materials_fresh_" + randomUUID().replaceAll("-", "");
const client = new Client({ connectionString: url.href });
const directory = "docs/qa/R08-T02/question-metadata/reference-link";
try {
  await client.connect(); await mkdir(directory, { recursive: true });
  await client.query('CREATE SCHEMA "' + schema + '"');
  url.searchParams.set("schema", schema);
  const execution = await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.href } });
    let output = ""; child.stdout.on("data", value => { output += value; }); child.stderr.on("data", value => { output += value; });
    child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, output }));
  });
  await writeFile(directory + "/fresh-schema.log", execution.output.replaceAll(url.href, "[test database URL]"));
  assert.equal(execution.code, 0, "Fresh schema migration failed");
  const count = (await client.query('SELECT count(*)::int AS n FROM "' + schema + '"."_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].n;
  assert.equal(count, 119);
  const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='Question'", [schema])).rows.map(row => row.column_name);
  assert(columns.includes("materialList"));
  await writeFile(directory + "/fresh-schema.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", migrations: count, schema,
    scope: "New, empty dedicated schema; no reset or modification of existing schemas. Retained for inspection." }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", migrations: count, schema }));
} finally { await client.end(); }
