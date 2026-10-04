-- 재위탁 수신자와 안내 발송 이력. 같은 수신자·같은 본문은 한 번만 기록한다.
CREATE TABLE "Subprocessor" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "emailCipher" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "changeSummary" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subprocessor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SubprocessorNotice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "subprocessorId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyCipher" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "jobId" TEXT,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubprocessorNotice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subprocessor_tenantId_serviceId_emailHash_key" ON "Subprocessor"("tenantId", "serviceId", "emailHash");
CREATE UNIQUE INDEX "Subprocessor_tenantId_id_key" ON "Subprocessor"("tenantId", "id");
CREATE INDEX "Subprocessor_tenantId_serviceId_status_createdAt_id_idx" ON "Subprocessor"("tenantId", "serviceId", "status", "createdAt", "id");
CREATE UNIQUE INDEX "SubprocessorNotice_tenantId_subprocessorId_contentHash_key" ON "SubprocessorNotice"("tenantId", "subprocessorId", "contentHash");
CREATE INDEX "SubprocessorNotice_tenantId_serviceId_createdAt_id_idx" ON "SubprocessorNotice"("tenantId", "serviceId", "createdAt", "id");
ALTER TABLE "Subprocessor" ADD CONSTRAINT "Subprocessor_service_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubprocessorNotice" ADD CONSTRAINT "SubprocessorNotice_subprocessor_fkey" FOREIGN KEY ("tenantId", "subprocessorId") REFERENCES "Subprocessor"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubprocessorNotice" ADD CONSTRAINT "SubprocessorNotice_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subprocessor" ADD CONSTRAINT "Subprocessor_status" CHECK ("status" IN ('active', 'archived'));
ALTER TABLE "SubprocessorNotice" ADD CONSTRAINT "SubprocessorNotice_status" CHECK ("status" IN ('queued', 'sent', 'suppressed'));
ALTER TABLE "Subprocessor" ADD CONSTRAINT "Subprocessor_lengths" CHECK (char_length("name") BETWEEN 1 AND 200 AND char_length("changeSummary") BETWEEN 1 AND 4000);
ALTER TABLE "SubprocessorNotice" ADD CONSTRAINT "SubprocessorNotice_lengths" CHECK (char_length("subject") BETWEEN 1 AND 200);
