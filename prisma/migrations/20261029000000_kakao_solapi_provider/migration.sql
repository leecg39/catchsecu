-- Kakao Solapi provider linkage: resolved pfId on channels, provider templateId on
-- templates, and a delivery-receipt table mirroring "SmsReceipt" for provider sends.
ALTER TABLE "KakaoChannel" ADD COLUMN "providerKey" TEXT;
ALTER TABLE "KakaoTemplate" ADD COLUMN "providerTemplateId" TEXT;

CREATE TABLE "KakaoReceipt" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attempt"    INTEGER NOT NULL DEFAULT 1,
  "receiptId"  TEXT NOT NULL,
  "status"     TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "KakaoReceipt_receiptId_key" ON "KakaoReceipt"("receiptId");
CREATE UNIQUE INDEX "KakaoReceipt_deliveryId_attempt_key" ON "KakaoReceipt"("deliveryId", "attempt");
CREATE INDEX "KakaoReceipt_tenantId_createdAt_idx" ON "KakaoReceipt"("tenantId", "createdAt");
ALTER TABLE "KakaoReceipt" ADD CONSTRAINT "KakaoReceipt_delivery_fkey"
  FOREIGN KEY ("tenantId", "deliveryId") REFERENCES "CampaignDelivery"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KakaoReceipt" ADD CONSTRAINT "KakaoReceipt_status" CHECK ("status" IN ('provider_accepted', 'failed', 'unknown'));
ALTER TABLE "KakaoReceipt" ADD CONSTRAINT "KakaoReceipt_attempt" CHECK ("attempt" BETWEEN 1 AND 5);
