CREATE TABLE "AccessRequest" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "requesterId" text NOT NULL,
  "serviceId" text NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  version integer NOT NULL DEFAULT 1,
  "reviewerId" text,
  "decisionNote" text NOT NULL DEFAULT '',
  "resolvedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"(id) ON DELETE RESTRICT,
  CONSTRAINT "AccessRequest_requester_fkey" FOREIGN KEY ("tenantId", "requesterId") REFERENCES "Membership"("tenantId", id) ON DELETE RESTRICT,
  CONSTRAINT "AccessRequest_service_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", id) ON DELETE RESTRICT,
  CONSTRAINT "AccessRequest_reviewer_fkey" FOREIGN KEY ("tenantId", "reviewerId") REFERENCES "Membership"("tenantId", id) ON DELETE RESTRICT,
  CONSTRAINT "AccessRequest_state_check" CHECK (
    status IN ('pending', 'approved', 'rejected', 'cancelled') AND version > 0 AND
    ((status = 'pending' AND "reviewerId" IS NULL AND "resolvedAt" IS NULL AND "decisionNote" = '') OR
     (status = 'cancelled' AND "reviewerId" IS NULL AND "resolvedAt" IS NOT NULL AND "decisionNote" = '') OR
     (status IN ('approved', 'rejected') AND "reviewerId" IS NOT NULL AND "resolvedAt" IS NOT NULL))
  )
);
CREATE UNIQUE INDEX "AccessRequest_tenant_id_key" ON "AccessRequest"("tenantId", id);
CREATE UNIQUE INDEX "AccessRequest_one_pending_key" ON "AccessRequest"("tenantId", "requesterId", "serviceId") WHERE status = 'pending';
CREATE INDEX "AccessRequest_requester_created_idx" ON "AccessRequest"("tenantId", "requesterId", "createdAt", id);
CREATE INDEX "AccessRequest_status_created_idx" ON "AccessRequest"("tenantId", status, "createdAt", id);
