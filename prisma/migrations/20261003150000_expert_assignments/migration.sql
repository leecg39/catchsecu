CREATE TABLE "ExpertAssignment" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "expertUserId" text NOT NULL,
  "assignedById" text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  "expiresAt" timestamp(3) NOT NULL,
  "revokedAt" timestamp(3),
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpertAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"(id) ON DELETE RESTRICT,
  CONSTRAINT "ExpertAssignment_expertUserId_fkey" FOREIGN KEY ("expertUserId") REFERENCES "User"(id) ON DELETE RESTRICT,
  CONSTRAINT "ExpertAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"(id) ON DELETE RESTRICT,
  CONSTRAINT "ExpertAssignment_state_check" CHECK (
    version > 0 AND "expiresAt" > "createdAt" AND "expertUserId" <> "assignedById" AND
    ((status = 'active' AND "revokedAt" IS NULL) OR (status = 'revoked' AND "revokedAt" IS NOT NULL))
  )
);
CREATE UNIQUE INDEX "ExpertAssignment_tenant_id_key" ON "ExpertAssignment"("tenantId", id);
CREATE UNIQUE INDEX "ExpertAssignment_tenant_id_user_key" ON "ExpertAssignment"("tenantId", id, "expertUserId");
CREATE UNIQUE INDEX "ExpertAssignment_tenant_user_key" ON "ExpertAssignment"("tenantId", "expertUserId");
CREATE INDEX "ExpertAssignment_user_status_expiry_idx" ON "ExpertAssignment"("expertUserId", status, "expiresAt");

CREATE TABLE "ExpertAssignmentService" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "assignmentId" text NOT NULL,
  "serviceId" text NOT NULL,
  CONSTRAINT "ExpertAssignmentService_assignment_fkey" FOREIGN KEY ("tenantId", "assignmentId") REFERENCES "ExpertAssignment"("tenantId", id) ON DELETE CASCADE,
  CONSTRAINT "ExpertAssignmentService_service_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ExpertAssignmentService_scope_key" ON "ExpertAssignmentService"("tenantId", "assignmentId", "serviceId");
CREATE INDEX "ExpertAssignmentService_service_idx" ON "ExpertAssignmentService"("tenantId", "serviceId");

ALTER TABLE "Membership" ADD COLUMN "accessKind" text NOT NULL DEFAULT 'direct';
ALTER TABLE "Membership" ADD COLUMN "expertAssignmentId" text;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_accessKind_check" CHECK (
  ("accessKind" = 'direct' AND "expertAssignmentId" IS NULL) OR
  ("accessKind" = 'expert' AND "expertAssignmentId" IS NOT NULL AND role = 'viewer')
);
CREATE UNIQUE INDEX "Membership_expertAssignmentId_key" ON "Membership"("expertAssignmentId");
CREATE UNIQUE INDEX "Membership_tenant_assignment_user_key" ON "Membership"("tenantId", "expertAssignmentId", "userId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_expertAssignment_fkey"
  FOREIGN KEY ("tenantId", "expertAssignmentId", "userId")
  REFERENCES "ExpertAssignment"("tenantId", id, "expertUserId") ON DELETE RESTRICT;
