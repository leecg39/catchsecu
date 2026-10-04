-- 월별 집계 마감. 같은 회사·범위·월은 한 번만 저장하고 이후 원천이 바뀌어도 합계를 유지한다.
CREATE TABLE "ComplianceClose" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceKey" TEXT NOT NULL DEFAULT '',
  "month" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplianceClose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComplianceClose_tenantId_serviceKey_month_key" ON "ComplianceClose"("tenantId", "serviceKey", "month");
CREATE INDEX "ComplianceClose_tenantId_createdAt_idx" ON "ComplianceClose"("tenantId", "createdAt");
ALTER TABLE "ComplianceClose" ADD CONSTRAINT "ComplianceClose_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplianceClose" ADD CONSTRAINT "ComplianceClose_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
