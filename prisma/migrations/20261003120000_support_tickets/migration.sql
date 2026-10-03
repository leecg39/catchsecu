CREATE TABLE "SupportTicket" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenantId" text NOT NULL,
  "serviceId" text,
  "authorId" text NOT NULL,
  "answeredById" text,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  "subjectCipher" text,
  "bodyCipher" text,
  "replyCipher" text,
  "answeredAt" timestamp(3),
  "closedAt" timestamp(3),
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"(id) ON DELETE RESTRICT,
  CONSTRAINT "SupportTicket_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", id) ON DELETE RESTRICT,
  CONSTRAINT "SupportTicket_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"(id) ON DELETE RESTRICT,
  CONSTRAINT "SupportTicket_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"(id) ON DELETE RESTRICT,
  CONSTRAINT "SupportTicket_state_check" CHECK (
    kind IN ('inquiry','suggestion') AND status IN ('submitted','answered','closed','archived')
    AND version > 0
    AND ((status = 'archived' AND "subjectCipher" IS NULL AND "bodyCipher" IS NULL AND "replyCipher" IS NULL)
      OR (status <> 'archived' AND "subjectCipher" IS NOT NULL AND "bodyCipher" IS NOT NULL))
    AND (("replyCipher" IS NULL AND "answeredAt" IS NULL AND "answeredById" IS NULL)
      OR ("replyCipher" IS NOT NULL AND "answeredAt" IS NOT NULL AND "answeredById" IS NOT NULL))
    AND (status <> 'answered' OR "replyCipher" IS NOT NULL)
    AND ((status = 'closed' AND "closedAt" IS NOT NULL) OR (status <> 'closed' AND "closedAt" IS NULL))
  )
);
CREATE INDEX "SupportTicket_tenant_author_status_created_idx" ON "SupportTicket"("tenantId", "authorId", status, "createdAt", id);
CREATE INDEX "SupportTicket_status_created_idx" ON "SupportTicket"(status, "createdAt", id);
