BEGIN;

-- Rich-body references have no question owner. Keep their stable location as
-- slot + document/page key + image node key instead of inventing a question UUID.
ALTER TABLE "AuthorAssetReference" ALTER COLUMN "questionKey" DROP NOT NULL;
ALTER TABLE "AuthorAssetReference" ADD COLUMN "documentKey" TEXT;
ALTER TABLE "AuthorAssetReference" ADD COLUMN "nodeKey" TEXT;

ALTER TABLE "AuthorAssetReference" DROP CONSTRAINT "AuthorAssetReference_parent_check";
ALTER TABLE "AuthorAssetReference" DROP CONSTRAINT "AuthorAssetReference_slot_check";
ALTER TABLE "AuthorAssetReference" DROP CONSTRAINT "AuthorAssetReference_key_check";
DROP INDEX "AuthorAssetReference_parent_slot_unique";

ALTER TABLE "AuthorAssetReference" ADD CONSTRAINT "AuthorAssetReference_parent_check" CHECK (
  num_nonnulls("formVersionId", "templateId", "approvalId") = 1
  AND (
    (slot IN ('material', 'option', 'question')
      AND "questionKey" IS NOT NULL AND "documentKey" IS NULL AND "nodeKey" IS NULL
      AND (("formVersionId" IS NOT NULL AND "questionId" IS NOT NULL AND "tenantId" IS NOT NULL AND "serviceId" IS NOT NULL)
        OR ("formVersionId" IS NULL AND "questionId" IS NULL)))
    OR
    (slot IN ('form_content', 'page_content', 'end_page_content', 'private_page_content')
      AND "questionKey" IS NULL AND "documentKey" IS NOT NULL AND "nodeKey" IS NOT NULL AND "questionId" IS NULL
      AND (("formVersionId" IS NOT NULL AND "tenantId" IS NOT NULL AND "serviceId" IS NOT NULL)
        OR "formVersionId" IS NULL))
  )
);
ALTER TABLE "AuthorAssetReference" ADD CONSTRAINT "AuthorAssetReference_slot_check" CHECK (
  (slot = 'material' AND "orderNumber" IS NOT NULL AND "orderNumber" BETWEEN 0 AND 2 AND "optionKey" IS NULL)
  OR (slot = 'option' AND "orderNumber" IS NULL AND "optionKey" IS NOT NULL)
  OR (slot = 'question' AND "orderNumber" IS NULL AND "optionKey" IS NULL)
  OR (slot IN ('form_content', 'page_content', 'end_page_content', 'private_page_content')
    AND "orderNumber" IS NULL AND "optionKey" IS NULL)
);
ALTER TABLE "AuthorAssetReference" ADD CONSTRAINT "AuthorAssetReference_key_check" CHECK (
  ("questionKey" IS NULL OR "questionKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  AND ("optionKey" IS NULL OR "optionKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  AND ("nodeKey" IS NULL OR "nodeKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  AND ((slot = 'form_content' AND "documentKey" = 'form')
    OR (slot = 'page_content' AND "documentKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    OR (slot = 'end_page_content' AND "documentKey" = 'completion')
    OR (slot = 'private_page_content' AND "documentKey" = 'closed')
    OR (slot IN ('material', 'option', 'question') AND "documentKey" IS NULL))
);
CREATE UNIQUE INDEX "AuthorAssetReference_parent_slot_unique" ON "AuthorAssetReference" (
  coalesce("formVersionId", ''), coalesce("templateId", ''), coalesce("approvalId", ''),
  coalesce("questionKey", ''), coalesce("documentKey", ''), coalesce("nodeKey", ''), slot,
  coalesce("orderNumber", -1), coalesce("optionKey", '')
);

CREATE FUNCTION author_asset_document_images(document jsonb)
RETURNS TABLE(node_key text, asset_id text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE image jsonb;
BEGIN
  IF document IS NULL OR document = 'null'::jsonb THEN RETURN; END IF;
  IF jsonb_typeof(document) IS DISTINCT FROM 'object'
    OR document->>'schemaVersion' IS DISTINCT FROM '1'
    OR jsonb_typeof(document->'blocks') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid rich author document' USING ERRCODE = '23514';
  END IF;
  FOR image IN SELECT value FROM jsonb_path_query(document, 'strict $.** ? (@.type == "image")') value LOOP
    IF jsonb_typeof(image->'nodeId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(image->'assetId') IS DISTINCT FROM 'string'
      OR (image->>'nodeId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR (image->>'assetId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid rich author image identity' USING ERRCODE = '23514';
    END IF;
    node_key := image->>'nodeId'; asset_id := image->>'assetId'; RETURN NEXT;
  END LOOP;
END;
$$;

DROP FUNCTION author_asset_expected(jsonb);
CREATE FUNCTION author_asset_expected(content jsonb)
RETURNS TABLE(question_key text, document_key text, node_key text, slot text,
  order_number integer, option_key text, asset_id text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE q jsonb; m jsonb; o jsonb; section jsonb; image record; images integer; key text;
BEGIN
  IF content IS NULL OR content = 'null'::jsonb THEN RETURN; END IF;

  IF jsonb_typeof(content->'questions') = 'array' THEN
    FOR q IN SELECT value FROM jsonb_array_elements(content->'questions') LOOP
      IF q->'questionImageKey' IS NOT NULL AND q->'questionImageKey' <> 'null'::jsonb THEN
        key := q->>'questionImageKey';
        IF jsonb_typeof(q->'questionImageKey') IS DISTINCT FROM 'string'
          OR key !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'Invalid question image key' USING ERRCODE = '23514';
        END IF;
        question_key := q->>'id'; document_key := NULL; node_key := NULL; slot := 'question';
        order_number := NULL; option_key := NULL; asset_id := key; RETURN NEXT;
      END IF;
      IF q->'materialList' IS NOT NULL AND q->'materialList' <> 'null'::jsonb THEN
        IF NOT valid_question_material_links(q->'materialList') THEN
          RAISE EXCEPTION 'Invalid author material list' USING ERRCODE = '23514';
        END IF;
        FOR m IN SELECT value FROM jsonb_array_elements(q->'materialList') WHERE value->>'materialType' = 'FILE' LOOP
          question_key := q->>'id'; document_key := NULL; node_key := NULL; slot := 'material';
          order_number := (m->>'orderNumber')::integer; option_key := NULL; asset_id := m->>'fileKey'; RETURN NEXT;
        END LOOP;
      END IF;
      images := 0;
      IF jsonb_typeof(q->'optionDefinitions') = 'array' THEN
        FOR o IN SELECT value FROM jsonb_array_elements(q->'optionDefinitions') LOOP
          IF o->'optionImageKey' IS NULL OR o->'optionImageKey' = 'null'::jsonb THEN CONTINUE; END IF;
          key := o->>'optionImageKey'; images := images + 1;
          IF jsonb_typeof(o->'optionImageKey') IS DISTINCT FROM 'string'
            OR key !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            OR q->>'type' NOT IN ('객관식 답변', '체크박스') OR q->>'type' IS NULL
            OR coalesce(o->'isCustomValue', 'null'::jsonb) NOT IN ('null'::jsonb, 'false'::jsonb) OR images > 20 THEN
            RAISE EXCEPTION 'Invalid option image type, custom flag or count' USING ERRCODE = '23514';
          END IF;
          question_key := q->>'id'; document_key := NULL; node_key := NULL; slot := 'option';
          order_number := NULL; option_key := o->>'id'; asset_id := key; RETURN NEXT;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  FOR image IN SELECT * FROM author_asset_document_images(content->'bodyRich') LOOP
    question_key := NULL; document_key := 'form'; node_key := image.node_key; slot := 'form_content';
    order_number := NULL; option_key := NULL; asset_id := image.asset_id; RETURN NEXT;
  END LOOP;
  IF jsonb_typeof(content->'sections') = 'array' THEN
    FOR section IN SELECT value FROM jsonb_array_elements(content->'sections') LOOP
      FOR image IN SELECT * FROM author_asset_document_images(section->'bodyRich') LOOP
        question_key := NULL; document_key := section->>'id'; node_key := image.node_key; slot := 'page_content';
        order_number := NULL; option_key := NULL; asset_id := image.asset_id; RETURN NEXT;
      END LOOP;
    END LOOP;
  END IF;
  IF content#>>'{completionPage,mode}' = 'custom' THEN
    FOR image IN SELECT * FROM author_asset_document_images(content#>'{completionPage,bodyRich}') LOOP
      question_key := NULL; document_key := 'completion'; node_key := image.node_key; slot := 'end_page_content';
      order_number := NULL; option_key := NULL; asset_id := image.asset_id; RETURN NEXT;
    END LOOP;
  END IF;
  IF content#>>'{closedPage,mode}' = 'custom' THEN
    FOR image IN SELECT * FROM author_asset_document_images(content#>'{closedPage,bodyRich}') LOOP
      question_key := NULL; document_key := 'closed'; node_key := image.node_key; slot := 'private_page_content';
      order_number := NULL; option_key := NULL; asset_id := image.asset_id; RETURN NEXT;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION author_asset_version_content(version_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'bodyRich', v."bodyRich",
    'sections', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s."pageKey", 'bodyRich', s."bodyRich") ORDER BY s."order")
      FROM "FormSection" s WHERE s."formVersionId" = v.id), '[]'::jsonb),
    'completionPage', CASE WHEN v."completionPageMode" IS NULL THEN NULL ELSE jsonb_build_object('mode', v."completionPageMode", 'bodyRich', v."completionPageBodyRich") END,
    'closedPage', CASE WHEN v."closedPageMode" IS NULL THEN NULL ELSE jsonb_build_object('mode', v."closedPageMode", 'bodyRich', v."closedPageBodyRich") END,
    'questions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q."stableKey", 'type', q.type,
      'questionImageKey', q."questionImageKey", 'materialList', q."materialList",
      'optionDefinitions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', coalesce(o."stableKey", o.id),
        'optionImageKey', o."optionImageKey", 'isCustomValue', o."isCustomValue") ORDER BY o."order")
        FROM "QuestionOption" o WHERE o."questionId" = q.id), '[]'::jsonb)) ORDER BY q."order")
      FROM "Question" q WHERE q."formVersionId" = v.id), '[]'::jsonb)
  ) FROM "FormVersion" v WHERE v.id = version_id
$$;

CREATE OR REPLACE FUNCTION validate_author_asset_parent(kind text, parent_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE tenant_id text; service_id text; content jsonb; expected jsonb; actual jsonb;
BEGIN
  PERFORM lock_author_asset_parent(kind, parent_id);
  IF kind = 'version' THEN
    SELECT v."tenantId", f."serviceId", author_asset_version_content(v.id) INTO tenant_id, service_id, content
      FROM "FormVersion" v JOIN "Form" f ON f.id = v."formId" WHERE v.id = parent_id;
  ELSIF kind = 'template' THEN
    SELECT t."tenantId", t."serviceId", t.content INTO tenant_id, service_id, content FROM "FormTemplate" t WHERE t.id = parent_id;
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
          WHEN 'end_page_content' THEN 'END_PAGE_CONTENT_IMAGE' WHEN 'private_page_content' THEN 'PRIVATE_PAGE_CONTENT_IMAGE' END
        OR (kind = 'version' AND r.slot IN ('material', 'option', 'question') AND NOT EXISTS (
          SELECT 1 FROM "Question" q WHERE q.id = r."questionId" AND q."stableKey" = r."questionKey"
            AND q."formVersionId" = parent_id AND q."tenantId" = tenant_id)))
  ) THEN RAISE EXCEPTION 'Author asset parent scope, purpose or readiness mismatch' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION lock_author_asset_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_content jsonb; new_content jsonb; version_id text; parent_kind text; parent_id text; keys text[];
BEGIN
  IF TG_TABLE_NAME = 'Question' THEN
    IF TG_OP <> 'INSERT' THEN old_content := jsonb_build_object('questions', jsonb_build_array(jsonb_build_object(
      'id', OLD."stableKey", 'type', OLD.type, 'questionImageKey', OLD."questionImageKey", 'materialList', OLD."materialList"))); END IF;
    IF TG_OP <> 'DELETE' THEN new_content := jsonb_build_object('questions', jsonb_build_array(jsonb_build_object(
      'id', NEW."stableKey", 'type', NEW.type, 'questionImageKey', NEW."questionImageKey", 'materialList', NEW."materialList"))); END IF;
    version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."formVersionId" ELSE NEW."formVersionId" END;
    IF TG_OP <> 'INSERT' THEN old_content := jsonb_set(old_content, '{questions,0,optionDefinitions}', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', coalesce(o."stableKey", o.id), 'optionImageKey', o."optionImageKey", 'isCustomValue', o."isCustomValue"))
      FROM "QuestionOption" o WHERE o."questionId" = OLD.id), '[]'::jsonb)); END IF;
    parent_kind := 'version'; parent_id := version_id;
  ELSIF TG_TABLE_NAME = 'QuestionOption' THEN
    SELECT "formVersionId" INTO version_id FROM "Question" WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."questionId" ELSE NEW."questionId" END;
    parent_kind := 'version'; parent_id := version_id; keys := ARRAY[]::text[];
    IF TG_OP <> 'INSERT' AND OLD."optionImageKey" IS NOT NULL THEN keys := array_append(keys, OLD."optionImageKey"); END IF;
    IF TG_OP <> 'DELETE' AND NEW."optionImageKey" IS NOT NULL THEN keys := array_append(keys, NEW."optionImageKey"); END IF;
  ELSIF TG_TABLE_NAME = 'FormVersion' THEN
    IF TG_OP <> 'INSERT' THEN old_content := jsonb_build_object('bodyRich', OLD."bodyRich",
      'completionPage', jsonb_build_object('mode', OLD."completionPageMode", 'bodyRich', OLD."completionPageBodyRich"),
      'closedPage', jsonb_build_object('mode', OLD."closedPageMode", 'bodyRich', OLD."closedPageBodyRich")); END IF;
    IF TG_OP <> 'DELETE' THEN new_content := jsonb_build_object('bodyRich', NEW."bodyRich",
      'completionPage', jsonb_build_object('mode', NEW."completionPageMode", 'bodyRich', NEW."completionPageBodyRich"),
      'closedPage', jsonb_build_object('mode', NEW."closedPageMode", 'bodyRich', NEW."closedPageBodyRich")); END IF;
    parent_kind := 'version'; parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME = 'FormSection' THEN
    IF TG_OP <> 'INSERT' THEN old_content := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('id', OLD."pageKey", 'bodyRich', OLD."bodyRich"))); END IF;
    IF TG_OP <> 'DELETE' THEN new_content := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('id', NEW."pageKey", 'bodyRich', NEW."bodyRich"))); END IF;
    parent_kind := 'version'; parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."formVersionId" ELSE NEW."formVersionId" END;
  ELSIF TG_TABLE_NAME = 'FormTemplate' THEN
    IF TG_OP <> 'INSERT' THEN old_content := OLD.content; END IF;
    IF TG_OP <> 'DELETE' THEN new_content := NEW.content; END IF;
    parent_kind := 'template'; parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    IF TG_OP <> 'INSERT' THEN old_content := OLD.snapshot->'content'; END IF;
    IF TG_OP <> 'DELETE' THEN new_content := NEW.snapshot->'content'; END IF;
    parent_kind := 'approval'; parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  END IF;
  IF keys IS NULL THEN SELECT array_agg(DISTINCT asset_id) INTO keys FROM (
    SELECT e.asset_id FROM author_asset_expected(old_content) e
    UNION ALL SELECT e.asset_id FROM author_asset_expected(new_content) e
  ) all_keys; END IF;
  IF coalesce(cardinality(keys), 0) > 0 THEN
    PERFORM author_asset_read_committed();
    PERFORM lock_author_asset_parent(parent_kind, parent_id);
    PERFORM id FROM "AuthorAsset" WHERE id = ANY(keys) ORDER BY id FOR UPDATE;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FormVersion_author_asset_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FormVersion"
  FOR EACH ROW EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "FormSection_author_asset_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FormSection"
  FOR EACH ROW EXECUTE FUNCTION lock_author_asset_content();

CREATE OR REPLACE FUNCTION check_author_asset_graph() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text; r record;
BEGIN
  IF TG_TABLE_NAME = 'AuthorAssetReference' THEN
    IF TG_OP = 'DELETE' THEN
      PERFORM validate_author_asset_parent(CASE WHEN OLD."formVersionId" IS NOT NULL THEN 'version' WHEN OLD."templateId" IS NOT NULL THEN 'template' ELSE 'approval' END,
        coalesce(OLD."formVersionId", OLD."templateId", OLD."approvalId"));
      PERFORM validate_author_asset_lifetime(OLD."assetId");
    ELSE
      PERFORM validate_author_asset_parent(CASE WHEN NEW."formVersionId" IS NOT NULL THEN 'version' WHEN NEW."templateId" IS NOT NULL THEN 'template' ELSE 'approval' END,
        coalesce(NEW."formVersionId", NEW."templateId", NEW."approvalId"));
      PERFORM validate_author_asset_lifetime(NEW."assetId");
    END IF;
  ELSIF TG_TABLE_NAME = 'AuthorAsset' THEN
    PERFORM validate_author_asset_lifetime(NEW.id);
  ELSIF TG_TABLE_NAME = 'Question' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM validate_author_asset_parent('version', OLD."formVersionId"); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM validate_author_asset_parent('version', NEW."formVersionId"); END IF;
  ELSIF TG_TABLE_NAME = 'QuestionOption' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT "formVersionId" INTO parent_id FROM "Question" WHERE id = OLD."questionId";
      IF parent_id IS NOT NULL THEN PERFORM validate_author_asset_parent('version', parent_id); END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "formVersionId" INTO parent_id FROM "Question" WHERE id = NEW."questionId";
      IF parent_id IS NOT NULL THEN PERFORM validate_author_asset_parent('version', parent_id); END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'FormVersion' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM validate_author_asset_parent('version', NEW.id); END IF;
  ELSIF TG_TABLE_NAME = 'FormSection' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM validate_author_asset_parent('version', OLD."formVersionId"); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM validate_author_asset_parent('version', NEW."formVersionId"); END IF;
  ELSIF TG_TABLE_NAME = 'FormTemplate' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM validate_author_asset_parent('template', NEW.id); END IF;
  ELSIF TG_TABLE_NAME = 'ApprovalRequest' THEN
    PERFORM validate_author_asset_parent('approval', NEW.id);
  ELSIF TG_TABLE_NAME = 'Form' THEN
    FOR r IN SELECT id FROM "FormVersion" WHERE "formId" = NEW.id LOOP PERFORM validate_author_asset_parent('version', r.id); END LOOP;
    FOR r IN SELECT id FROM "ApprovalRequest" WHERE "formId" = NEW.id LOOP PERFORM validate_author_asset_parent('approval', r.id); END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FormSection_author_asset_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "FormSection" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();

COMMIT;
