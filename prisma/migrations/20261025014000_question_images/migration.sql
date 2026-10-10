BEGIN;

-- Additive QI only: no old row, published question, approval snapshot, answer or receipt is rewritten.
-- Keep applied migrations122/123 immutable. Preserve the 123 timestamp(3) expiry comparison.
ALTER TABLE "Question" ADD COLUMN "questionImageKey" TEXT;
ALTER TABLE "Question" ADD CONSTRAINT "Question_questionImageKey_fkey" FOREIGN KEY ("questionImageKey") REFERENCES "AuthorAsset"(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "Question_questionImageKey_idx" ON "Question"("questionImageKey");

ALTER TABLE "AuthorAsset" DROP CONSTRAINT "AuthorAsset_metadata_check";
ALTER TABLE "AuthorAsset" ADD CONSTRAINT "AuthorAsset_metadata_check" CHECK (id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  AND purpose IN ('QUESTION_MATERIAL','OPTION_IMAGE','QUESTION_IMAGE') AND size BETWEEN 1 AND 5242880 AND version>0
  AND (purpose NOT IN ('OPTION_IMAGE','QUESTION_IMAGE') OR size<=1048576)
  AND (status='deleted' OR ("nameCipher" IS NOT NULL AND length("nameCipher")>0)));
ALTER TABLE "AuthorAssetReference" DROP CONSTRAINT "AuthorAssetReference_slot_check";
ALTER TABLE "AuthorAssetReference" ADD CONSTRAINT "AuthorAssetReference_slot_check" CHECK (
  (slot='material' AND "orderNumber" IS NOT NULL AND "orderNumber" BETWEEN 0 AND 2 AND "optionKey" IS NULL)
  OR (slot='option' AND "orderNumber" IS NULL AND "optionKey" IS NOT NULL)
  OR (slot='question' AND "orderNumber" IS NULL AND "optionKey" IS NULL));
-- The existing parent_slot_unique index makes the one question-image slot unique.
-- Keep physical Question FKs, immutable pins, service sync and deferred exact graph checks.

CREATE OR REPLACE FUNCTION check_author_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "AuthorAssetBlob";
BEGIN
  PERFORM author_asset_read_committed();
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Keep author asset tombstones' USING ERRCODE='23514'; END IF;
  IF NEW."expiresAt">((clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)+interval '1 hour') THEN
    RAISE EXCEPTION 'Author asset reservation cannot exceed one hour' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "AuthorAssetBlob" WHERE id=NEW."blobId" FOR UPDATE;
  SELECT * INTO b FROM "AuthorAssetBlob" WHERE id=NEW."blobId";
  IF b.id IS NULL OR NEW.size<>b.size OR (NEW.purpose IN ('OPTION_IMAGE','QUESTION_IMAGE') AND b.mime NOT IN ('image/jpeg','image/png'))
    OR (NEW.purpose='QUESTION_MATERIAL' AND b.mime NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/postscript')) THEN
    RAISE EXCEPTION 'Author asset byte identity/purpose mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR NEW.status NOT IN ('pending','ready') OR b.status IN ('quarantined','deleting','deleted')
      OR (NEW.status='pending' AND NEW."expiresAt" IS NULL)
      OR (NEW.status='ready' AND (b.status<>'ready' OR b."scanStatus"<>'clean')) THEN
      RAISE EXCEPTION 'Author asset must reserve or copy a clean ready blob' USING ERRCODE='23514'; END IF;
  ELSE
    IF OLD."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND NEW.status NOT IN ('deleting','deleted') THEN
      RAISE EXCEPTION 'Expired author asset reservation' USING ERRCODE='23514'; END IF;
    IF OLD.status='deleted' OR NEW.version<>OLD.version+1 OR
      (NEW.id,NEW."blobId",NEW."ownerKind",NEW."tenantId",NEW."serviceId",NEW."createdById",NEW.purpose,NEW.size,NEW."createdAt") IS DISTINCT FROM
      (OLD.id,OLD."blobId",OLD."ownerKind",OLD."tenantId",OLD."serviceId",OLD."createdById",OLD.purpose,OLD.size,OLD."createdAt")
      OR (NEW."nameCipher" IS DISTINCT FROM OLD."nameCipher" AND NOT (NEW.status='deleted' AND NEW."nameCipher" IS NULL)) THEN
      RAISE EXCEPTION 'Immutable author asset ownership/metadata/revision' USING ERRCODE='23514'; END IF;
    IF NEW.status<>OLD.status AND NOT ((OLD.status='pending' AND NEW.status IN ('uploaded','rejected','deleting'))
      OR (OLD.status='uploaded' AND NEW.status IN ('ready','rejected','deleting')) OR (OLD.status IN ('ready','rejected') AND NEW.status='deleting')
      OR (OLD.status='deleting' AND NEW.status='deleted')) THEN RAISE EXCEPTION 'Invalid author asset transition' USING ERRCODE='23514'; END IF;
    IF NEW.status='ready' AND OLD.status<>'ready' AND (b.status<>'ready' OR b."scanStatus"<>'clean') THEN
      RAISE EXCEPTION 'Author asset requires clean blob' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.status IN ('deleting','deleted') AND (EXISTS (SELECT 1 FROM "AuthorAssetReference" WHERE "assetId"=NEW.id)
    OR EXISTS (SELECT 1 FROM "QuestionOption" WHERE "optionImageKey"=NEW.id)
    OR EXISTS (SELECT 1 FROM "Question" WHERE "questionImageKey"=NEW.id)) THEN
    RAISE EXCEPTION 'Author asset still referenced' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION author_asset_expected(content jsonb)
RETURNS TABLE(question_key text,slot text,order_number integer,option_key text,asset_id text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE q jsonb; m jsonb; o jsonb; images integer; key text;
BEGIN
  IF content IS NULL OR content='null'::jsonb THEN RETURN; END IF;
  IF jsonb_typeof(content->'questions') IS DISTINCT FROM 'array' THEN RETURN; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(content->'questions') LOOP
    IF q->'questionImageKey' IS NOT NULL AND q->'questionImageKey'<>'null'::jsonb THEN
      key:=q->>'questionImageKey';
      IF jsonb_typeof(q->'questionImageKey') IS DISTINCT FROM 'string'
        OR key !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid question image key' USING ERRCODE='23514'; END IF;
      question_key:=q->>'id'; slot:='question'; order_number:=NULL; option_key:=NULL; asset_id:=key; RETURN NEXT;
    END IF;
    IF q->'materialList' IS NOT NULL AND q->'materialList'<>'null'::jsonb THEN
      IF NOT valid_question_material_links(q->'materialList') THEN RAISE EXCEPTION 'Invalid author material list' USING ERRCODE='23514'; END IF;
      FOR m IN SELECT value FROM jsonb_array_elements(q->'materialList') WHERE value->>'materialType'='FILE' LOOP
        question_key:=q->>'id'; slot:='material'; order_number:=(m->>'orderNumber')::integer; option_key:=NULL; asset_id:=m->>'fileKey'; RETURN NEXT;
      END LOOP;
    END IF;
    images:=0;
    IF jsonb_typeof(q->'optionDefinitions')='array' THEN
      FOR o IN SELECT value FROM jsonb_array_elements(q->'optionDefinitions') LOOP
        IF o->'optionImageKey' IS NULL OR o->'optionImageKey'='null'::jsonb THEN CONTINUE; END IF;
        key:=o->>'optionImageKey'; images:=images+1;
        IF jsonb_typeof(o->'optionImageKey') IS DISTINCT FROM 'string' OR key !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          OR q->>'type' NOT IN ('객관식 답변','체크박스') OR q->>'type' IS NULL
          OR coalesce(o->'isCustomValue','null'::jsonb) NOT IN ('null'::jsonb,'false'::jsonb) OR images>20 THEN
          RAISE EXCEPTION 'Invalid option image type, custom flag or count' USING ERRCODE='23514';
        END IF;
        question_key:=q->>'id'; slot:='option'; order_number:=NULL; option_key:=o->>'id'; asset_id:=key; RETURN NEXT;
      END LOOP;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION author_asset_version_content(version_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('questions',coalesce(jsonb_agg(jsonb_build_object('id',q."stableKey",'type',q.type,'questionImageKey',q."questionImageKey",'materialList',q."materialList",
    'optionDefinitions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',coalesce(o."stableKey",o.id),'optionImageKey',o."optionImageKey",'isCustomValue',o."isCustomValue"))
      FROM "QuestionOption" o WHERE o."questionId"=q.id),'[]'::jsonb))),'[]'::jsonb))
  FROM "Question" q WHERE q."formVersionId"=version_id
$$;

CREATE OR REPLACE FUNCTION validate_author_asset_parent(kind text,parent_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE tenant_id text; service_id text; content jsonb; expected jsonb; actual jsonb;
BEGIN
  PERFORM lock_author_asset_parent(kind,parent_id);
  IF kind='version' THEN
    SELECT v."tenantId",f."serviceId",author_asset_version_content(v.id) INTO tenant_id,service_id,content
      FROM "FormVersion" v JOIN "Form" f ON f.id=v."formId" WHERE v.id=parent_id;
  ELSIF kind='template' THEN
    SELECT t."tenantId",t."serviceId",t.content INTO tenant_id,service_id,content FROM "FormTemplate" t WHERE t.id=parent_id;
  ELSE
    SELECT a."tenantId",f."serviceId",a.snapshot->'content' INTO tenant_id,service_id,content
      FROM "ApprovalRequest" a JOIN "Form" f ON f.id=a."formId" WHERE a.id=parent_id;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) INTO expected FROM (
    SELECT jsonb_build_array(e.question_key,e.slot,e.order_number,e.option_key,e.asset_id) v FROM author_asset_expected(content) e
  ) projected;
  SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) INTO actual FROM (
    SELECT jsonb_build_array(r."questionKey",r.slot,r."orderNumber",r."optionKey",r."assetId") v FROM "AuthorAssetReference" r
    WHERE (kind='version' AND r."formVersionId"=parent_id) OR (kind='template' AND r."templateId"=parent_id) OR (kind='approval' AND r."approvalId"=parent_id)
  ) projected;
  IF expected<>actual THEN RAISE EXCEPTION 'Author asset JSON and pins differ' USING ERRCODE='23514'; END IF;
  IF expected='[]'::jsonb THEN RETURN; END IF;
  PERFORM author_asset_read_committed();
  -- Acquire asset rows in deterministic order, then query again with a fresh RC snapshot.
  PERFORM a.id FROM "AuthorAsset" a WHERE a.id IN (SELECT e.asset_id FROM author_asset_expected(content) e) ORDER BY a.id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "AuthorAssetReference" r JOIN "AuthorAsset" a ON a.id=r."assetId" JOIN "AuthorAssetBlob" b ON b.id=a."blobId"
    WHERE ((kind='version' AND r."formVersionId"=parent_id) OR (kind='template' AND r."templateId"=parent_id) OR (kind='approval' AND r."approvalId"=parent_id))
      AND (r."tenantId" IS DISTINCT FROM tenant_id OR r."serviceId" IS DISTINCT FROM service_id
        OR a."tenantId" IS DISTINCT FROM tenant_id OR a."serviceId" IS DISTINCT FROM service_id
        OR a."ownerKind"<>CASE WHEN tenant_id IS NULL THEN 'system' ELSE 'company' END
        OR a.status<>'ready' OR a."expiresAt" IS NOT NULL OR b.status NOT IN ('ready','quarantined')
        OR a.purpose<>CASE r.slot WHEN 'material' THEN 'QUESTION_MATERIAL' WHEN 'option' THEN 'OPTION_IMAGE' WHEN 'question' THEN 'QUESTION_IMAGE' END
        OR (kind='version' AND NOT EXISTS (SELECT 1 FROM "Question" q WHERE q.id=r."questionId" AND q."stableKey"=r."questionKey"
          AND q."formVersionId"=parent_id AND q."tenantId"=tenant_id)))
  ) THEN RAISE EXCEPTION 'Author asset parent scope, purpose or readiness mismatch' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION lock_author_asset_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_content jsonb; new_content jsonb; version_id text; parent_kind text; parent_id text; keys text[];
BEGIN
  IF TG_TABLE_NAME='Question' THEN
    IF TG_OP<>'INSERT' THEN old_content:=jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('id',OLD."stableKey",'type',OLD.type,'questionImageKey',OLD."questionImageKey",'materialList',OLD."materialList"))); END IF;
    IF TG_OP<>'DELETE' THEN new_content:=jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('id',NEW."stableKey",'type',NEW.type,'questionImageKey',NEW."questionImageKey",'materialList',NEW."materialList"))); END IF;
    version_id:=CASE WHEN TG_OP='DELETE' THEN OLD."formVersionId" ELSE NEW."formVersionId" END;
    -- Type transitions also need to fence existing option images.
    IF TG_OP<>'INSERT' THEN
      old_content:=jsonb_set(old_content,'{questions,0,optionDefinitions}',coalesce((SELECT jsonb_agg(jsonb_build_object('id',coalesce(o."stableKey",o.id),'optionImageKey',o."optionImageKey",'isCustomValue',o."isCustomValue")) FROM "QuestionOption" o WHERE o."questionId"=OLD.id),'[]'::jsonb));
    END IF;
    parent_kind:='version'; parent_id:=version_id;
  ELSIF TG_TABLE_NAME='QuestionOption' THEN
    SELECT "formVersionId" INTO version_id FROM "Question" WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD."questionId" ELSE NEW."questionId" END;
    parent_kind:='version'; parent_id:=version_id;
    keys:=ARRAY[]::text[];
    IF TG_OP<>'INSERT' AND OLD."optionImageKey" IS NOT NULL THEN keys:=array_append(keys,OLD."optionImageKey"); END IF;
    IF TG_OP<>'DELETE' AND NEW."optionImageKey" IS NOT NULL THEN keys:=array_append(keys,NEW."optionImageKey"); END IF;
  ELSIF TG_TABLE_NAME='FormTemplate' THEN
    IF TG_OP<>'INSERT' THEN old_content:=OLD.content; END IF;
    IF TG_OP<>'DELETE' THEN new_content:=NEW.content; END IF;
    parent_kind:='template'; parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    IF TG_OP<>'INSERT' THEN old_content:=OLD.snapshot->'content'; END IF;
    IF TG_OP<>'DELETE' THEN new_content:=NEW.snapshot->'content'; END IF;
    parent_kind:='approval'; parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  END IF;
  IF keys IS NULL THEN SELECT array_agg(DISTINCT asset_id) INTO keys FROM (
    SELECT e.asset_id FROM author_asset_expected(old_content) e UNION ALL SELECT e.asset_id FROM author_asset_expected(new_content) e
  ) all_keys; END IF;
  IF coalesce(cardinality(keys),0)>0 THEN
    PERFORM author_asset_read_committed();
    PERFORM lock_author_asset_parent(parent_kind,parent_id);
    PERFORM id FROM "AuthorAsset" WHERE id=ANY(keys) ORDER BY id FOR UPDATE;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMIT;
