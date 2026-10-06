-- 단건 Mock 발송 영수증은 실제 발송 증명이 아니다. 본문 대신 조회용 HMAC만 저장한다.
CREATE TABLE "KakaoMockReceipt" (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "channelVersion" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'local_delivered',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KakaoMockReceipt_shape" CHECK (status='local_delivered' AND "templateVersion">0 AND "channelVersion">0 AND "contentHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "KakaoMockReceipt_tenantId_templateId_fkey" FOREIGN KEY ("tenantId", "templateId") REFERENCES "KakaoTemplate"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KakaoMockReceipt_requestId_key" ON "KakaoMockReceipt"("requestId");
CREATE INDEX "KakaoMockReceipt_tenantId_templateId_createdAt_idx" ON "KakaoMockReceipt"("tenantId", "templateId", "createdAt");
CREATE FUNCTION check_kakao_mock_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'mock receipts are immutable' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "KakaoChannel" WHERE id=NEW."channelId" AND "tenantId"=NEW."tenantId" FOR SHARE;
  PERFORM id FROM "KakaoTemplate" WHERE id=NEW."templateId" AND "tenantId"=NEW."tenantId" FOR SHARE;
  IF NOT EXISTS (
    SELECT 1 FROM "KakaoTemplate" t JOIN "KakaoChannel" c ON c.id=t."channelId" AND c."tenantId"=t."tenantId"
    WHERE t.id=NEW."templateId" AND t."tenantId"=NEW."tenantId" AND t."serviceId"=NEW."serviceId"
      AND t."channelId"=NEW."channelId" AND c."serviceId"=NEW."serviceId"
      AND t.version=NEW."templateVersion" AND c.version=NEW."channelVersion" AND t.status='approved' AND c.status='verified'
  ) THEN RAISE EXCEPTION 'invalid mock receipt binding or current approval' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "KakaoMockReceipt_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "KakaoMockReceipt" FOR EACH ROW EXECUTE FUNCTION check_kakao_mock_receipt();
