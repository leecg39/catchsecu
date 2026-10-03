BEGIN;
CREATE TABLE "EmailFeedback" (
 id TEXT PRIMARY KEY, "eventKey" TEXT NOT NULL UNIQUE, "tenantId" TEXT NOT NULL, "serviceId" TEXT NOT NULL,
 "jobId" TEXT NOT NULL REFERENCES "Job"(id) ON DELETE RESTRICT, "deliveryId" TEXT NOT NULL,
 "contactHash" TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL,
 "bodyHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmailFeedback_service_fkey" FOREIGN KEY ("tenantId","serviceId") REFERENCES "Service"("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT "EmailFeedback_delivery_fkey" FOREIGN KEY ("tenantId","deliveryId") REFERENCES "CampaignDelivery"("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT "EmailFeedback_scope_key" UNIQUE ("tenantId","serviceId","contactHash",id),
 CONSTRAINT "EmailFeedback_shape" CHECK ("contactHash" ~ '^[a-f0-9]{64}$' AND "bodyHash" ~ '^[a-f0-9]{64}$'
  AND ((source='recipient' AND kind='unsubscribed' AND "eventKey"='recipient:'||"jobId")
   OR (source='relay' AND kind IN ('delivered','soft_bounce','hard_bounce','complaint') AND "eventKey" ~ '^relay:[A-Za-z0-9_-]{1,120}$')))
);
CREATE INDEX "EmailFeedback_contact_kind_time" ON "EmailFeedback"("tenantId","serviceId","contactHash",kind,"occurredAt");
CREATE INDEX "EmailFeedback_job_kind" ON "EmailFeedback"("jobId",kind);
CREATE INDEX "EmailFeedback_delivery_time" ON "EmailFeedback"("deliveryId","createdAt",id);
CREATE TABLE "EmailSuppression" (
 id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "serviceId" TEXT NOT NULL, "contactHash" TEXT NOT NULL,
 reason TEXT NOT NULL, "sourceEventId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmailSuppression_scope_event_fkey" FOREIGN KEY ("tenantId","serviceId","contactHash","sourceEventId") REFERENCES "EmailFeedback"("tenantId","serviceId","contactHash",id) ON DELETE RESTRICT,
 CONSTRAINT "EmailSuppression_identity_key" UNIQUE ("tenantId","serviceId","contactHash",reason),
 CONSTRAINT "EmailSuppression_shape" CHECK ("contactHash" ~ '^[a-f0-9]{64}$' AND reason IN ('unsubscribed','hard_bounce','complaint','soft_bounce'))
);
CREATE INDEX "EmailSuppression_service_time" ON "EmailSuppression"("tenantId","serviceId","createdAt",id);
CREATE FUNCTION guard_email_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'email feedback is immutable' USING ERRCODE='23514'; END IF;
 PERFORM marketing_delivery_lock(NEW."tenantId",NEW."serviceId",'email',NEW."contactHash");
 IF NOT EXISTS(SELECT 1 FROM "Job" j JOIN "CampaignDelivery" d ON d.id=j."campaignDeliveryId" JOIN "Campaign" c ON c.id=d."campaignId"
   WHERE j.id=NEW."jobId" AND d.id=NEW."deliveryId" AND j."tenantId"=NEW."tenantId" AND d."tenantId"=NEW."tenantId"
    AND d."serviceId"=NEW."serviceId" AND d."contactHash"=NEW."contactHash" AND c.channel='email'
    AND j."dedupeKey"='campaign:'||d.id||':'||d.attempt::text
    AND ((j.status='done' AND d.status IN ('accepted','local_delivered')) OR (j.status='dead' AND d.status='unknown'))
    AND NEW."occurredAt">=j."createdAt"-interval '5 minutes'
    AND j."createdAt">=(clock_timestamp() AT TIME ZONE 'UTC')-interval '90 days')
  OR NEW."occurredAt">(clock_timestamp() AT TIME ZONE 'UTC')+interval '5 minutes'
 THEN RAISE EXCEPTION 'invalid email feedback job scope or time' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM "EmailFeedback" WHERE "jobId"=NEW."jobId" AND source=NEW.source)>=100
 THEN RAISE EXCEPTION 'email feedback limit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "EmailFeedback_guard" BEFORE INSERT OR UPDATE OR DELETE ON "EmailFeedback" FOR EACH ROW EXECUTE FUNCTION guard_email_feedback();
CREATE FUNCTION guard_email_suppression() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE feedback "EmailFeedback"; bounces integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'email suppression is immutable' USING ERRCODE='23514'; END IF;
 PERFORM marketing_delivery_lock(NEW."tenantId",NEW."serviceId",'email',NEW."contactHash");
 SELECT * INTO feedback FROM "EmailFeedback" WHERE id=NEW."sourceEventId";
 IF feedback.id IS NULL OR feedback.kind<>NEW.reason THEN RAISE EXCEPTION 'email suppression reason mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.reason='soft_bounce' THEN
  SELECT count(DISTINCT f."jobId") INTO bounces FROM "EmailFeedback" f WHERE f."tenantId"=NEW."tenantId" AND f."serviceId"=NEW."serviceId"
   AND f."contactHash"=NEW."contactHash" AND f.kind='soft_bounce' AND f."occurredAt">=(clock_timestamp() AT TIME ZONE 'UTC')-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM "EmailFeedback" d WHERE d."jobId"=f."jobId" AND d.kind='delivered');
  IF bounces<3 THEN RAISE EXCEPTION 'soft bounce threshold not reached' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "EmailSuppression_guard" BEFORE INSERT OR UPDATE OR DELETE ON "EmailSuppression" FOR EACH ROW EXECUTE FUNCTION guard_email_suppression();

ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_content_protocol";
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_content_protocol" CHECK ("mailProtocol" IN ('mail.campaign.v1','mail.campaign.v2','mail.campaign.v3'));
ALTER TABLE "Campaign" ALTER COLUMN "mailProtocol" SET DEFAULT 'mail.campaign.v3';
ALTER TABLE "Job" DROP CONSTRAINT "marketing_job_binding";
ALTER TABLE "Job" ADD CONSTRAINT "marketing_job_binding" CHECK (
 ("marketingPreferenceId" IS NULL AND "marketingSubmissionId" IS NULL) OR
 ("tenantId" IS NOT NULL AND "marketingPreferenceId" IS NOT NULL AND "marketingSubmissionId" IS NOT NULL AND type IN ('mail','mail.sender.v1','mail.campaign.v1','mail.campaign.v2','mail.campaign.v3')));
DO $$
DECLARE definition text; fn text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['check_sender_job()','check_campaign_job()'] LOOP
  SELECT pg_get_functiondef(fn::regprocedure) INTO definition;
  IF position('''mail.campaign.v2''' IN definition)=0 THEN RAISE EXCEPTION 'email protocol migration contract missing'; END IF;
  EXECUTE replace(definition,'''mail.campaign.v2''','''mail.campaign.v2'',''mail.campaign.v3''');
 END LOOP;
 SELECT pg_get_functiondef('check_campaign_message_content()'::regprocedure) INTO definition;
 definition:=replace(definition,'OLD."mailProtocol"=''mail.campaign.v2'' AND NEW."mailProtocol"<>OLD."mailProtocol"',
  'substring(NEW."mailProtocol" from ''v([0-9]+)$'')::int < substring(OLD."mailProtocol" from ''v([0-9]+)$'')::int');
 EXECUTE definition;
 SELECT pg_get_functiondef('check_campaign_attachments()'::regprocedure) INTO definition;
 EXECUTE replace(definition,'NEW."mailProtocol"<>''mail.campaign.v2''','NEW."mailProtocol" NOT IN (''mail.campaign.v2'',''mail.campaign.v3'')');
END $$;
COMMIT;
