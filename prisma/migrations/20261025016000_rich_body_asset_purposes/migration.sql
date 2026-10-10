BEGIN;

-- Add four distinct rich-body image purposes without widening the legacy
-- question material (5 MiB) or question/option image (1 MiB) contracts.
ALTER TABLE "AuthorAssetBlob" DROP CONSTRAINT "AuthorAssetBlob_identity_check";
ALTER TABLE "AuthorAssetBlob" ADD CONSTRAINT "AuthorAssetBlob_identity_check" CHECK (
  id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  AND "storageKey" ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  AND sha256 ~ '^[a-f0-9]{64}$' AND size BETWEEN 1 AND 14680064
  AND "validationVersion">0 AND version>0);

ALTER TABLE "AuthorAsset" DROP CONSTRAINT "AuthorAsset_metadata_check";
ALTER TABLE "AuthorAsset" ADD CONSTRAINT "AuthorAsset_metadata_check" CHECK (
  id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  AND purpose IN ('QUESTION_MATERIAL','OPTION_IMAGE','QUESTION_IMAGE','FORM_CONTENT_IMAGE','PAGE_CONTENT_IMAGE','END_PAGE_CONTENT_IMAGE','PRIVATE_PAGE_CONTENT_IMAGE')
  AND size BETWEEN 1 AND 14680064 AND version>0
  AND (purpose<>'QUESTION_MATERIAL' OR size<=5242880)
  AND (purpose NOT IN ('OPTION_IMAGE','QUESTION_IMAGE') OR size<=1048576)
  AND (status='deleted' OR ("nameCipher" IS NOT NULL AND length("nameCipher")>0)));

CREATE OR REPLACE FUNCTION check_author_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "AuthorAssetBlob";
BEGIN
  PERFORM author_asset_read_committed();
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Keep author asset tombstones' USING ERRCODE='23514'; END IF;
  IF NEW."expiresAt">((clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)+interval '1 hour') THEN
    RAISE EXCEPTION 'Author asset reservation cannot exceed one hour' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "AuthorAssetBlob" WHERE id=NEW."blobId" FOR UPDATE;
  SELECT * INTO b FROM "AuthorAssetBlob" WHERE id=NEW."blobId";
  IF b.id IS NULL OR NEW.size<>b.size OR
    (NEW.purpose IN ('OPTION_IMAGE','QUESTION_IMAGE','FORM_CONTENT_IMAGE','PAGE_CONTENT_IMAGE','END_PAGE_CONTENT_IMAGE','PRIVATE_PAGE_CONTENT_IMAGE')
      AND b.mime NOT IN ('image/jpeg','image/png'))
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

COMMIT;
