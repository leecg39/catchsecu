ALTER TABLE "Company"
  ADD COLUMN "billingContactName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "billingContactPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "closureRequestedAt" TIMESTAMP(3),
  ADD COLUMN "closureReasonCipher" TEXT,
  ADD COLUMN "closureRequestedById" TEXT;
ALTER TABLE "Company" ADD CONSTRAINT "Company_closure_requested_by_fkey"
  FOREIGN KEY (id, "closureRequestedById") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT;
ALTER TABLE "Company" ADD CONSTRAINT "Company_closure_request_check" CHECK
  (("closureRequestedAt" IS NULL AND "closureReasonCipher" IS NULL AND "closureRequestedById" IS NULL)
  OR ("closureRequestedAt" IS NOT NULL AND "closureReasonCipher" IS NOT NULL AND "closureRequestedById" IS NOT NULL));
CREATE TABLE "CompanyBusinessFile" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  "nameCipher" TEXT,
  mime TEXT,
  size INTEGER NOT NULL CHECK (size >= 0 AND size <= 10485760),
  sha256 TEXT,
  "storageKey" TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleting','deleted')),
  "scanEngine" TEXT NOT NULL,
  "scannedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", id),
  CHECK ((status = 'deleted' AND "nameCipher" IS NULL AND mime IS NULL AND size = 0 AND sha256 IS NULL AND "storageKey" IS NULL)
    OR (status <> 'deleted' AND "nameCipher" IS NOT NULL AND mime IN ('application/pdf','image/png','image/jpeg') AND size > 0 AND sha256 IS NOT NULL AND "storageKey" IS NOT NULL))
);
CREATE UNIQUE INDEX "CompanyBusinessFile_active_tenant_key" ON "CompanyBusinessFile"("tenantId") WHERE status = 'active';
CREATE INDEX "CompanyBusinessFile_status_createdAt_idx" ON "CompanyBusinessFile"(status, "createdAt");
