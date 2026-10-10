ALTER TABLE "FormTemplate"
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN "thumbnailAssetId" TEXT,
  ADD COLUMN "licenseScope" TEXT NOT NULL DEFAULT 'SERVICE';

UPDATE "FormTemplate" SET "licenseScope"='ACTIVE_SUBSCRIPTION' WHERE "tenantId" IS NULL;

ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_thumbnailAssetId_fkey"
  FOREIGN KEY ("thumbnailAssetId") REFERENCES "AuthorAsset"(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "FormTemplate_thumbnailAssetId_idx" ON "FormTemplate"("thumbnailAssetId");
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_catalog_scope_check" CHECK (
  ("tenantId" IS NULL AND "serviceId" IS NULL AND "licenseScope"='ACTIVE_SUBSCRIPTION')
  OR ("tenantId" IS NOT NULL AND "serviceId" IS NOT NULL AND "licenseScope"='SERVICE')
);
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_description_length_check"
  CHECK (char_length(description) <= 2000);

ALTER TABLE "AuthorAssetReference" DROP CONSTRAINT "AuthorAssetReference_slot_check";
ALTER TABLE "AuthorAssetReference" ADD CONSTRAINT "AuthorAssetReference_slot_check" CHECK (
  (slot='material' AND "orderNumber" IS NOT NULL AND "orderNumber" BETWEEN 0 AND 2 AND "optionKey" IS NULL)
  OR (slot='option' AND "orderNumber" IS NULL AND "optionKey" IS NOT NULL)
  OR (slot='question' AND "orderNumber" IS NULL AND "optionKey" IS NULL)
  OR (slot IN ('form_content','page_content','end_page_content','private_page_content') AND "orderNumber" IS NULL AND "optionKey" IS NULL)
  OR (slot='template_thumbnail' AND "questionKey" IS NULL AND "documentKey"='template' AND "nodeKey" IS NULL AND "orderNumber" IS NULL AND "optionKey" IS NULL)
);

ALTER FUNCTION author_asset_expected(jsonb) RENAME TO author_asset_expected_without_template_thumbnail;
CREATE FUNCTION author_asset_expected(content jsonb)
RETURNS TABLE(question_key text, document_key text, node_key text, slot text, order_number integer, option_key text, asset_id text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM author_asset_expected_without_template_thumbnail(content)
  UNION ALL
  SELECT NULL::text, 'template'::text, NULL::text, 'template_thumbnail'::text, NULL::integer, NULL::text,
    content->>'templateThumbnailAssetId'
  WHERE content IS NOT NULL
    AND jsonb_typeof(content->'templateThumbnailAssetId')='string'
    AND content->>'templateThumbnailAssetId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
$$;

CREATE OR REPLACE FUNCTION validate_author_asset_parent(kind text, parent_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE tenant_id text; service_id text; content jsonb; expected jsonb; actual jsonb;
BEGIN
  PERFORM lock_author_asset_parent(kind, parent_id);
  IF kind = 'version' THEN
    SELECT v."tenantId", f."serviceId", author_asset_version_content(v.id) INTO tenant_id, service_id, content
      FROM "FormVersion" v JOIN "Form" f ON f.id = v."formId" WHERE v.id = parent_id;
  ELSIF kind = 'template' THEN
    SELECT t."tenantId", t."serviceId", t.content || jsonb_build_object('templateThumbnailAssetId', t."thumbnailAssetId")
      INTO tenant_id, service_id, content FROM "FormTemplate" t WHERE t.id = parent_id;
  ELSE
    SELECT a."tenantId", f."serviceId", a.snapshot->'content' INTO tenant_id, service_id, content
      FROM "ApprovalRequest" a JOIN "Form" f ON f.id = a."formId" WHERE a.id = parent_id;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY v::text), '[]'::jsonb) INTO expected FROM (
    SELECT jsonb_build_array(e.question_key, e.document_key, e.node_key, e.slot, e.order_number, e.option_key, e.asset_id) v
    FROM author_asset_expected(content) e
  ) projected;
  SELECT coalesce(jsonb_agg(v ORDER BY v::text), '[]'::jsonb) INTO actual FROM (
    SELECT jsonb_build_array(r."questionKey", r."documentKey", r."nodeKey", r.slot, r."orderNumber", r."optionKey", r."assetId") v
    FROM "AuthorAssetReference" r
    WHERE (kind = 'version' AND r."formVersionId" = parent_id)
      OR (kind = 'template' AND r."templateId" = parent_id)
      OR (kind = 'approval' AND r."approvalId" = parent_id)
  ) projected;
  IF expected <> actual THEN RAISE EXCEPTION 'Author asset JSON and pins differ' USING ERRCODE = '23514'; END IF;
  IF expected = '[]'::jsonb THEN RETURN; END IF;
  PERFORM author_asset_read_committed();
  PERFORM a.id FROM "AuthorAsset" a
    WHERE a.id IN (SELECT e.asset_id FROM author_asset_expected(content) e) ORDER BY a.id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "AuthorAssetReference" r
    JOIN "AuthorAsset" a ON a.id = r."assetId" JOIN "AuthorAssetBlob" b ON b.id = a."blobId"
    WHERE ((kind = 'version' AND r."formVersionId" = parent_id)
      OR (kind = 'template' AND r."templateId" = parent_id)
      OR (kind = 'approval' AND r."approvalId" = parent_id))
      AND (r."tenantId" IS DISTINCT FROM tenant_id OR r."serviceId" IS DISTINCT FROM service_id
        OR a."tenantId" IS DISTINCT FROM tenant_id OR a."serviceId" IS DISTINCT FROM service_id
        OR a."ownerKind" <> CASE WHEN tenant_id IS NULL THEN 'system' ELSE 'company' END
        OR a.status <> 'ready' OR a."expiresAt" IS NOT NULL OR b.status NOT IN ('ready', 'quarantined')
        OR a.purpose <> CASE r.slot
          WHEN 'material' THEN 'QUESTION_MATERIAL' WHEN 'option' THEN 'OPTION_IMAGE' WHEN 'question' THEN 'QUESTION_IMAGE'
          WHEN 'form_content' THEN 'FORM_CONTENT_IMAGE' WHEN 'page_content' THEN 'PAGE_CONTENT_IMAGE'
          WHEN 'end_page_content' THEN 'END_PAGE_CONTENT_IMAGE' WHEN 'private_page_content' THEN 'PRIVATE_PAGE_CONTENT_IMAGE'
          WHEN 'template_thumbnail' THEN 'FORM_CONTENT_IMAGE' END
        OR (kind = 'version' AND r.slot IN ('material', 'option', 'question') AND NOT EXISTS (
          SELECT 1 FROM "Question" q WHERE q.id = r."questionId" AND q."stableKey" = r."questionKey"
            AND q."formVersionId" = parent_id AND q."tenantId" = tenant_id)))
  ) THEN RAISE EXCEPTION 'Author asset parent scope, purpose or readiness mismatch' USING ERRCODE = '23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION lock_form_template_thumbnail_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE keys text[];
BEGIN
  SELECT array_agg(DISTINCT id ORDER BY id) INTO keys FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD."thumbnailAssetId" END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW."thumbnailAssetId" END
  ]) id WHERE id IS NOT NULL;
  IF coalesce(cardinality(keys),0)>0 THEN
    PERFORM author_asset_read_committed();
    PERFORM id FROM "AuthorAsset" WHERE id=ANY(keys) ORDER BY id FOR UPDATE;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FormTemplate_thumbnail_asset_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FormTemplate"
FOR EACH ROW EXECUTE FUNCTION lock_form_template_thumbnail_asset();
