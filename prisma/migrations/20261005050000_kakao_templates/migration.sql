-- 알림톡 채널·템플릿. 공급자 심사 없이 approved/verified로 만들지 않는다.
CREATE TABLE "KakaoChannel" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "searchId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KakaoChannel_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "KakaoTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "buttons" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "reviewNote" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KakaoTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KakaoChannel_tenantId_serviceId_searchId_key" ON "KakaoChannel"("tenantId", "serviceId", "searchId");
CREATE UNIQUE INDEX "KakaoChannel_tenantId_id_key" ON "KakaoChannel"("tenantId", "id");
CREATE INDEX "KakaoChannel_tenantId_serviceId_status_createdAt_idx" ON "KakaoChannel"("tenantId", "serviceId", "status", "createdAt");
CREATE UNIQUE INDEX "KakaoTemplate_tenantId_serviceId_name_key" ON "KakaoTemplate"("tenantId", "serviceId", "name");
CREATE UNIQUE INDEX "KakaoTemplate_tenantId_id_key" ON "KakaoTemplate"("tenantId", "id");
CREATE INDEX "KakaoTemplate_tenantId_channelId_status_idx" ON "KakaoTemplate"("tenantId", "channelId", "status");
ALTER TABLE "KakaoChannel" ADD CONSTRAINT "KakaoChannel_service_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KakaoTemplate" ADD CONSTRAINT "KakaoTemplate_channel_fkey" FOREIGN KEY ("tenantId", "channelId") REFERENCES "KakaoChannel"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KakaoChannel" ADD CONSTRAINT "KakaoChannel_status" CHECK ("status" IN ('pending', 'verified', 'archived'));
ALTER TABLE "KakaoTemplate" ADD CONSTRAINT "KakaoTemplate_status" CHECK ("status" IN ('draft', 'submitted', 'rejected', 'approved', 'archived'));
ALTER TABLE "KakaoChannel" ADD CONSTRAINT "KakaoChannel_lengths" CHECK (char_length("name") BETWEEN 1 AND 40 AND "searchId" ~ '^@[A-Za-z0-9_]{1,20}$');
ALTER TABLE "KakaoTemplate" ADD CONSTRAINT "KakaoTemplate_lengths" CHECK (char_length("name") BETWEEN 1 AND 100 AND char_length("body") BETWEEN 1 AND 1000);
