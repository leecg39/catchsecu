BEGIN;
ALTER TABLE "FileObject" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "attachmentSnapshot" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_campaign_fkey" FOREIGN KEY ("tenantId","serviceId","campaignId") REFERENCES "Campaign"("tenantId","serviceId",id) ON DELETE RESTRICT;
CREATE INDEX "FileObject_campaign" ON "FileObject"("campaignId",status);
ALTER TABLE "FileObject" DROP CONSTRAINT "FileObject_owner_check", DROP CONSTRAINT "FileObject_attached_check";
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_owner_check" CHECK (
 ("ownerKind" IN ('member','import','sender','campaign') AND "ownerId" IS NOT NULL AND "uploadTokenHash" IS NULL) OR
 ("ownerKind"='public' AND "ownerId" IS NULL AND "publicationId" IS NOT NULL AND ((status IN ('pending','uploaded','ready','rejected') AND "uploadTokenHash" IS NOT NULL) OR (status IN ('attached','deleting','deleted') AND "uploadTokenHash" IS NULL)))),
 ADD CONSTRAINT "FileObject_attached_check" CHECK (status<>'attached' OR (("submissionId" IS NOT NULL OR "senderId" IS NOT NULL OR "campaignId" IS NOT NULL) AND "expiresAt" IS NULL AND "uploadTokenHash" IS NULL)),
 ADD CONSTRAINT "FileObject_campaign_shape" CHECK (("ownerKind"='campaign' AND "campaignId" IS NOT NULL AND "senderId" IS NULL AND "submissionId" IS NULL AND "publicationId" IS NULL AND "formVersionId" IS NULL AND "questionId" IS NULL) OR ("ownerKind"<>'campaign' AND "campaignId" IS NULL));
CREATE FUNCTION check_campaign_file() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "Campaign";
BEGIN
 IF TG_OP='UPDATE' AND NEW."campaignId" IS DISTINCT FROM OLD."campaignId" THEN RAISE EXCEPTION 'immutable campaign file binding' USING ERRCODE='23514'; END IF;
 IF NEW."campaignId" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM "Campaign" WHERE id=NEW."campaignId";
 IF NEW.status NOT IN ('deleting','deleted') AND (c.channel<>'email' OR c.status IN ('deleted','expired') OR c."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'campaign file unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM id FROM "Campaign" WHERE id=NEW."campaignId" FOR UPDATE;
  IF c.status<>'draft' OR (SELECT count(*) FROM "FileObject" WHERE "campaignId"=NEW."campaignId" AND status NOT IN ('deleting','deleted'))>=5
   OR (SELECT COALESCE(sum(size),0) FROM "FileObject" WHERE "campaignId"=NEW."campaignId" AND status NOT IN ('deleting','deleted'))+NEW.size>20971520
  THEN RAISE EXCEPTION 'campaign attachment limit or state' USING ERRCODE='23514'; END IF;
 ELSE
  IF c.status<>'draft' AND (NEW.status NOT IN ('deleting','deleted') OR (c.status NOT IN ('deleted','expired') AND c."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')))
  THEN RAISE EXCEPTION 'requested campaign attachment immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FileObject_campaign_guard" BEFORE INSERT OR UPDATE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION check_campaign_file();
CREATE FUNCTION check_campaign_attachments() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status<>'draft' AND NEW."attachmentSnapshot" IS DISTINCT FROM OLD."attachmentSnapshot" THEN RAISE EXCEPTION 'immutable attachment snapshot' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('deleted','expired') AND EXISTS(SELECT 1 FROM "FileObject" WHERE "campaignId"=NEW.id AND status NOT IN ('deleting','deleted')) THEN RAISE EXCEPTION 'campaign files must be removed' USING ERRCODE='23514'; END IF;
 IF NEW.status='draft' AND NEW."attachmentSnapshot"<>'[]'::jsonb THEN RAISE EXCEPTION 'draft attachment snapshot must be empty' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status='scheduled' THEN
  IF EXISTS(SELECT 1 FROM "FileObject" WHERE "campaignId"=NEW.id AND status NOT IN ('attached','deleting','deleted')) THEN RAISE EXCEPTION 'unfinished attachments' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'size',size,'mime',mime) ORDER BY id),'[]'::jsonb) INTO expected FROM "FileObject" WHERE "campaignId"=NEW.id AND status='attached';
  IF NEW."attachmentSnapshot"<>expected OR (expected<>'[]'::jsonb AND NEW."mailProtocol"<>'mail.campaign.v2') THEN RAISE EXCEPTION 'exact attachment snapshot required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Campaign_attachments_guard" BEFORE INSERT OR UPDATE ON "Campaign" FOR EACH ROW EXECUTE FUNCTION check_campaign_attachments();
COMMIT;
