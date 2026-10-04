CREATE OR REPLACE FUNCTION check_sender_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."senderId" IS DISTINCT FROM OLD."senderId" THEN RAISE EXCEPTION 'immutable sender job' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.type IN ('mail.sender.v1','mail.campaign.v1','mail.campaign.v2','mail.campaign.v3') AND NEW.type<>OLD.type THEN RAISE EXCEPTION 'immutable sender protocol' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW."senderId" IS NOT NULL OR NEW."dedupeKey" LIKE 'mail:sender-verification:%') AND NEW.type NOT IN ('mail.sender.v1','mail.campaign.v1','mail.campaign.v2','mail.campaign.v3')
 THEN RAISE EXCEPTION 'sender mail protocol required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."senderId" IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM "Sender" s WHERE s.id=NEW."senderId" AND s."tenantId"=NEW."tenantId"
    AND s."serviceId"=(SELECT "serviceId" FROM "MarketingPreference" WHERE id=NEW."marketingPreferenceId")
    AND s.status='verified' AND s."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
    AND (s.channel='email' OR (s.channel='sms' AND EXISTS(
      SELECT 1 FROM "CampaignDelivery" d JOIN "Campaign" c ON c.id=d."campaignId"
      WHERE d.id=NEW."campaignDeliveryId" AND c.channel='sms'))))
 THEN RAISE EXCEPTION 'unverified sender job' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
