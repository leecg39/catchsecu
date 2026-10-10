-- Null preserves legacy DTOs, approval fingerprints and published content. No row backfill.
ALTER TABLE "FormVersion" ADD COLUMN "formLanguage" TEXT;
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_formLanguage_check" CHECK (
  "formLanguage" IS NULL OR "formLanguage" IN ('ko','en','ja','zh-CN','zh-TW','de','fr','ru','es','pt','id','th','vi','tr','it','ar')
);
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_language_verification_check" CHECK (
  NOT verify OR "formLanguage" IS NULL OR "formLanguage"='ko'
);
-- The existing published_version_immutable trigger protects this column as part of the entire row.
