-- Additive author-owned assets. No existing question, receipt, answer or snapshot is rewritten.
CREATE TABLE "AuthorAssetBlob" (
  id TEXT PRIMARY KEY, "storageKey" TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, "validationVersion" INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending', "scanStatus" TEXT NOT NULL DEFAULT 'pending',
  "scanEngine" TEXT, "scannedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP + interval '1 hour', "leaseUntil" TIMESTAMP(3),
  version INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthorAssetBlob_identity_check" CHECK (id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    AND "storageKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' AND sha256 ~ '^[a-f0-9]{64}$'
    AND size BETWEEN 1 AND 5242880 AND "validationVersion">0 AND version>0),
  CONSTRAINT "AuthorAssetBlob_mime_check" CHECK (mime IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/postscript','image/jpeg','image/png')),
  CONSTRAINT "AuthorAssetBlob_state_check" CHECK (status IN ('pending','uploaded','ready','quarantined','deleting','deleted')
    AND "scanStatus" IN ('pending','clean','infected','error')
    AND (status<>'ready' OR ("scanStatus"='clean' AND "scanEngine" IS NOT NULL AND "scannedAt" IS NOT NULL)))
);
CREATE INDEX "AuthorAssetBlob_status_expiresAt_idx" ON "AuthorAssetBlob"(status,"expiresAt");
CREATE TABLE "AuthorAsset" (
  id TEXT PRIMARY KEY, "blobId" TEXT NOT NULL, "ownerKind" TEXT NOT NULL DEFAULT 'company',
  "tenantId" TEXT, "serviceId" TEXT, "createdById" TEXT, purpose TEXT NOT NULL, "nameCipher" TEXT, size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP + interval '1 hour',
  version INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthorAsset_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "AuthorAssetBlob"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAsset_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId","serviceId") REFERENCES "Service"("tenantId",id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAsset_tenantId_createdById_fkey" FOREIGN KEY ("tenantId","createdById") REFERENCES "Membership"("tenantId",id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAsset_scope_check" CHECK (("ownerKind"='company' AND "tenantId" IS NOT NULL AND "serviceId" IS NOT NULL AND "createdById" IS NOT NULL)
    OR ("ownerKind"='system' AND "tenantId" IS NULL AND "serviceId" IS NULL AND "createdById" IS NULL)),
  CONSTRAINT "AuthorAsset_metadata_check" CHECK (id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    AND purpose IN ('QUESTION_MATERIAL','OPTION_IMAGE') AND size BETWEEN 1 AND 5242880 AND version>0
    AND (purpose<>'OPTION_IMAGE' OR size<=1048576)
    AND (status='deleted' OR ("nameCipher" IS NOT NULL AND length("nameCipher")>0))),
  CONSTRAINT "AuthorAsset_state_check" CHECK (status IN ('pending','uploaded','ready','rejected','deleting','deleted'))
);
CREATE INDEX "AuthorAsset_tenantId_serviceId_status_idx" ON "AuthorAsset"("tenantId","serviceId",status);
CREATE INDEX "AuthorAsset_blobId_status_idx" ON "AuthorAsset"("blobId",status);
CREATE INDEX "AuthorAsset_status_expiresAt_idx" ON "AuthorAsset"(status,"expiresAt");
CREATE TABLE "AuthorAssetReference" (
  id TEXT PRIMARY KEY, "assetId" TEXT NOT NULL, "tenantId" TEXT, "serviceId" TEXT,
  "formVersionId" TEXT, "questionId" TEXT, "templateId" TEXT, "approvalId" TEXT,
  "questionKey" TEXT NOT NULL, slot TEXT NOT NULL, "orderNumber" INTEGER, "optionKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthorAssetReference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AuthorAsset"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAssetReference_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAssetReference_tenantId_formVersionId_questionId_fkey" FOREIGN KEY ("tenantId","formVersionId","questionId") REFERENCES "Question"("tenantId","formVersionId",id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAssetReference_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAssetReference_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApprovalRequest"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "AuthorAssetReference_parent_check" CHECK (num_nonnulls("formVersionId","templateId","approvalId")=1
    AND (("formVersionId" IS NOT NULL AND "questionId" IS NOT NULL AND "tenantId" IS NOT NULL AND "serviceId" IS NOT NULL)
      OR ("formVersionId" IS NULL AND "questionId" IS NULL))),
  CONSTRAINT "AuthorAssetReference_slot_check" CHECK ((slot='material' AND "orderNumber" IS NOT NULL AND "orderNumber" BETWEEN 0 AND 2 AND "optionKey" IS NULL)
    OR (slot='option' AND "orderNumber" IS NULL AND "optionKey" IS NOT NULL)),
  CONSTRAINT "AuthorAssetReference_key_check" CHECK ("questionKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    AND ("optionKey" IS NULL OR "optionKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'))
);
CREATE INDEX "AuthorAssetReference_assetId_idx" ON "AuthorAssetReference"("assetId");
CREATE INDEX "AuthorAssetReference_formVersionId_idx" ON "AuthorAssetReference"("formVersionId");
CREATE INDEX "AuthorAssetReference_templateId_idx" ON "AuthorAssetReference"("templateId");
CREATE INDEX "AuthorAssetReference_approvalId_idx" ON "AuthorAssetReference"("approvalId");
CREATE INDEX "AuthorAssetReference_tenantId_formVersionId_questionId_idx" ON "AuthorAssetReference"("tenantId","formVersionId","questionId");
CREATE UNIQUE INDEX "AuthorAssetReference_parent_slot_unique" ON "AuthorAssetReference"
  (coalesce("formVersionId",''),coalesce("templateId",''),coalesce("approvalId",''),"questionKey",slot,coalesce("orderNumber",-1),coalesce("optionKey",''));
ALTER TABLE "QuestionOption" ADD COLUMN "optionImageKey" TEXT;
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_optionImageKey_fkey" FOREIGN KEY ("optionImageKey") REFERENCES "AuthorAsset"(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "QuestionOption_optionImageKey_idx" ON "QuestionOption"("optionImageKey");

-- Preserve the original LINK validator byte-for-byte under a private SQL name.
ALTER FUNCTION valid_question_material_links(jsonb) RENAME TO valid_question_material_links_v119;
CREATE FUNCTION valid_question_material_links(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE item jsonb; ordinal bigint; singleton jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value)>3 THEN RETURN false; END IF;
  FOR item,ordinal IN SELECT v,n FROM jsonb_array_elements(value) WITH ORDINALITY entries(v,n) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (item-ARRAY['materialType','orderNumber','fileKey','linkLabel','linkUrl'])<>'{}'::jsonb
      OR NOT (item ?& ARRAY['materialType','orderNumber','fileKey','linkLabel','linkUrl'])
      OR jsonb_typeof(item->'orderNumber') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    IF (item->>'orderNumber')::numeric<>ordinal-1 THEN RETURN false; END IF;
    IF item->>'materialType'='LINK' THEN
      singleton:=jsonb_build_array(jsonb_set(item,'{orderNumber}','0'::jsonb));
      IF NOT valid_question_material_links_v119(singleton) THEN RETURN false; END IF;
    ELSIF item->>'materialType'='FILE' THEN
      IF jsonb_typeof(item->'fileKey') IS DISTINCT FROM 'string' OR (item->>'fileKey') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        OR item->'linkLabel' IS DISTINCT FROM 'null'::jsonb OR item->'linkUrl' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
-- The previous CHECK references a function OID; replace it so FILE uses the new wrapper.
ALTER TABLE "Question" DROP CONSTRAINT "Question_material_list_check";
ALTER TABLE "Question" ADD CONSTRAINT "Question_material_list_check" CHECK ("materialList" IS NULL OR valid_question_material_links("materialList"));

CREATE FUNCTION author_asset_read_committed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Author asset mutations require READ COMMITTED' USING ERRCODE='0A000';
  END IF;
END $$;

-- One canonical projection for actual version rows and template/approval JSON.
CREATE FUNCTION author_asset_expected(content jsonb)
RETURNS TABLE(question_key text,slot text,order_number integer,option_key text,asset_id text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE q jsonb; m jsonb; o jsonb; images integer; key text;
BEGIN
  IF content IS NULL OR content='null'::jsonb THEN RETURN; END IF;
  IF jsonb_typeof(content->'questions') IS DISTINCT FROM 'array' THEN RETURN; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(content->'questions') LOOP
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

CREATE FUNCTION author_asset_version_content(version_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('questions',coalesce(jsonb_agg(jsonb_build_object('id',q."stableKey",'type',q.type,'materialList',q."materialList",
    'optionDefinitions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',coalesce(o."stableKey",o.id),'optionImageKey',o."optionImageKey",'isCustomValue',o."isCustomValue"))
      FROM "QuestionOption" o WHERE o."questionId"=q.id),'[]'::jsonb))),'[]'::jsonb))
  FROM "Question" q WHERE q."formVersionId"=version_id
$$;

CREATE FUNCTION check_author_asset_blob() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM author_asset_read_committed();
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Keep author blob tombstones' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending' OR NEW."scanStatus"<>'pending' OR NEW.version<>1 OR NEW."expiresAt" IS NULL THEN
      RAISE EXCEPTION 'Author blob must start as a durable pending reservation' USING ERRCODE='23514'; END IF;
  ELSE
    IF OLD.status='deleted' OR NEW.version<>OLD.version+1 OR
      (NEW.id,NEW."storageKey",NEW.mime,NEW.size,NEW.sha256,NEW."validationVersion",NEW."createdAt") IS DISTINCT FROM
      (OLD.id,OLD."storageKey",OLD.mime,OLD.size,OLD.sha256,OLD."validationVersion",OLD."createdAt") THEN
      RAISE EXCEPTION 'Immutable author blob identity/revision' USING ERRCODE='23514'; END IF;
    IF NEW.status<>OLD.status AND NOT ((OLD.status='pending' AND NEW.status IN ('uploaded','deleting'))
      OR (OLD.status='uploaded' AND NEW.status IN ('ready','quarantined','deleting'))
      OR (OLD.status='ready' AND NEW.status IN ('quarantined','deleting')) OR (OLD.status='quarantined' AND NEW.status IN ('ready','deleting'))
      OR (OLD.status='deleting' AND NEW.status='deleted')) THEN RAISE EXCEPTION 'Invalid author blob transition' USING ERRCODE='23514'; END IF;
  END IF;
  -- The row being updated is the serialization fence. Every asset insert locks this blob.
  IF NEW.status IN ('deleting','deleted') AND EXISTS (SELECT 1 FROM "AuthorAsset" WHERE "blobId"=NEW.id AND status<>'deleted') THEN
    RAISE EXCEPTION 'Author blob still owns live assets' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AuthorAssetBlob_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AuthorAssetBlob" FOR EACH ROW EXECUTE FUNCTION check_author_asset_blob();

CREATE FUNCTION check_author_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "AuthorAssetBlob";
BEGIN
  PERFORM author_asset_read_committed();
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Keep author asset tombstones' USING ERRCODE='23514'; END IF;
  IF NEW."expiresAt">((clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour') THEN
    RAISE EXCEPTION 'Author asset reservation cannot exceed one hour' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "AuthorAssetBlob" WHERE id=NEW."blobId" FOR UPDATE;
  SELECT * INTO b FROM "AuthorAssetBlob" WHERE id=NEW."blobId";
  IF b.id IS NULL OR NEW.size<>b.size OR (NEW.purpose='OPTION_IMAGE' AND b.mime NOT IN ('image/jpeg','image/png'))
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
    OR EXISTS (SELECT 1 FROM "QuestionOption" WHERE "optionImageKey"=NEW.id)) THEN
    RAISE EXCEPTION 'Author asset still referenced' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AuthorAsset_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AuthorAsset" FOR EACH ROW EXECUTE FUNCTION check_author_asset();

CREATE FUNCTION lock_author_asset_parent(kind text,parent_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE form_id text;
BEGIN
  IF kind='version' THEN
    SELECT "formId" INTO form_id FROM "FormVersion" WHERE id=parent_id;
    PERFORM id FROM "Form" WHERE id=form_id FOR UPDATE;
    PERFORM id FROM "FormVersion" WHERE id=parent_id FOR UPDATE;
  ELSIF kind='template' THEN PERFORM id FROM "FormTemplate" WHERE id=parent_id FOR UPDATE;
  ELSE
    SELECT "formId" INTO form_id FROM "ApprovalRequest" WHERE id=parent_id;
    PERFORM id FROM "Form" WHERE id=form_id FOR UPDATE;
    PERFORM id FROM "ApprovalRequest" WHERE id=parent_id FOR UPDATE;
  END IF;
END $$;

CREATE FUNCTION check_author_asset_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "AuthorAssetReference"; a "AuthorAsset"; b "AuthorAssetBlob"; parent_kind text; parent_id text; parent_status text;
BEGIN
  PERFORM author_asset_read_committed();
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Author asset pins are immutable; replace draft pins' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
  parent_kind:=CASE WHEN r."formVersionId" IS NOT NULL THEN 'version' WHEN r."templateId" IS NOT NULL THEN 'template' ELSE 'approval' END;
  parent_id:=coalesce(r."formVersionId",r."templateId",r."approvalId");
  PERFORM lock_author_asset_parent(parent_kind,parent_id);
  IF parent_kind='version' THEN
    SELECT status INTO parent_status FROM "FormVersion" WHERE id=parent_id;
    IF parent_status='published' THEN RAISE EXCEPTION 'Published author asset pins are immutable' USING ERRCODE='23514'; END IF;
  ELSIF parent_kind='approval' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Approval author asset pins are immutable' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "ApprovalRequest" WHERE id=parent_id AND xmin::text=((txid_current()%4294967296)::text)) THEN
      RAISE EXCEPTION 'Approval pins must be written in the approval transaction' USING ERRCODE='23514'; END IF;
  END IF;
  PERFORM id FROM "AuthorAsset" WHERE id=r."assetId" FOR UPDATE;
  SELECT * INTO a FROM "AuthorAsset" WHERE id=r."assetId";
  PERFORM id FROM "AuthorAssetBlob" WHERE id=a."blobId" FOR SHARE;
  SELECT * INTO b FROM "AuthorAssetBlob" WHERE id=a."blobId";
  IF TG_OP='INSERT' AND (a.id IS NULL OR a.status<>'ready' OR b.status<>'ready' OR b."scanStatus"<>'clean'
    OR (a."expiresAt" IS NOT NULL AND a."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC'))) THEN
    RAISE EXCEPTION 'Pin requires a live clean author asset' USING ERRCODE='23514'; END IF;
  RETURN r;
END $$;
CREATE TRIGGER "AuthorAssetReference_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AuthorAssetReference" FOR EACH ROW EXECUTE FUNCTION check_author_asset_reference();

CREATE FUNCTION validate_author_asset_parent(kind text,parent_id text) RETURNS void LANGUAGE plpgsql AS $$
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
        OR a.purpose<>CASE WHEN r.slot='material' THEN 'QUESTION_MATERIAL' ELSE 'OPTION_IMAGE' END
        OR (kind='version' AND NOT EXISTS (SELECT 1 FROM "Question" q WHERE q.id=r."questionId" AND q."stableKey"=r."questionKey"
          AND q."formVersionId"=parent_id AND q."tenantId"=tenant_id)))
  ) THEN RAISE EXCEPTION 'Author asset parent scope, purpose or readiness mismatch' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION validate_author_asset_lifetime(asset_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a "AuthorAsset"; pinned boolean;
BEGIN
  PERFORM id FROM "AuthorAsset" WHERE id=asset_id FOR UPDATE;
  SELECT * INTO a FROM "AuthorAsset" WHERE id=asset_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM "AuthorAssetReference" WHERE "assetId"=asset_id) INTO pinned;
  IF (pinned AND (a.status<>'ready' OR a."expiresAt" IS NOT NULL))
    OR (NOT pinned AND a.status IN ('pending','uploaded','ready','rejected') AND a."expiresAt" IS NULL) THEN
    RAISE EXCEPTION 'Author asset reservation/pin lifetime mismatch' USING ERRCODE='23514'; END IF;
END $$;

-- Lock referenced assets before changing a parent. This is the other side of the GC
-- fence; only a deferred SELECT would leave an attach/delete write-skew window.
CREATE FUNCTION lock_author_asset_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_content jsonb; new_content jsonb; version_id text; parent_kind text; parent_id text; keys text[];
BEGIN
  IF TG_TABLE_NAME='Question' THEN
    IF TG_OP<>'INSERT' THEN old_content:=jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('id',OLD."stableKey",'type',OLD.type,'materialList',OLD."materialList"))); END IF;
    IF TG_OP<>'DELETE' THEN new_content:=jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('id',NEW."stableKey",'type',NEW.type,'materialList',NEW."materialList"))); END IF;
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
CREATE TRIGGER "Question_author_asset_lock" BEFORE INSERT OR UPDATE OR DELETE ON "Question" FOR EACH ROW EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "QuestionOption_author_asset_lock" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionOption" FOR EACH ROW EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "FormTemplate_author_asset_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FormTemplate" FOR EACH ROW EXECUTE FUNCTION lock_author_asset_content();
CREATE TRIGGER "ApprovalRequest_author_asset_lock" BEFORE INSERT OR UPDATE OR DELETE ON "ApprovalRequest" FOR EACH ROW EXECUTE FUNCTION lock_author_asset_content();

CREATE FUNCTION check_author_asset_graph() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text; r record; a_id text;
BEGIN
  IF TG_TABLE_NAME='AuthorAssetReference' THEN
    IF TG_OP='DELETE' THEN
      PERFORM validate_author_asset_parent(CASE WHEN OLD."formVersionId" IS NOT NULL THEN 'version' WHEN OLD."templateId" IS NOT NULL THEN 'template' ELSE 'approval' END,coalesce(OLD."formVersionId",OLD."templateId",OLD."approvalId"));
      PERFORM validate_author_asset_lifetime(OLD."assetId");
    ELSE
      PERFORM validate_author_asset_parent(CASE WHEN NEW."formVersionId" IS NOT NULL THEN 'version' WHEN NEW."templateId" IS NOT NULL THEN 'template' ELSE 'approval' END,coalesce(NEW."formVersionId",NEW."templateId",NEW."approvalId"));
      PERFORM validate_author_asset_lifetime(NEW."assetId");
    END IF;
  ELSIF TG_TABLE_NAME='AuthorAsset' THEN
    PERFORM validate_author_asset_lifetime(NEW.id);
  ELSIF TG_TABLE_NAME='Question' THEN
    IF TG_OP<>'INSERT' THEN PERFORM validate_author_asset_parent('version',OLD."formVersionId"); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM validate_author_asset_parent('version',NEW."formVersionId"); END IF;
  ELSIF TG_TABLE_NAME='QuestionOption' THEN
    IF TG_OP<>'INSERT' THEN
      SELECT "formVersionId" INTO parent_id FROM "Question" WHERE id=OLD."questionId";
      IF parent_id IS NOT NULL THEN PERFORM validate_author_asset_parent('version',parent_id); END IF;
    END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT "formVersionId" INTO parent_id FROM "Question" WHERE id=NEW."questionId";
      IF parent_id IS NOT NULL THEN PERFORM validate_author_asset_parent('version',parent_id); END IF;
    END IF;
  ELSIF TG_TABLE_NAME='FormVersion' THEN
    IF TG_OP<>'DELETE' THEN PERFORM validate_author_asset_parent('version',NEW.id); END IF;
  ELSIF TG_TABLE_NAME='FormTemplate' THEN
    IF TG_OP<>'DELETE' THEN PERFORM validate_author_asset_parent('template',NEW.id); END IF;
  ELSIF TG_TABLE_NAME='ApprovalRequest' THEN
    PERFORM validate_author_asset_parent('approval',NEW.id);
  ELSIF TG_TABLE_NAME='Form' THEN
    FOR r IN SELECT id FROM "FormVersion" WHERE "formId"=NEW.id LOOP PERFORM validate_author_asset_parent('version',r.id); END LOOP;
    FOR r IN SELECT id FROM "ApprovalRequest" WHERE "formId"=NEW.id LOOP PERFORM validate_author_asset_parent('approval',r.id); END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "AuthorAssetReference_consistency" AFTER INSERT OR UPDATE OR DELETE ON "AuthorAssetReference" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "AuthorAsset_lifetime" AFTER INSERT OR UPDATE ON "AuthorAsset" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "Question_author_asset_consistency" AFTER INSERT OR UPDATE OR DELETE ON "Question" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "QuestionOption_author_asset_consistency" AFTER INSERT OR UPDATE OR DELETE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "FormVersion_author_asset_consistency" AFTER INSERT OR UPDATE ON "FormVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "FormTemplate_author_asset_consistency" AFTER INSERT OR UPDATE ON "FormTemplate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "ApprovalRequest_author_asset_consistency" AFTER INSERT OR UPDATE ON "ApprovalRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
CREATE CONSTRAINT TRIGGER "Form_author_asset_consistency" AFTER UPDATE ON "Form" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_author_asset_graph();
