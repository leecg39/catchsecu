-- 서비스별 기본 보유 기간 규칙. 폼·지정값이 없을 때 회사 기본값보다 우선 적용된다.
CREATE TABLE "RetentionRule" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "retentionDays" INTEGER NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetentionRule_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_service_fkey" FOREIGN KEY ("tenantId","serviceId") REFERENCES "Service"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_days" CHECK ("retentionDays" BETWEEN 1 AND 36500);
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_status" CHECK ("status" IN ('active','archived'));
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_version" CHECK ("version" >= 1);
CREATE UNIQUE INDEX "RetentionRule_tenantId_serviceId_key" ON "RetentionRule"("tenantId","serviceId");
CREATE UNIQUE INDEX "RetentionRule_tenantId_id_key" ON "RetentionRule"("tenantId","id");
CREATE INDEX "RetentionRule_tenantId_status_createdAt_idx" ON "RetentionRule"("tenantId","status","createdAt");
