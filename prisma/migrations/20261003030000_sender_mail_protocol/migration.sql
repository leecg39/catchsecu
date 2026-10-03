BEGIN;
-- Stop workers before this migration and restart every worker with the new dispatcher.
-- Older dispatchers only accept 'mail', so they cannot send these policy-bound messages.
ALTER TABLE "Job" DROP CONSTRAINT "marketing_job_binding";
ALTER TABLE "Job" ADD CONSTRAINT "marketing_job_binding" CHECK (
  ("marketingPreferenceId" IS NULL AND "marketingSubmissionId" IS NULL) OR
  ("tenantId" IS NOT NULL AND "marketingPreferenceId" IS NOT NULL AND "marketingSubmissionId" IS NOT NULL AND type IN ('mail','mail.sender.v1')));

UPDATE "Job" SET type='mail.sender.v1'
WHERE type='mail' AND status IN ('queued','leased','retry')
  AND ("senderId" IS NOT NULL OR "dedupeKey" LIKE 'mail:sender-verification:%');

CREATE OR REPLACE FUNCTION check_sender_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."senderId" IS DISTINCT FROM OLD."senderId" THEN RAISE EXCEPTION 'immutable sender job' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.type='mail.sender.v1' AND NEW.type<>OLD.type THEN RAISE EXCEPTION 'immutable sender protocol' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW."senderId" IS NOT NULL OR NEW."dedupeKey" LIKE 'mail:sender-verification:%') AND NEW.type<>'mail.sender.v1'
 THEN RAISE EXCEPTION 'sender mail protocol required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."senderId" IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM "Sender" WHERE id=NEW."senderId" AND "tenantId"=NEW."tenantId" AND channel='email'
     AND (NEW."marketingPreferenceId" IS NULL OR "serviceId"=(SELECT "serviceId" FROM "MarketingPreference" WHERE id=NEW."marketingPreferenceId"))
     AND status='verified' AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'))
 THEN RAISE EXCEPTION 'unverified sender job' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
COMMIT;
