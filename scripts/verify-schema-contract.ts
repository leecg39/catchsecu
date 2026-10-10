import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Client } from "pg";

// Exact pg_get_* spellings independently collected by root after migration129 and checked against the immutable migration chain.
// Do not derive expectations from the database being verified or rewrite old checkpoints.
const authorAssetChecks = [
  {
    "table_name": "AuthorAsset",
    "name": "AuthorAsset_metadata_check",
    "definition": "CHECK (((id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'::text) AND (purpose = ANY (ARRAY['QUESTION_MATERIAL'::text, 'OPTION_IMAGE'::text, 'QUESTION_IMAGE'::text, 'FORM_CONTENT_IMAGE'::text, 'PAGE_CONTENT_IMAGE'::text, 'END_PAGE_CONTENT_IMAGE'::text, 'PRIVATE_PAGE_CONTENT_IMAGE'::text])) AND ((size >= 1) AND (size <= 14680064)) AND (version > 0) AND ((purpose <> 'QUESTION_MATERIAL'::text) OR (size <= 5242880)) AND ((purpose <> ALL (ARRAY['OPTION_IMAGE'::text, 'QUESTION_IMAGE'::text])) OR (size <= 1048576)) AND ((status = 'deleted'::text) OR ((\"nameCipher\" IS NOT NULL) AND (length(\"nameCipher\") > 0)))))"
  },
  {
    "table_name": "AuthorAsset",
    "name": "AuthorAsset_scope_check",
    "definition": "CHECK ((((\"ownerKind\" = 'company'::text) AND (\"tenantId\" IS NOT NULL) AND (\"serviceId\" IS NOT NULL) AND (\"createdById\" IS NOT NULL)) OR ((\"ownerKind\" = 'system'::text) AND (\"tenantId\" IS NULL) AND (\"serviceId\" IS NULL) AND (\"createdById\" IS NULL))))"
  },
  {
    "table_name": "AuthorAsset",
    "name": "AuthorAsset_state_check",
    "definition": "CHECK ((status = ANY (ARRAY['pending'::text, 'uploaded'::text, 'ready'::text, 'rejected'::text, 'deleting'::text, 'deleted'::text])))"
  },
  {
    "table_name": "AuthorAssetBlob",
    "name": "AuthorAssetBlob_identity_check",
    "definition": "CHECK (((id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'::text) AND (\"storageKey\" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'::text) AND (sha256 ~ '^[a-f0-9]{64}$'::text) AND ((size >= 1) AND (size <= 14680064)) AND (\"validationVersion\" > 0) AND (version > 0)))"
  },
  {
    "table_name": "AuthorAssetBlob",
    "name": "AuthorAssetBlob_mime_check",
    "definition": "CHECK ((mime = ANY (ARRAY['application/pdf'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/postscript'::text, 'image/jpeg'::text, 'image/png'::text])))"
  },
  {
    "table_name": "AuthorAssetBlob",
    "name": "AuthorAssetBlob_state_check",
    "definition": "CHECK (((status = ANY (ARRAY['pending'::text, 'uploaded'::text, 'ready'::text, 'quarantined'::text, 'deleting'::text, 'deleted'::text])) AND (\"scanStatus\" = ANY (ARRAY['pending'::text, 'clean'::text, 'infected'::text, 'error'::text])) AND ((status <> 'ready'::text) OR ((\"scanStatus\" = 'clean'::text) AND (\"scanEngine\" IS NOT NULL) AND (\"scannedAt\" IS NOT NULL)))))"
  },
  {
    "table_name": "AuthorAssetReference",
    "name": "AuthorAssetReference_key_check",
    "definition": "CHECK ((((\"questionKey\" IS NULL) OR (\"questionKey\" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'::text)) AND ((\"optionKey\" IS NULL) OR (\"optionKey\" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'::text)) AND ((\"nodeKey\" IS NULL) OR (\"nodeKey\" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'::text)) AND (((slot = 'form_content'::text) AND (\"documentKey\" = 'form'::text)) OR ((slot = 'page_content'::text) AND (\"documentKey\" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'::text)) OR ((slot = 'end_page_content'::text) AND (\"documentKey\" = 'completion'::text)) OR ((slot = 'private_page_content'::text) AND (\"documentKey\" = 'closed'::text)) OR ((slot = 'template_thumbnail'::text) AND (\"documentKey\" = 'template'::text)) OR ((slot = ANY (ARRAY['material'::text, 'option'::text, 'question'::text])) AND (\"documentKey\" IS NULL)))))"
  },
  {
    "table_name": "AuthorAssetReference",
    "name": "AuthorAssetReference_parent_check",
    "definition": "CHECK (((num_nonnulls(\"formVersionId\", \"templateId\", \"approvalId\") = 1) AND (((slot = ANY (ARRAY['material'::text, 'option'::text, 'question'::text])) AND (\"questionKey\" IS NOT NULL) AND (\"documentKey\" IS NULL) AND (\"nodeKey\" IS NULL) AND (((\"formVersionId\" IS NOT NULL) AND (\"questionId\" IS NOT NULL) AND (\"tenantId\" IS NOT NULL) AND (\"serviceId\" IS NOT NULL)) OR ((\"formVersionId\" IS NULL) AND (\"questionId\" IS NULL)))) OR ((slot = ANY (ARRAY['form_content'::text, 'page_content'::text, 'end_page_content'::text, 'private_page_content'::text])) AND (\"questionKey\" IS NULL) AND (\"documentKey\" IS NOT NULL) AND (\"nodeKey\" IS NOT NULL) AND (\"questionId\" IS NULL) AND (((\"formVersionId\" IS NOT NULL) AND (\"tenantId\" IS NOT NULL) AND (\"serviceId\" IS NOT NULL)) OR (\"formVersionId\" IS NULL))) OR ((slot = 'template_thumbnail'::text) AND (\"templateId\" IS NOT NULL) AND (\"questionKey\" IS NULL) AND (\"documentKey\" = 'template'::text) AND (\"nodeKey\" IS NULL) AND (\"questionId\" IS NULL) AND (((\"tenantId\" IS NULL) AND (\"serviceId\" IS NULL)) OR ((\"tenantId\" IS NOT NULL) AND (\"serviceId\" IS NOT NULL)))))))"
  },
  {
    "table_name": "AuthorAssetReference",
    "name": "AuthorAssetReference_slot_check",
    "definition": "CHECK ((((slot = 'material'::text) AND (\"orderNumber\" IS NOT NULL) AND ((\"orderNumber\" >= 0) AND (\"orderNumber\" <= 2)) AND (\"optionKey\" IS NULL)) OR ((slot = 'option'::text) AND (\"orderNumber\" IS NULL) AND (\"optionKey\" IS NOT NULL)) OR ((slot = 'question'::text) AND (\"orderNumber\" IS NULL) AND (\"optionKey\" IS NULL)) OR ((slot = ANY (ARRAY['form_content'::text, 'page_content'::text, 'end_page_content'::text, 'private_page_content'::text])) AND (\"orderNumber\" IS NULL) AND (\"optionKey\" IS NULL)) OR ((slot = 'template_thumbnail'::text) AND (\"questionKey\" IS NULL) AND (\"documentKey\" = 'template'::text) AND (\"nodeKey\" IS NULL) AND (\"orderNumber\" IS NULL) AND (\"optionKey\" IS NULL))))"
  },
  {
    "table_name": "Question",
    "name": "Question_material_list_check",
    "definition": "CHECK (((\"materialList\" IS NULL) OR valid_question_material_links(\"materialList\")))"
  }
];
const authorAssetIndexes = [
  {
    "name": "AuthorAssetReference_parent_slot_unique",
    "definition": "CREATE UNIQUE INDEX \"AuthorAssetReference_parent_slot_unique\" ON public.\"AuthorAssetReference\" USING btree (COALESCE(\"formVersionId\", ''::text), COALESCE(\"templateId\", ''::text), COALESCE(\"approvalId\", ''::text), COALESCE(\"questionKey\", ''::text), COALESCE(\"documentKey\", ''::text), COALESCE(\"nodeKey\", ''::text), slot, COALESCE(\"orderNumber\", '-1'::integer), COALESCE(\"optionKey\", ''::text))"
  }
];
const authorAssetMigrations = ["20261025012000_author_assets", "20261025013000_author_assets_expiry_precision",
  "20261025014000_question_images", "20261025016000_rich_body_asset_purposes", "20261025019000_author_asset_rich_documents",
  "20261025020300_author_asset_trigger_scope", "20261025020600_option_trigger_metadata_scope",
  "20261025027000_form_template_catalog_metadata", "20261025028000_form_template_thumbnail_constraints"];
const authorAssetTriggers = [
  ["ApprovalRequest", "ApprovalRequest_author_asset_consistency", "check_author_asset_graph", true, 21],
  ["ApprovalRequest", "ApprovalRequest_author_asset_lock", "lock_author_asset_content", false, 31],
  ["AuthorAsset", "AuthorAsset_lifetime", "check_author_asset_graph", true, 21],
  ["AuthorAssetReference", "AuthorAssetReference_consistency", "check_author_asset_graph", true, 29],
  ["Form", "Form_author_asset_consistency", "check_author_asset_graph", true, 17],
  ["FormSection", "FormSection_author_asset_consistency", "check_author_asset_graph", true, 29],
  ["FormSection", "FormSection_author_asset_lock", "lock_author_asset_content", false, 31],
  ["FormTemplate", "FormTemplate_author_asset_consistency", "check_author_asset_graph", true, 21],
  ["FormTemplate", "FormTemplate_author_asset_lock", "lock_author_asset_content", false, 31],
  ["FormTemplate", "FormTemplate_thumbnail_asset_lock", "lock_form_template_thumbnail_asset", false, 31],
  ["FormVersion", "FormVersion_author_asset_consistency", "check_author_asset_graph", true, 21],
  ["FormVersion", "FormVersion_author_asset_lock", "lock_author_asset_content", false, 31],
  ["Question", "Question_author_asset_consistency_delete", "check_author_asset_graph", true, 9],
  ["Question", "Question_author_asset_consistency_insert", "check_author_asset_graph", true, 5],
  ["Question", "Question_author_asset_consistency_update", "check_author_asset_graph", true, 17],
  ["Question", "Question_author_asset_lock_delete", "lock_author_asset_content", false, 11],
  ["Question", "Question_author_asset_lock_insert", "lock_author_asset_content", false, 7],
  ["Question", "Question_author_asset_lock_update", "lock_author_asset_content", false, 19],
  ["QuestionOption", "QuestionOption_author_asset_consistency_delete", "check_author_asset_graph", true, 9],
  ["QuestionOption", "QuestionOption_author_asset_consistency_insert", "check_author_asset_graph", true, 5],
  ["QuestionOption", "QuestionOption_author_asset_consistency_update", "check_author_asset_graph", true, 17],
  ["QuestionOption", "QuestionOption_author_asset_lock_delete", "lock_author_asset_content", false, 11],
  ["QuestionOption", "QuestionOption_author_asset_lock_insert", "lock_author_asset_content", false, 7],
  ["QuestionOption", "QuestionOption_author_asset_lock_update", "lock_author_asset_content", false, 19],
] as const;
async function verifyAuthorAssetGuards(connection: Client) {
  const scripts = await Promise.all(authorAssetMigrations.map(async name => ({ name, sql: await readFile(`prisma/migrations/${name}/migration.sql`, "utf8") })));
  for (const source of scripts) {
    const row = await connection.query('SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1 AND rolled_back_at IS NULL', [source.name]);
    assert.equal(row.rows.length, 1, "Author asset migration missing/ambiguous: " + source.name);
    assert.ok(row.rows[0].finished_at, "Author asset migration unfinished: " + source.name);
    assert.equal(row.rows[0].checksum, createHash("sha256").update(source.sql).digest("hex"), "Applied migration was edited: " + source.name);
  }
  for (const expected of authorAssetChecks) {
    const row = await connection.query(`SELECT pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname=$1 AND c.conname=$2 AND c.contype='c'`, [expected.table_name, expected.name]);
    assert.equal(row.rows.length, 1, "Author asset CHECK missing: " + expected.name);
    assert.equal(row.rows[0].definition, expected.definition, "Author asset CHECK changed: " + expected.name);
    assert.equal(row.rows[0].validated, true, "Author asset CHECK not validated: " + expected.name);
  }
  for (const expected of authorAssetIndexes) {
    const row = await connection.query(`SELECT pg_get_indexdef(i.indexrelid) AS definition,i.indisunique,i.indisvalid,i.indisready
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`, [expected.name]);
    assert.equal(row.rows.length, 1, "Author asset index missing: " + expected.name);
    assert.equal(row.rows[0].definition, expected.definition, "Author asset index changed: " + expected.name);
    assert.ok(row.rows[0].indisunique && row.rows[0].indisvalid && row.rows[0].indisready, "Author asset index inactive: " + expected.name);
  }
  const functions = new Map<string, { signature: string; header: string; body: string }>();
  const functionPattern = /CREATE(?: OR REPLACE)? FUNCTION (\w+)\(([^)]*)\)([\s\S]*?)AS \$\$([\s\S]*?)\$\$;/g;
  const legacy = await readFile("prisma/migrations/20261025009000_question_material_links/migration.sql", "utf8");
  for (const match of legacy.matchAll(functionPattern))
    functions.set(match[1] === "valid_question_material_links" ? "valid_question_material_links_v119" : match[1],
      { signature: match[2], header: match[3], body: match[4] });
  for (const source of scripts) for (const match of source.sql.matchAll(functionPattern))
    functions.set(match[1], { signature: match[2], header: match[3], body: match[4] });
  assert.equal(functions.size, 16, "Unexpected author asset function source set");
  const normalizeSignature = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  for (const [name, expected] of functions) {
    const result = await connection.query(`SELECT p.prosrc,l.lanname,p.prosecdef,p.proconfig,p.provolatile,p.proisstrict,p.proparallel,
      pg_get_function_identity_arguments(p.oid) AS args,pg_get_function_result(p.oid) AS result
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname=$1`, [name]);
    assert.equal(result.rows.length, 1, "Author asset guard function missing/ambiguous: " + name);
    const row = result.rows[0], declared = expected.header.match(/RETURNS([\s\S]*?)LANGUAGE\s+(\w+)/i);
    assert.ok(declared, "Unrecognized author asset source function: " + name);
    assert.equal(row.prosrc.trim(), expected.body.trim(), "Author asset guard body changed: " + name);
    assert.equal(normalizeSignature(row.args), normalizeSignature(expected.signature), "Author asset function signature changed: " + name);
    assert.equal(normalizeSignature(row.result), normalizeSignature(declared[1]), "Author asset function result changed: " + name);
    assert.equal(row.lanname, declared[2]); assert.equal(row.prosecdef, false); assert.equal(row.proconfig, null);
    assert.equal(row.provolatile, /\bIMMUTABLE\b/.test(expected.header) ? "i" : /\bSTABLE\b/.test(expected.header) ? "s" : "v");
    assert.equal(row.proisstrict, /\bSTRICT\b/.test(expected.header)); assert.equal(row.proparallel, /PARALLEL SAFE/.test(expected.header) ? "s" : "u");
  }
  const actualTriggers = await connection.query(`SELECT c.relname AS table_name,t.tgname,p.proname,t.tgdeferrable,t.tginitdeferred,t.tgtype
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND NOT t.tgisinternal AND p.proname=ANY($1) ORDER BY c.relname,t.tgname`,
    [["lock_author_asset_content", "lock_form_template_thumbnail_asset", "check_author_asset_graph"]]);
  assert.equal(actualTriggers.rows.length, authorAssetTriggers.length, "Unexpected author asset trigger count");
  for (const [table, name, fn, deferred, type] of authorAssetTriggers) {
    const result = await connection.query(`SELECT t.tgenabled,t.tgdeferrable,t.tginitdeferred,t.tgtype,p.proname FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='public' AND c.relname=$1 AND t.tgname=$2 AND NOT t.tgisinternal`, [table, name]);
    assert.equal(result.rows.length, 1, "Author asset trigger missing: " + name);
    const row = result.rows[0]; assert.equal(row.tgenabled, "O"); assert.equal(row.proname, fn);
    assert.equal(row.tgdeferrable, deferred); assert.equal(row.tginitdeferred, deferred);
    assert.equal(row.tgtype, type, "Author asset trigger timing/events changed: " + name);
  }
  const column = await connection.query(`SELECT is_nullable,data_type,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='QuestionOption' AND column_name='optionImageKey'`);
  assert.deepEqual(column.rows, [{ is_nullable: "YES", data_type: "text", column_default: null }]);
  const referenceColumns = await connection.query(`SELECT column_name,is_nullable,data_type,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='AuthorAssetReference' AND column_name=ANY($1) ORDER BY column_name`,
    [["questionKey", "documentKey", "nodeKey"]]);
  assert.deepEqual(referenceColumns.rows, [
    { column_name: "documentKey", is_nullable: "YES", data_type: "text", column_default: null },
    { column_name: "nodeKey", is_nullable: "YES", data_type: "text", column_default: null },
    { column_name: "questionKey", is_nullable: "YES", data_type: "text", column_default: null },
  ]);
  return { migrations: authorAssetMigrations, checks: authorAssetChecks.length, indexes: authorAssetIndexes.length, functions: functions.size, triggers: authorAssetTriggers.length };
}

const url = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(url.pathname));
const rules = JSON.parse(await readFile("prisma/sql-only-constraints.json", "utf8")) as {
  table: string; name: string; definition: string; sourceMigration: string; evidence: string;
}[];
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), database: url.pathname.slice(1),
  readOnly: true, result: "failed", sqlOnlyConstraints: rules.map(rule => rule.name) };
const directory = process.argv[2] ?? "docs/qa/R01-T01/schema-alignment";
await mkdir(directory, { recursive: true });
const connection = new Client({ connectionString: url.href });
try {
  await connection.connect();
  for (const rule of rules) {
    const actual = await connection.query(`SELECT pg_get_constraintdef(c.oid) AS definition, c.convalidated AS validated
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname=$1 AND c.conname=$2`, [rule.table, rule.name]);
    assert.equal(actual.rows.length, 1, "SQL-only constraint missing or ambiguous");
    assert.equal(actual.rows[0].definition, rule.definition, "SQL-only constraint changed");
    assert.equal(actual.rows[0].validated, true);
    assert.ok((await readFile(`prisma/migrations/${rule.sourceMigration}/migration.sql`, "utf8")).includes(rule.name));
  }
  report.authorAssetGuards = await verifyAuthorAssetGuards(connection);
  const diff = await new Promise<{ code: number; sql: string; diagnostic: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff",
      "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"], { env: process.env });
    let sql = "", diagnostic = "";
    child.stdout.on("data", data => { sql += data; }); child.stderr.on("data", data => { diagnostic += data; });
    child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, sql, diagnostic }));
  });
  const redact = (text: string) => text.replaceAll(url.href, "[database URL]");
  await writeFile(`${directory}/${url.pathname.slice(1)}-checked-diff.sql`, redact(diff.sql));
  assert.equal(diff.code, 0, "Schema comparison failed: " + redact(diff.diagnostic));
  const statements = diff.sql.split("\n").filter(line => !line.trim().startsWith("--")).join("\n")
    .split(";").map(statement => statement.trim().replace(/\s+/g, " ")).filter(Boolean).sort();
  const expected = rules.map(rule => `ALTER TABLE ${quote(rule.table)} DROP CONSTRAINT ${quote(rule.name)}`).sort();
  assert.deepEqual(statements, expected, "Unexpected schema drift; inspect diff without applying it");
  report.result = "passed"; report.unexpectedDifferences = 0; report.intentionalSqlOnlyDifferences = rules.length;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
  await connection.end();
  await writeFile(`${directory}/${url.pathname.slice(1)}-contract.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
