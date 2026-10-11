import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["Form", "FormVersion", "Question", "QuestionOption", "FormTemplate", "FormFavorite", "FormDocumentBinding", "FormSection", "AuthorAssetBlob", "AuthorAsset", "AuthorAssetReference", "FormAccessTargetBatch", "FormAccessTarget"];
try {
  const metadata = await db.$transaction(async tx => ({
    columns: await tx.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
      SELECT table_name AS "table", column_name AS "column", data_type AS type, is_nullable AS nullable
      FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}::text[])
      ORDER BY table_name, ordinal_position`,
    constraints: await tx.$queryRaw<{ table: string; name: string; definition: string; validated: boolean }[]>`
      SELECT c.relname AS "table", k.conname AS name, pg_get_constraintdef(k.oid) AS definition, k.convalidated AS validated
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(${tables}::text[]) ORDER BY c.relname,k.conname`,
    indexes: await tx.$queryRaw<{ table: string; name: string; definition: string }[]>`
      SELECT tablename AS "table", indexname AS name, indexdef AS definition
      FROM pg_indexes WHERE schemaname='public' AND tablename=ANY(${tables}::text[]) ORDER BY tablename,indexname`,
    triggers: await tx.$queryRaw<{ table: string; name: string; definition: string; function: string }[]>`
      SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS definition, pg_get_functiondef(t.tgfoid) AS function
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY(${tables}::text[]) ORDER BY c.relname,t.tgname`,
  }), { isolationLevel: "RepeatableRead" });
  const { columns, constraints, indexes, triggers } = metadata;
  assert(constraints.every(item => item.validated), "all constraints validated");
  for (const table of tables) assert(columns.some(column => column.table === table), table);
  for (const [table, signature] of [
    ["Form", 'FOREIGN KEY ("tenantId", "serviceId")'],
    ["Form", 'FOREIGN KEY ("tenantId", "id", "publishedVersionId")'],
    ["FormVersion", 'FOREIGN KEY ("tenantId", "formId")'],
    ["Question", 'FOREIGN KEY ("tenantId", "formVersionId")'],
    ["FormDocumentBinding", 'FOREIGN KEY ("tenantId", "serviceId", "documentId", "documentVersionId")'],
  ]) assert(constraints.some(item => item.table === table && item.definition.replaceAll('"', "").includes(signature.replaceAll('"', ""))), table + " relation " + signature);
  for (const name of ["FormVersion_formId_number_key", "Question_tenantId_formVersionId_stableKey_key", "QuestionOption_questionId_value_key", "QuestionOption_questionId_stableKey_key", "FormSection_tenantId_formVersionId_pageKey_key", "FormSection_tenantId_formVersionId_order_key", "FormTemplate_tenantId_serviceId_title_key"])
    assert(indexes.some(item => item.name === name && item.definition.includes("UNIQUE")), name);
  for (const name of ["published_question_immutable", "published_option_immutable"])
    assert(triggers.some(item => item.name === name && item.definition.includes("BEFORE INSERT OR DELETE OR UPDATE")), name);
  for (const name of ["published_version_immutable", "published_section_immutable", "option_identity_guard",
    "FormSection_graph", "FormVersion_section_graph", "FormVersion_consent_items_projection", "Question_consent_items_projection",
    "AuthorAssetReference_consistency", "AuthorAsset_lifetime", "FormTemplate_thumbnail_asset_lock"])
    assert(triggers.some(item => item.name === name), name);
  for (const name of ["FormVersion_option_schema_check", "QuestionOption_identity_check", "QuestionOption_branch_destination_state",
    "FormSection_destination_state", "FormVersion_collection_window_check", "FormVersion_participation_access_check",
    "FormVersion_consent_items_check", "Question_info_pattern_check", "Question_material_list_check", "Question_personal_information_check",
    "AuthorAsset_scope_check", "AuthorAssetReference_parent_check", "FormTemplate_catalog_scope_check"])
    assert(constraints.some(item => item.name === name), name);
  const migrationRows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const migrations = Number(migrationRows[0].count);
  assert.ok(migrations >= 149);
  const files = ["prisma/schema.prisma", "src/contracts/domains.ts", "src/contracts/questions.ts", "src/contracts/forms.ts", "src/contracts/form-copy.ts",
    "src/server/forms.ts", "src/server/templates.ts", "src/server/form-documents.ts", "src/server/form-access.ts", "src/server/answer-validation.ts", "src/server/question-options.ts", "src/server/author-asset-references.ts", "src/server/author-asset-uploads.ts", "src/server/participation-access.ts", "src/server/form-participation-targets.ts", "src/contracts/form-sections.ts", "src/contracts/form-rich-content.ts", "src/contracts/form-participation-access.ts", "src/contracts/form-collection-window.ts", "src/contracts/author-assets.ts", "src/contracts/consent-items.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { checkedAt: new Date().toISOString(), result: "passed", database: database.pathname.slice(1), tables, migrations,
    scope: "Read-only thirteen-model metadata, validated constraints and selected tenant/FK/stable-key/uniqueness/published-child-trigger assertions. Runtime lifecycle and source-field coverage are separate evidence; no external-provider acceptance claim.",
    metadataHash: createHash("sha256").update(JSON.stringify(metadata)).digest("hex"), ...metadata, sourceFingerprints };
  await mkdir("docs/qa/R08-T01/current", { recursive: true });
  await writeFile("docs/qa/R08-T01/current/" + report.database + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length, triggers: triggers.length, metadataHash: report.metadataHash }));
} finally { await db.$disconnect(); }
