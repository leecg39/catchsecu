-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "approvalId" TEXT;

-- AlterTable
ALTER TABLE "SecurityPolicy" ADD COLUMN     "approvalReferenceRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvalRequestTemplate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "approvalRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "approvalRoles" "Role"[] DEFAULT ARRAY['owner']::"Role"[];

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "formRevision" INTEGER NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "requestCipher" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decisionCipher" TEXT,
    "decidedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRequest_tenantId_status_createdAt_id_idx" ON "ApprovalRequest"("tenantId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ApprovalRequest_formId_createdAt_idx" ON "ApprovalRequest"("formId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_tenantId_formId_formVersionId_id_key" ON "ApprovalRequest"("tenantId", "formId", "formVersionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_approvalId_key" ON "Publication"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_tenantId_formId_formVersionId_approvalId_key" ON "Publication"("tenantId", "formId", "formVersionId", "approvalId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_tenantId_formId_fkey" FOREIGN KEY ("tenantId", "formId") REFERENCES "Form"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_tenantId_formId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formId", "formVersionId") REFERENCES "FormVersion"("tenantId", "formId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_tenantId_requestedBy_fkey" FOREIGN KEY ("tenantId", "requestedBy") REFERENCES "Membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_tenantId_decidedBy_fkey" FOREIGN KEY ("tenantId", "decidedBy") REFERENCES "Membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_tenantId_formId_formVersionId_approvalId_fkey" FOREIGN KEY ("tenantId", "formId", "formVersionId", "approvalId") REFERENCES "ApprovalRequest"("tenantId", "formId", "formVersionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Approval evidence is append-only; terminal decisions cannot be edited or removed.
ALTER TABLE "SecurityPolicy" ALTER COLUMN "approvalRoles" SET NOT NULL;
ALTER TABLE "SecurityPolicy" ADD CONSTRAINT "SecurityPolicy_approval_roles_check"
  CHECK (cardinality("approvalRoles") BETWEEN 1 AND 3 AND 'owner'::"Role" = ANY("approvalRoles")
    AND "approvalRoles" <@ ARRAY['owner','admin','security']::"Role"[]);
ALTER TABLE "SecurityPolicy" ADD CONSTRAINT "SecurityPolicy_approval_revision_check" CHECK ("approvalRevision" > 0);
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_status_check"
  CHECK (status IN ('pending','approved','rejected','cancelled','superseded','consumed'));
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_version_check"
  CHECK (version > 0 AND "formRevision" > 0 AND "policyRevision" > 0);
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decision_check"
  CHECK ((status = 'pending' AND "decidedBy" IS NULL AND "decidedAt" IS NULL AND "decisionCipher" IS NULL)
    OR status = 'superseded'
    OR (status IN ('approved','rejected','cancelled','consumed') AND "decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decisionCipher" IS NOT NULL));
CREATE UNIQUE INDEX "ApprovalRequest_one_active_per_form" ON "ApprovalRequest" ("formId") WHERE status IN ('pending','approved');

CREATE FUNCTION protect_approval_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Approval evidence cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.version <> 1 THEN RAISE EXCEPTION 'Approval must start pending'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','version','updatedAt','decidedBy','decisionCipher','decidedAt'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','updatedAt','decidedBy','decisionCipher','decidedAt'])
    THEN RAISE EXCEPTION 'Approval snapshot is immutable'; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'Approval version must increment'; END IF;
  IF NOT ((OLD.status = 'pending' AND NEW.status IN ('approved','rejected','cancelled','superseded'))
    OR (OLD.status = 'approved' AND NEW.status IN ('superseded','consumed')))
    THEN RAISE EXCEPTION 'Invalid approval transition'; END IF;
  IF OLD.status <> 'pending' AND (NEW."decidedBy",NEW."decisionCipher",NEW."decidedAt")
    IS DISTINCT FROM (OLD."decidedBy",OLD."decisionCipher",OLD."decidedAt")
    THEN RAISE EXCEPTION 'Approval decision is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ApprovalRequest_evidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ApprovalRequest"
  FOR EACH ROW EXECUTE FUNCTION protect_approval_evidence();

CREATE FUNCTION enforce_publication_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_required boolean; policy_revision integer; approval_status text; approval_revision integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."approvalId" IS DISTINCT FROM OLD."approvalId" THEN RAISE EXCEPTION 'Publication approval is immutable'; END IF;
    RETURN NEW;
  END IF;
  SELECT "requireApproval","approvalRevision" INTO policy_required,policy_revision FROM "SecurityPolicy" WHERE "tenantId" = NEW."tenantId";
  IF policy_required AND NEW."approvalId" IS NULL THEN RAISE EXCEPTION 'Publication requires approval'; END IF;
  IF NEW."approvalId" IS NOT NULL THEN
    SELECT status,"policyRevision" INTO approval_status,approval_revision FROM "ApprovalRequest"
      WHERE id = NEW."approvalId" AND "tenantId" = NEW."tenantId" AND "formId" = NEW."formId" AND "formVersionId" = NEW."formVersionId";
    IF approval_status IS DISTINCT FROM 'approved' OR approval_revision IS DISTINCT FROM policy_revision
      THEN RAISE EXCEPTION 'Publication approval is invalid'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Publication_approval_guard" BEFORE INSERT OR UPDATE ON "Publication"
  FOR EACH ROW EXECUTE FUNCTION enforce_publication_approval();

UPDATE "ServiceGrant" g SET capabilities = ARRAY(SELECT DISTINCT value FROM unnest(g.capabilities || ARRAY['form.read','form.approve']) value)
  FROM "Membership" m WHERE g."memberId" = m.id AND g."tenantId" = m."tenantId" AND m.role = 'security';
