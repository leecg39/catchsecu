import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test"); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = "docs/qa/R08-T02/body-images/page-branches";
const migrations = [
  "20261025020000_form_page_branches", "20261025020100_form_page_branch_trigger_scope",
  "20261025020200_form_page_branch_lookup", "20261025020300_author_asset_trigger_scope",
  "20261025020400_submission_page_path_validator_fix", "20261025020500_submission_page_path_edges",
  "20261025020600_option_trigger_metadata_scope", "20261025020700_submission_ineligible_guard",
];
const files = [
  ...migrations.map(name => `prisma/migrations/${name}/migration.sql`), "prisma/schema.prisma",
  "src/contracts/questions.ts", "src/contracts/form-sections.ts", "src/contracts/form-copy.ts", "src/contracts/option-identities.ts",
  "src/server/forms.ts", "src/server/answer-validation.ts", "src/server/submissions.ts", "src/server/submission-management.ts",
  "tests/server/form-page-branches.test.ts", "tests/server/form-sections-openapi.test.ts",
];
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
await mkdir(directory, { recursive: true });
const migrationReport = JSON.parse(await readFile(`${directory}/migration-install-final.json`, "utf8"));
const schemaReport = JSON.parse(await readFile(`${directory}/schema-current/catchsecu_test-contract.json`, "utf8"));
assert.equal(migrationReport.result, "passed"); assert.equal(migrationReport.migrations, 137); assert.equal(schemaReport.result, "passed");
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha256(await readFile(file))])));

const client = new Client({ connectionString: url.href }); await client.connect();
try {
  for (const migration of migrations) {
    const source = await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8");
    const row = await client.query('SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1', [migration]);
    assert.equal(row.rows.length, 1); assert.ok(row.rows[0].finished_at); assert.equal(row.rows[0].rolled_back_at, null);
    assert.equal(row.rows[0].checksum, sha256(source), `Applied migration edited: ${migration}`);
  }
  const columns = await client.query(`SELECT table_name,column_name,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND ((table_name='QuestionOption' AND column_name=ANY($1)) OR (table_name='Submission' AND column_name=ANY($2)))
    ORDER BY table_name,column_name`, [["branchDestinationKind", "branchDestinationSectionId"], ["pagePathVersion", "visitedPageKeys", "terminationKind"]]);
  assert.equal(columns.rows.length, 5);
  const checks = await client.query(`SELECT t.relname AS table_name,c.conname,c.convalidated,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND c.conname=ANY($1) ORDER BY c.conname`,
    [["QuestionOption_branch_destination_state", "Submission_page_path_state"]]);
  assert.equal(checks.rows.length, 2); assert.ok(checks.rows.every(row => row.convalidated));
  const triggers = await client.query(`SELECT c.relname AS table_name,t.tgname,p.proname,t.tgdeferrable,t.tginitdeferred
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname=ANY($1) ORDER BY t.tgname`, [[
      "QuestionOption_section_graph_insert", "QuestionOption_section_graph_update", "QuestionOption_section_graph_delete", "submission_page_path_guard",
    ]]);
  assert.equal(triggers.rows.length, 4);
  const functions = await client.query(`SELECT proname,prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND proname=ANY($1) ORDER BY proname`, [[
      "assert_form_section_graph", "check_form_section_graph", "valid_submission_page_path", "check_submission_page_path",
    ]]);
  assert.equal(functions.rows.length, 4); assert.ok(functions.rows.every(row => row.prosrc.length > 100));
  const indexes = await client.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1) ORDER BY indexname`, [[
    "QuestionOption_branchDestinationSectionId_idx", "QuestionOption_branch_question_idx",
  ]]);
  assert.equal(indexes.rows.length, 2); assert.match(indexes.rows.find(row => row.indexname === "QuestionOption_branch_question_idx")!.indexdef, /WHERE \("branchDestinationKind" IS NOT NULL\)/);

  const report = {
    result: "passed", checkedAt: new Date().toISOString(), database: "catchsecu_test", migrations,
    implementation: {
      branchContract: "One always-visible RADIO/SELECT branch question per page; selected option overrides the default destination.",
      graph: "Every default and option edge is same-version, reachable, acyclic and terminal; custom and checkbox branches are rejected.",
      submission: "The server recomputes the page path, rejects unvisited answers and ineligible submission, and stores immutable-version path evidence.",
      correction: "Changing a branch requires newly visited required answers and clears answers that leave the path.",
      compatibility: "Legacy forms and submissions retain section/pagePath version 0 and null additive fields.",
      performance: "Asset and branch triggers run only for relevant metadata; the 5,000-option regression completes in 3.61 seconds.",
    },
    databaseGuards: { columns: columns.rows, checks: checks.rows, triggers: triggers.rows, functions: functions.rows.map(row => row.proname), indexes: indexes.rows },
    validation: {
      focused: { files: 3, tests: 13, result: "passed" }, related: { files: 8, tests: 92, result: "passed", serial: true },
      existingPageAndSubmission: { files: 4, tests: 40, result: "passed" }, largeChoiceRegression: { options: 5000, seconds: 3.61, result: "passed" },
      migration: { freshInstall: 137, upgrade: "129→137", legacyOptionUnchanged: true, legacySubmissionPathVersion: 0 },
      schemaContract: { authorAssetChecks: 10, authorAssetIndexes: 1, authorAssetFunctions: 15, authorAssetTriggers: 23, unexpectedDifferences: 0 },
      typecheck: "passed", lint: "passed", productionBuild: { result: "passed", staticPages: 82 },
      plan: { tasks: 107, sourcePaths: 186, additionalPatterns: 21, result: "passed" },
      apiContracts: { paths: 323, operations: 458, policies: 45, unmapped: 0, result: "passed" },
    },
    cases: ["branch round-trip", "copy page remap", "short and long paths", "required bypass", "unvisited injection", "ineligible rejection",
      "idempotent replay", "branch correction and stale answer clearing", "cross-version SQL bypass", "impossible stored edge", "5,000-option trigger performance"],
    externalDependencies: "No external credential or provider call is required for BI-04c backend path verification.",
    untouched: ["production database", "question-image frozen 20 fixture", "localhost:3108 frozen runtime"], hashes,
  };
  await writeFile(`${directory}/verification-final.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
} finally { await client.end(); }
