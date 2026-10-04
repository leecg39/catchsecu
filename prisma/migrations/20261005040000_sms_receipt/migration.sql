-- 문자 공급자 결과. 로컬 기록과 서명된 영수증만 저장하고 sent 상태는 쓰지 않는다.
CREATE TABLE "SmsReceipt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SmsReceipt_deliveryId_key" ON "SmsReceipt"("deliveryId");
CREATE UNIQUE INDEX "SmsReceipt_receiptId_key" ON "SmsReceipt"("receiptId");
CREATE INDEX "SmsReceipt_tenantId_createdAt_idx" ON "SmsReceipt"("tenantId", "createdAt");
ALTER TABLE "SmsReceipt" ADD CONSTRAINT "SmsReceipt_delivery_fkey" FOREIGN KEY ("deliveryId") REFERENCES "CampaignDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmsReceipt" ADD CONSTRAINT "SmsReceipt_status" CHECK ("status" IN ('provider_accepted', 'failed', 'unknown'));
