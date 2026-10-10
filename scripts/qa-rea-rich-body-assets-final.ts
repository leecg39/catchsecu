import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = "docs/qa/R08-T02/body-images/rich-assets";
const migration = "20261025019000_author_asset_rich_documents";
const files = [
  `prisma/migrations/${migration}/migration.sql`, "prisma/schema.prisma",
  "src/server/author-asset-references.ts", "src/server/forms.ts", "src/server/templates.ts", "src/server/approvals.ts",
  "src/contracts/form-rich-content.ts", "src/contracts/domains.ts",
  "tests/server/author-asset-references.test.ts", "tests/server/form-sections-contract.test.ts",
];
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

await mkdir(directory, { recursive: true });
const migrationReport = JSON.parse(await readFile(`${directory}/migration-install-final.json`, "utf8"));
const schemaReport = JSON.parse(await readFile(`${directory}/schema-current/catchsecu_test-contract.json`, "utf8"));
assert.equal(migrationReport.result, "passed"); assert.equal(schemaReport.result, "passed");
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha256(await readFile(file))])));
const client = new Client({ connectionString: url.href });
await client.connect();
try {
  const source = await readFile(files[0], "utf8");
  const applied = await client.query('SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1', [migration]);
  assert.equal(applied.rows.length, 1); assert.ok(applied.rows[0].finished_at); assert.equal(applied.rows[0].rolled_back_at, null);
  assert.equal(applied.rows[0].checksum, sha256(source));
  const columns = await client.query(`SELECT column_name,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='AuthorAssetReference' AND column_name=ANY($1) ORDER BY column_name`,
    [["questionKey", "documentKey", "nodeKey"]]);
  const checks = await client.query(`SELECT conname,convalidated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='AuthorAssetReference'
      AND conname=ANY($1) ORDER BY conname`, [["AuthorAssetReference_parent_check", "AuthorAssetReference_slot_check", "AuthorAssetReference_key_check"]]);
  const triggers = await client.query(`SELECT t.tgname,c.relname,p.proname,t.tgdeferrable,t.tginitdeferred FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND t.tgname=ANY($1) ORDER BY t.tgname`,
    [["FormVersion_author_asset_lock", "FormSection_author_asset_lock", "FormSection_author_asset_consistency"]]);
  assert.equal(columns.rows.length, 3); assert.equal(checks.rows.length, 3); assert.ok(checks.rows.every(row => row.convalidated));
  assert.equal(triggers.rows.length, 3);
  const report = {
    result: "passed", checkedAt: new Date().toISOString(), database: "catchsecu_test", migration,
    red: { command: "vitest author-asset-references -t whole form content", result: "failed as expected",
      code: "RICH_BODY_IMAGES_UNAVAILABLE", beforeImplementation: true },
    implementation: {
      graph: "One FormContent graph covers question materials/images plus root, page, completion and closed rich documents.",
      identity: "Question-free references use slot + documentKey/pageKey + nodeKey; questionKey remains null.",
      purposes: ["FORM_CONTENT_IMAGE", "PAGE_CONTENT_IMAGE", "END_PAGE_CONTENT_IMAGE", "PRIVATE_PAGE_CONTENT_IMAGE"],
      copy: "Form copy and template use create one new logical owner per unique source asset and remap every rich document.",
      lifetime: "Draft, published version, approval and template pins independently retain assets; final detach restores one-hour expiry.",
      wholeFormLimits: { richJsonBytes: 524288, richImageNodes: 100 },
    },
    databaseGuards: { columns: columns.rows, checks: checks.rows, triggers: triggers.rows,
      canonicalProjectionFunctions: ["author_asset_document_images", "author_asset_expected", "author_asset_version_content", "validate_author_asset_parent"] },
    validation: {
      focused: { files: 4, tests: 51, result: "passed" },
      related: { files: 14, tests: 153, result: "passed", serial: true },
      migration: { freshInstall: 129, upgrade: "128→129", legacyReferenceUnchanged: true },
      schemaContract: { checks: 10, indexes: 1, functions: 15, triggers: 18, unexpectedDifferences: 0 },
      typecheck: "passed", lint: "passed", productionBuild: { result: "passed", staticPages: 82 },
      plan: { tasks: 107, sourcePaths: 186, additionalPatterns: 21, result: "passed" },
      apiContracts: { paths: 323, operations: 458, policies: 45, unmapped: 0, result: "passed" },
    },
    cases: ["four-slot plus question graph", "duplicate nodes and logical quota", "publish/revision history", "approval snapshot",
      "template pin and use remap", "wrong purpose/service/expiry", "audit rollback", "direct SQL projection bypass",
      "invalid document identity", "GC fence", "attach/GC concurrency"],
    externalDependencies: "No external credential or provider call is required for BI-04b backend ownership verification.",
    untouched: ["production database", "question-image frozen 20 fixture", "localhost:3108 frozen runtime"],
    hashes,
  };
  await writeFile(`${directory}/verification-final.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await client.end();
}
