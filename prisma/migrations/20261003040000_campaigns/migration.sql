BEGIN;


-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "campaignDeliveryId" TEXT;


-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentCipher" TEXT,
    "senderId" TEXT,
    "senderVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "CampaignDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "contactHash" TEXT NOT NULL,
    "contactCipher" TEXT,
    "preferenceId" TEXT,
    "sourceSubmissionId" TEXT,
    "preferenceVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignDelivery_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "Campaign_tenantId_serviceId_channel_status_createdAt_id_idx" ON "Campaign"("tenantId", "serviceId", "channel", "status", "createdAt", "id");


-- CreateIndex
CREATE INDEX "Campaign_expiresAt_status_idx" ON "Campaign"("expiresAt", "status");


-- CreateIndex
CREATE UNIQUE INDEX "Campaign_tenantId_id_key" ON "Campaign"("tenantId", "id");


-- CreateIndex
CREATE UNIQUE INDEX "Campaign_tenantId_serviceId_id_key" ON "Campaign"("tenantId", "serviceId", "id");


-- CreateIndex
CREATE INDEX "CampaignDelivery_campaignId_status_position_id_idx" ON "CampaignDelivery"("campaignId", "status", "position", "id");


-- CreateIndex
CREATE INDEX "CampaignDelivery_sourceSubmissionId_idx" ON "CampaignDelivery"("sourceSubmissionId");


-- CreateIndex
CREATE INDEX "CampaignDelivery_preferenceId_idx" ON "CampaignDelivery"("preferenceId");


-- CreateIndex
CREATE UNIQUE INDEX "CampaignDelivery_tenantId_id_key" ON "CampaignDelivery"("tenantId", "id");


-- CreateIndex
CREATE UNIQUE INDEX "CampaignDelivery_campaignId_contactHash_key" ON "CampaignDelivery"("campaignId", "contactHash");


-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_campaignId_version_key" ON "CampaignEvent"("campaignId", "version");


-- CreateIndex
CREATE UNIQUE INDEX "MarketingPreference_tenantId_serviceId_id_key" ON "MarketingPreference"("tenantId", "serviceId", "id");


-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_campaignDeliveryId_fkey" FOREIGN KEY ("tenantId", "campaignDeliveryId") REFERENCES "CampaignDelivery"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_creatorId_fkey" FOREIGN KEY ("tenantId", "creatorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_serviceId_senderId_fkey" FOREIGN KEY ("tenantId", "serviceId", "senderId") REFERENCES "Sender"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_tenantId_serviceId_campaignId_fkey" FOREIGN KEY ("tenantId", "serviceId", "campaignId") REFERENCES "Campaign"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_tenantId_serviceId_preferenceId_fkey" FOREIGN KEY ("tenantId", "serviceId", "preferenceId") REFERENCES "MarketingPreference"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_tenantId_sourceSubmissionId_fkey" FOREIGN KEY ("tenantId", "sourceSubmissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "Campaign"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Job_campaign_delivery" ON "Job"("campaignDeliveryId");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_shape" CHECK (
 channel IN ('email','sms') AND source IN ('direct','form') AND version>0
 AND status IN ('draft','scheduled','dispatching','completed','partial_failed','failed','cancelled','deleted','expired')
 AND "expiresAt">"createdAt" AND (status NOT IN ('deleted','expired') OR "contentCipher" IS NULL)
 AND (status IN ('draft','deleted','expired') OR ("senderId" IS NOT NULL AND "senderVersion">0 AND "requestedAt" IS NOT NULL AND "scheduledAt" IS NOT NULL)));
ALTER TABLE "CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_shape" CHECK (
 position>0 AND attempt>=0 AND "contactHash" ~ '^[a-f0-9]{64}$'
 AND status IN ('draft','queued','sending','local_delivered','accepted','unknown','excluded','failed','cancelled')
 AND ("erasedAt" IS NULL OR ("contactCipher" IS NULL AND status NOT IN ('queued','sending')))
 AND (("preferenceId" IS NULL AND "sourceSubmissionId" IS NULL AND "preferenceVersion" IS NULL)
   OR ("preferenceId" IS NOT NULL AND "sourceSubmissionId" IS NOT NULL AND "preferenceVersion">0))
 AND (status NOT IN ('queued','sending','accepted','local_delivered') OR "preferenceId" IS NOT NULL)
 AND (status NOT IN ('accepted','local_delivered') OR "acceptedAt" IS NOT NULL));

CREATE FUNCTION check_campaign() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'campaign tombstones are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.version<>1 OR NEW."senderVersion" IS NOT NULL OR NEW."requestedAt" IS NOT NULL THEN RAISE EXCEPTION 'new campaign must be draft' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."serviceId",NEW."creatorId",NEW.channel,NEW.source,NEW."createdAt",NEW."expiresAt")
    IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."serviceId",OLD."creatorId",OLD.channel,OLD.source,OLD."createdAt",OLD."expiresAt")
    OR NEW.version<>OLD.version+1 OR OLD.status IN ('deleted','expired')
  THEN RAISE EXCEPTION 'immutable campaign binding or version' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'draft' AND ((NEW.title,NEW."senderId",NEW."senderVersion") IS DISTINCT FROM (OLD.title,OLD."senderId",OLD."senderVersion")
    OR (NEW."contentCipher" IS DISTINCT FROM OLD."contentCipher" AND NEW."contentCipher" IS NOT NULL))
  THEN RAISE EXCEPTION 'requested campaign content is immutable' USING ERRCODE='23514'; END IF;
  IF (OLD.status='draft' AND NEW.status NOT IN ('draft','scheduled','deleted','expired'))
    OR (OLD.status='scheduled' AND NEW.status NOT IN ('scheduled','dispatching','completed','partial_failed','failed','cancelled','expired'))
    OR (OLD.status='dispatching' AND NEW.status NOT IN ('dispatching','completed','partial_failed','failed','cancelled','expired'))
    OR (OLD.status IN ('completed','partial_failed','failed','cancelled') AND NEW.status NOT IN (OLD.status,'scheduled','expired'))
  THEN RAISE EXCEPTION 'invalid campaign transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."senderId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND channel=NEW.channel AND "tenantId"=NEW."tenantId" AND "serviceId"=NEW."serviceId")
 THEN RAISE EXCEPTION 'invalid campaign sender channel' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Campaign_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Campaign" FOR EACH ROW EXECUTE FUNCTION check_campaign();
CREATE FUNCTION check_campaign_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM "Campaign" WHERE id=NEW."campaignId" AND "tenantId"=NEW."tenantId" AND version=NEW.version)
 THEN RAISE EXCEPTION 'immutable campaign event' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CampaignEvent" FOR EACH ROW EXECUTE FUNCTION check_campaign_event();
CREATE FUNCTION require_campaign_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "CampaignEvent" WHERE "campaignId"=NEW.id AND version=NEW.version)
 THEN RAISE EXCEPTION 'campaign event required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Campaign_event_required" AFTER INSERT OR UPDATE ON "Campaign" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_campaign_event();

CREATE FUNCTION check_campaign_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "Campaign";
BEGIN
 SELECT * INTO c FROM "Campaign" WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD."campaignId" ELSE NEW."campaignId" END;
 IF TG_OP='DELETE' THEN
  IF c.status<>'draft' OR EXISTS(SELECT 1 FROM "Job" WHERE "campaignDeliveryId"=OLD.id) THEN RAISE EXCEPTION 'requested recipient cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM id FROM "Campaign" WHERE id=NEW."campaignId" FOR UPDATE;
  IF c.status<>'draft' OR NEW.status<>'draft' OR NEW.attempt<>0 OR (SELECT count(*) FROM "CampaignDelivery" WHERE "campaignId"=NEW."campaignId")>=1000
  THEN RAISE EXCEPTION 'invalid draft recipient' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."serviceId",NEW."campaignId",NEW.position,NEW."contactHash",NEW."createdAt")
    IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."serviceId",OLD."campaignId",OLD.position,OLD."contactHash",OLD."createdAt")
  THEN RAISE EXCEPTION 'immutable recipient identity' USING ERRCODE='23514'; END IF;
  IF OLD."erasedAt" IS NOT NULL AND (NEW."contactCipher" IS NOT NULL OR NEW."erasedAt" IS DISTINCT FROM OLD."erasedAt") THEN RAISE EXCEPTION 'recipient cannot be restored' USING ERRCODE='23514'; END IF;
  IF c.status<>'draft' AND ((NEW."preferenceId",NEW."sourceSubmissionId",NEW."preferenceVersion") IS DISTINCT FROM (OLD."preferenceId",OLD."sourceSubmissionId",OLD."preferenceVersion")
    OR (NEW."contactCipher" IS DISTINCT FROM OLD."contactCipher" AND NEW."contactCipher" IS NOT NULL))
  THEN RAISE EXCEPTION 'immutable requested recipient' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."preferenceId" IS NOT NULL AND (TG_OP='INSERT' OR (NEW."preferenceId",NEW."sourceSubmissionId",NEW."preferenceVersion") IS DISTINCT FROM (OLD."preferenceId",OLD."sourceSubmissionId",OLD."preferenceVersion"))
    AND NOT EXISTS(SELECT 1 FROM "MarketingPreference" WHERE id=NEW."preferenceId" AND "sourceSubmissionId"=NEW."sourceSubmissionId" AND "contactHash"=NEW."contactHash" AND channel=c.channel AND version=NEW."preferenceVersion")
 THEN RAISE EXCEPTION 'invalid recipient consent binding' USING ERRCODE='23514'; END IF;
 IF NEW."contactCipher" IS NOT NULL AND NEW."sourceSubmissionId" IS NOT NULL
   AND (TG_OP='INSERT' OR NEW."contactCipher" IS DISTINCT FROM OLD."contactCipher")
   AND (NOT EXISTS(SELECT 1 FROM "Submission" WHERE id=NEW."sourceSubmissionId" AND status IN ('submitted','corrected','withdrawn') AND "retentionUntil">(clock_timestamp() AT TIME ZONE 'UTC'))
     OR EXISTS(SELECT 1 FROM "MarketingPreference" WHERE id=NEW."preferenceId" AND status='erased'))
 THEN RAISE EXCEPTION 'erased source cannot create recipient copies' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignDelivery_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CampaignDelivery" FOR EACH ROW EXECUTE FUNCTION check_campaign_delivery();

ALTER TABLE "Job" DROP CONSTRAINT "marketing_job_binding";
ALTER TABLE "Job" ADD CONSTRAINT "marketing_job_binding" CHECK (
 ("marketingPreferenceId" IS NULL AND "marketingSubmissionId" IS NULL) OR
 ("tenantId" IS NOT NULL AND "marketingPreferenceId" IS NOT NULL AND "marketingSubmissionId" IS NOT NULL AND type IN ('mail','mail.sender.v1','mail.campaign.v1')));
CREATE OR REPLACE FUNCTION check_sender_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."senderId" IS DISTINCT FROM OLD."senderId" THEN RAISE EXCEPTION 'immutable sender job' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.type IN ('mail.sender.v1','mail.campaign.v1') AND NEW.type<>OLD.type THEN RAISE EXCEPTION 'immutable sender protocol' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW."senderId" IS NOT NULL OR NEW."dedupeKey" LIKE 'mail:sender-verification:%') AND NEW.type NOT IN ('mail.sender.v1','mail.campaign.v1')
 THEN RAISE EXCEPTION 'sender mail protocol required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."senderId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND channel='email'
   AND ("serviceId"=(SELECT "serviceId" FROM "MarketingPreference" WHERE id=NEW."marketingPreferenceId")) AND status='verified' AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'))
 THEN RAISE EXCEPTION 'unverified sender job' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION check_campaign_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."campaignDeliveryId" IS DISTINCT FROM OLD."campaignDeliveryId" THEN RAISE EXCEPTION 'immutable campaign job' USING ERRCODE='23514'; END IF;
 IF (NEW.type='mail.campaign.v1') IS DISTINCT FROM (NEW."campaignDeliveryId" IS NOT NULL) THEN RAISE EXCEPTION 'campaign job protocol binding required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."campaignDeliveryId" IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM "CampaignDelivery" d JOIN "Campaign" c ON c.id=d."campaignId" WHERE d.id=NEW."campaignDeliveryId"
   AND c."tenantId"=NEW."tenantId" AND c."senderId"=NEW."senderId" AND d."preferenceId"=NEW."marketingPreferenceId"
   AND d."sourceSubmissionId"=NEW."marketingSubmissionId" AND c.status IN ('scheduled','dispatching') AND d.status='queued')
 THEN RAISE EXCEPTION 'invalid campaign outbox binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignJob_guard" BEFORE INSERT OR UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION check_campaign_job();
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('validate_destruction_certificate()'::regprocedure) INTO definition;
 IF position('''marketingJobs''' IN definition)=0 THEN RAISE EXCEPTION 'destruction certificate contract not found'; END IF;
 EXECUTE replace(definition,'''marketingJobs''','''marketingJobs'',''campaignRecipients''');
END $$;
CREATE FUNCTION require_campaign_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "CampaignDelivery" WHERE "sourceSubmissionId"=NEW."submissionId" AND ("contactCipher" IS NOT NULL OR "erasedAt" IS NULL))
 THEN RAISE EXCEPTION 'certificate requires campaign recipient erasure' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Certificate_campaign_erasure" BEFORE INSERT ON "DestructionCertificate" FOR EACH ROW EXECUTE FUNCTION require_campaign_erasure();
COMMIT;
