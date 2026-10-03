BEGIN;
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "messageTemplateId" TEXT,
ADD COLUMN     "messageTemplateVersion" INTEGER;

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentCipher" TEXT,
    "contentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplateRevision" (
    "templateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "contentCipher" TEXT,
    "contentHash" TEXT,
    "kind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplateRevision_pkey" PRIMARY KEY ("templateId","version")
);

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_serviceId_channel_status_createdAt_idx" ON "MessageTemplate"("tenantId", "serviceId", "channel", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_serviceId_id_key" ON "MessageTemplate"("tenantId", "serviceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplateRevision_tenantId_serviceId_templateId_versi_key" ON "MessageTemplateRevision"("tenantId", "serviceId", "templateId", "version");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_serviceId_messageTemplateId_messageTempl_fkey" FOREIGN KEY ("tenantId", "serviceId", "messageTemplateId", "messageTemplateVersion") REFERENCES "MessageTemplateRevision"("tenantId", "serviceId", "templateId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_tenantId_creatorId_fkey" FOREIGN KEY ("tenantId", "creatorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplateRevision" ADD CONSTRAINT "MessageTemplateRevision_tenantId_serviceId_templateId_fkey" FOREIGN KEY ("tenantId", "serviceId", "templateId") REFERENCES "MessageTemplate"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD COLUMN "mailProtocol" TEXT NOT NULL DEFAULT 'mail.campaign.v1';
ALTER TABLE "Campaign" ALTER COLUMN "mailProtocol" SET DEFAULT 'mail.campaign.v2';
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_content_protocol" CHECK ("mailProtocol" IN ('mail.campaign.v1','mail.campaign.v2'));
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_template_shape" CHECK (("messageTemplateId" IS NULL AND "messageTemplateVersion" IS NULL) OR ("messageTemplateId" IS NOT NULL AND "messageTemplateVersion">0));
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_shape" CHECK (
 channel IN ('email','sms') AND status IN ('active','archived','deleted') AND version>0
 AND ((status='deleted' AND name='' AND "contentCipher" IS NULL AND "contentHash" IS NULL)
 OR (status<>'deleted' AND length(name) BETWEEN 1 AND 200 AND "contentCipher" IS NOT NULL AND "contentHash" ~ '^[a-f0-9]{64}$')));
ALTER TABLE "MessageTemplateRevision" ADD CONSTRAINT "MessageTemplateRevision_shape" CHECK (version>0 AND kind IN ('created','updated','archived','restored','deleted'));
ALTER TABLE "MessageTemplateRevision" ADD CONSTRAINT "MessageTemplateRevision_actor" FOREIGN KEY ("tenantId","actorId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT;
CREATE FUNCTION check_message_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'template tombstone required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'active' OR NEW.version<>1 THEN RAISE EXCEPTION 'new active template required' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."serviceId",NEW."creatorId",NEW.channel,NEW."createdAt") IS DISTINCT FROM
    (OLD.id,OLD."tenantId",OLD."serviceId",OLD."creatorId",OLD.channel,OLD."createdAt") OR NEW.version<>OLD.version+1 OR OLD.status='deleted'
  THEN RAISE EXCEPTION 'immutable template scope or version' USING ERRCODE='23514'; END IF;
  IF OLD.status='archived' AND NEW.status='archived' THEN RAISE EXCEPTION 'archived template is read only' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "MessageTemplate_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MessageTemplate" FOR EACH ROW EXECUTE FUNCTION check_message_template();
CREATE FUNCTION check_message_template_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM "MessageTemplate" t WHERE t.id=NEW."templateId" AND t.version=NEW.version AND (t.name,t."contentCipher",t."contentHash") IS NOT DISTINCT FROM (NEW.name,NEW."contentCipher",NEW."contentHash"))
  THEN RAISE EXCEPTION 'current template snapshot required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.name='' AND NEW."contentCipher" IS NULL AND (to_jsonb(NEW)-'name'-'contentCipher')=(to_jsonb(OLD)-'name'-'contentCipher')
  AND EXISTS(SELECT 1 FROM "MessageTemplate" WHERE id=OLD."templateId" AND status='deleted') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'immutable template revision' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "MessageTemplateRevision_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MessageTemplateRevision" FOR EACH ROW EXECUTE FUNCTION check_message_template_revision();
CREATE FUNCTION require_message_template_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "MessageTemplateRevision" WHERE "templateId"=NEW.id AND version=NEW.version) THEN RAISE EXCEPTION 'template revision required' USING ERRCODE='23514'; END IF;
 IF NEW.status='deleted' AND EXISTS(SELECT 1 FROM "MessageTemplateRevision" WHERE "templateId"=NEW.id AND (name<>'' OR "contentCipher" IS NOT NULL)) THEN RAISE EXCEPTION 'template revision erasure required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "MessageTemplate_revision_required" AFTER INSERT OR UPDATE ON "MessageTemplate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_message_template_revision();
CREATE FUNCTION check_campaign_message_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status<>'draft' AND (NEW."mailProtocol",NEW."messageTemplateId",NEW."messageTemplateVersion") IS DISTINCT FROM (OLD."mailProtocol",OLD."messageTemplateId",OLD."messageTemplateVersion")
 THEN RAISE EXCEPTION 'requested message binding is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD."mailProtocol"='mail.campaign.v2' AND NEW."mailProtocol"<>OLD."mailProtocol" THEN RAISE EXCEPTION 'cannot downgrade message protocol' USING ERRCODE='23514'; END IF;
 IF NEW."messageTemplateId" IS NOT NULL AND (TG_OP='INSERT' OR (NEW."messageTemplateId",NEW."messageTemplateVersion") IS DISTINCT FROM (OLD."messageTemplateId",OLD."messageTemplateVersion"))
  AND NOT EXISTS(SELECT 1 FROM "MessageTemplate" WHERE id=NEW."messageTemplateId" AND channel=NEW.channel AND status='active' AND version=NEW."messageTemplateVersion")
 THEN RAISE EXCEPTION 'active same-channel template required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Campaign_message_content_guard" BEFORE INSERT OR UPDATE ON "Campaign" FOR EACH ROW EXECUTE FUNCTION check_campaign_message_content();
ALTER TABLE "Job" DROP CONSTRAINT "marketing_job_binding";
ALTER TABLE "Job" ADD CONSTRAINT "marketing_job_binding" CHECK (
 ("marketingPreferenceId" IS NULL AND "marketingSubmissionId" IS NULL) OR
 ("tenantId" IS NOT NULL AND "marketingPreferenceId" IS NOT NULL AND "marketingSubmissionId" IS NOT NULL AND type IN ('mail','mail.sender.v1','mail.campaign.v1','mail.campaign.v2')));
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('check_sender_job()'::regprocedure) INTO definition;
 IF position('mail.campaign.v1' IN definition)=0 THEN RAISE EXCEPTION 'sender protocol migration contract missing'; END IF;
 EXECUTE replace(definition,'''mail.campaign.v1''','''mail.campaign.v1'',''mail.campaign.v2''');
 SELECT pg_get_functiondef('check_campaign_job()'::regprocedure) INTO definition;
 IF position('NEW.type=''mail.campaign.v1''' IN definition)=0 THEN RAISE EXCEPTION 'campaign protocol migration contract missing'; END IF;
 definition:=replace(definition,'NEW.type=''mail.campaign.v1''','NEW.type IN (''mail.campaign.v1'',''mail.campaign.v2'')');
 definition:=replace(definition,'AND c.status IN','AND c."mailProtocol"=NEW.type AND c.status IN');
 EXECUTE definition;
END $$;
COMMIT;
