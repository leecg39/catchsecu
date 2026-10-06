-- Preserve existing receipt bytes and assign the latest job scheduled before the receipt to its attempt.
ALTER TABLE "SmsReceipt" ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
UPDATE "SmsReceipt" r SET attempt=COALESCE((
  SELECT MAX(split_part(j."dedupeKey", ':', 3)::INTEGER) FROM "Job" j
  WHERE j."campaignDeliveryId"=r."deliveryId" AND j."createdAt"<=r."createdAt"
    AND j."dedupeKey" ~ ('^campaign:' || r."deliveryId" || ':[1-5]$')
), 1);
DROP INDEX "SmsReceipt_deliveryId_key";
CREATE UNIQUE INDEX "SmsReceipt_deliveryId_attempt_key" ON "SmsReceipt"("deliveryId",attempt);
ALTER TABLE "SmsReceipt" DROP CONSTRAINT "SmsReceipt_delivery_fkey";
ALTER TABLE "SmsReceipt" ADD CONSTRAINT "SmsReceipt_tenantId_deliveryId_fkey" FOREIGN KEY ("tenantId","deliveryId") REFERENCES "CampaignDelivery"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmsReceipt" ADD CONSTRAINT "SmsReceipt_attempt" CHECK(attempt BETWEEN 1 AND 5);
CREATE FUNCTION prevent_sms_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SMS receipts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "SmsReceipt_immutable" BEFORE UPDATE OR DELETE ON "SmsReceipt" FOR EACH ROW EXECUTE FUNCTION prevent_sms_receipt_mutation();
