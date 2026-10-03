BEGIN;
ALTER TABLE "Campaign" ADD COLUMN "requesterId" TEXT;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_requesterId_fkey"
 FOREIGN KEY ("tenantId","requesterId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT ON UPDATE CASCADE;
WITH changed AS (
 UPDATE "Campaign" SET "requesterId"="creatorId",version=version+1 WHERE "requestedAt" IS NOT NULL RETURNING *
)
INSERT INTO "CampaignEvent" (id,"tenantId","campaignId",version,kind,"createdAt")
 SELECT gen_random_uuid()::text,"tenantId",id,version,'requester_migrated',now() FROM changed;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_requester_shape" CHECK (("requestedAt" IS NULL)=("requesterId" IS NULL));
CREATE FUNCTION check_campaign_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."requestedAt" IS NOT NULL AND
  (NEW."requesterId",NEW."requestedAt") IS DISTINCT FROM (OLD."requesterId",OLD."requestedAt")
 THEN RAISE EXCEPTION 'immutable campaign requester' USING ERRCODE='23514'; END IF;
 IF NEW."archivedAt" IS NOT NULL AND NEW.status NOT IN ('completed','partial_failed','failed','cancelled','expired')
 THEN RAISE EXCEPTION 'only terminal campaigns can be archived' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Campaign_lifecycle_guard" BEFORE INSERT OR UPDATE ON "Campaign" FOR EACH ROW EXECUTE FUNCTION check_campaign_lifecycle();
CREATE FUNCTION check_campaign_delivery_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.status='draft' AND NEW.status NOT IN ('draft','queued','excluded','cancelled'))
 OR (OLD.status='queued' AND NEW.status NOT IN ('queued','sending','cancelled','failed'))
 OR (OLD.status='sending' AND NEW.status NOT IN ('sending','queued','local_delivered','accepted','unknown','failed','cancelled'))
 OR (OLD.status='failed' AND NEW.status NOT IN ('failed','queued','cancelled'))
 OR (OLD.status='excluded' AND NEW.status NOT IN ('excluded','cancelled'))
 OR (OLD.status IN ('accepted','local_delivered','unknown','cancelled') AND NEW.status<>OLD.status)
 THEN RAISE EXCEPTION 'invalid campaign delivery transition' USING ERRCODE='23514'; END IF;
 IF NEW.attempt <> OLD.attempt + (CASE WHEN NEW.status='queued' AND OLD.status IN ('draft','failed') THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'invalid campaign delivery attempt' USING ERRCODE='23514'; END IF;
 IF OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt"
 THEN RAISE EXCEPTION 'immutable delivery receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignDelivery_lifecycle_guard" BEFORE UPDATE ON "CampaignDelivery" FOR EACH ROW EXECUTE FUNCTION check_campaign_delivery_lifecycle();
CREATE FUNCTION check_campaign_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."campaignDeliveryId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM "CampaignDelivery" d WHERE d.id=NEW."campaignDeliveryId"
  AND d.attempt>0 AND NEW."dedupeKey"='campaign:'||d.id||':'||d.attempt::text)
 THEN RAISE EXCEPTION 'unique campaign attempt required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."dedupeKey" IS DISTINCT FROM OLD."dedupeKey" OR
  (NEW."payloadCipher" IS DISTINCT FROM OLD."payloadCipher" AND NEW."payloadErasedAt" IS NULL))
 THEN RAISE EXCEPTION 'immutable campaign job payload' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignJob_identity_guard" BEFORE INSERT OR UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION check_campaign_job_identity();
COMMIT;
