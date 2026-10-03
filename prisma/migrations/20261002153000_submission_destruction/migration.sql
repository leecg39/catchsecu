BEGIN;
-- AlterTable
ALTER TABLE "IdempotencyRecord" ADD COLUMN     "invalidatedAt" TIMESTAMP(3),
ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "resourceType" TEXT,
ADD COLUMN     "tenantId" TEXT,
ALTER COLUMN "requestHash" DROP NOT NULL,
ALTER COLUMN "responseCipher" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SecurityPolicy" ADD COLUMN     "allowRetentionAdjustment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "automaticDestruction" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "originalRetentionUntil" TIMESTAMP(3),
ADD COLUMN     "retentionVersion" INTEGER NOT NULL DEFAULT 1;

UPDATE "Submission" SET "originalRetentionUntil"="retentionUntil";
ALTER TABLE "Submission" ALTER COLUMN "originalRetentionUntil" SET NOT NULL;
-- Previous cache rows did not declare their subject. Remove response bodies at upgrade;
-- retain replay markers so an old key never repeats a completed side effect.
UPDATE "IdempotencyRecord" SET "responseCipher"=NULL,"requestHash"=NULL,"invalidatedAt"=now();

-- CreateTable
CREATE TABLE "DestructionRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "retentionKey" TEXT,
    "previousStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "requesterId" TEXT,
    "approverId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reasonCipher" TEXT,
    "decisionCipher" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DestructionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DestructionCertificate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'active-database-and-private-storage',
    "method" TEXT NOT NULL DEFAULT 'database-delete-and-encrypted-object-unlink',
    "counts" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DestructionCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DestructionRequest_retentionKey_key" ON "DestructionRequest"("retentionKey");

-- CreateIndex
CREATE INDEX "DestructionRequest_tenantId_serviceId_createdAt_id_idx" ON "DestructionRequest"("tenantId", "serviceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DestructionRequest_status_dueAt_nextAttemptAt_idx" ON "DestructionRequest"("status", "dueAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "DestructionRequest_tenantId_submissionId_idx" ON "DestructionRequest"("tenantId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "DestructionRequest_tenantId_id_submissionId_serviceId_key" ON "DestructionRequest"("tenantId", "id", "submissionId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DestructionCertificate_submissionId_key" ON "DestructionCertificate"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "DestructionCertificate_requestId_key" ON "DestructionCertificate"("requestId");

-- CreateIndex
CREATE INDEX "DestructionCertificate_tenantId_serviceId_completedAt_id_idx" ON "DestructionCertificate"("tenantId", "serviceId", "completedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DestructionCertificate_tenantId_submissionId_key" ON "DestructionCertificate"("tenantId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "DestructionCertificate_tenantId_requestId_submissionId_serv_key" ON "DestructionCertificate"("tenantId", "requestId", "submissionId", "serviceId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_tenantId_resourceType_resourceId_idx" ON "IdempotencyRecord"("tenantId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "Submission_status_retentionUntil_idx" ON "Submission"("status", "retentionUntil");

-- AddForeignKey
ALTER TABLE "DestructionRequest" ADD CONSTRAINT "DestructionRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionRequest" ADD CONSTRAINT "DestructionRequest_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionRequest" ADD CONSTRAINT "DestructionRequest_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionRequest" ADD CONSTRAINT "DestructionRequest_tenantId_requesterId_fkey" FOREIGN KEY ("tenantId", "requesterId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionRequest" ADD CONSTRAINT "DestructionRequest_tenantId_approverId_fkey" FOREIGN KEY ("tenantId", "approverId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionCertificate" ADD CONSTRAINT "DestructionCertificate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionCertificate" ADD CONSTRAINT "DestructionCertificate_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionCertificate" ADD CONSTRAINT "DestructionCertificate_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DestructionCertificate" ADD CONSTRAINT "DestructionCertificate_tenantId_requestId_submissionId_ser_fkey" FOREIGN KEY ("tenantId", "requestId", "submissionId", "serviceId") REFERENCES "DestructionRequest"("tenantId", "id", "submissionId", "serviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Submission" DROP CONSTRAINT "Submission_status_check";
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_status_check" CHECK (status IN ('submitted','corrected','withdrawn','pendingDestruction','destroying','destroyed')),
 ADD CONSTRAINT "Submission_retention_check" CHECK ("retentionVersion">0 AND "retentionUntil"<="originalRetentionUntil");
ALTER TABLE "DestructionRequest"
 ADD CONSTRAINT "DestructionRequest_state_check" CHECK (status IN ('pending','scheduled','running','retry','failed','completed','cancelled','rejected')),
 ADD CONSTRAINT "DestructionRequest_source_check" CHECK (source IN ('manual','retention','legacy')),
 ADD CONSTRAINT "DestructionRequest_previous_check" CHECK ("previousStatus" IN ('submitted','corrected','withdrawn')),
 ADD CONSTRAINT "DestructionRequest_attempts_check" CHECK (attempts>=0 AND attempts<="maxAttempts" AND "maxAttempts">0 AND version>0),
 ADD CONSTRAINT "DestructionRequest_lease_check" CHECK ((status='running')=("leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL)),
 ADD CONSTRAINT "DestructionRequest_completed_check" CHECK ((status='completed')=("completedAt" IS NOT NULL)),
 ADD CONSTRAINT "DestructionRequest_start_check" CHECK (status NOT IN ('running','retry','failed','completed') OR "startedAt" IS NOT NULL),
 ADD CONSTRAINT "DestructionRequest_approval_check" CHECK (("approverId" IS NULL)=("approvedAt" IS NULL));
CREATE UNIQUE INDEX "DestructionRequest_one_active_submission" ON "DestructionRequest"("submissionId")
 WHERE status IN ('pending','scheduled','running','retry','failed');
ALTER TABLE "DestructionCertificate" ADD CONSTRAINT "DestructionCertificate_proof_check"
 CHECK (version=1 AND digest ~ '^[a-f0-9]{64}$' AND scope='active-database-and-private-storage' AND method='database-delete-and-encrypted-object-unlink');
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_invalidation_check"
 CHECK (("invalidatedAt" IS NULL AND "responseCipher" IS NOT NULL AND "requestHash" IS NOT NULL) OR ("invalidatedAt" IS NOT NULL AND "responseCipher" IS NULL AND "requestHash" IS NULL));

-- Upgrade only records a request. No legacy response is automatically approved.
INSERT INTO "DestructionRequest" (id,"tenantId","serviceId","submissionId",source,"previousStatus",status,"dueAt","updatedAt")
 SELECT gen_random_uuid()::text,s."tenantId",f."serviceId",s.id,'legacy','withdrawn','pending',now(),now()
 FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" JOIN "Form" f ON f.id=v."formId" WHERE s.status='pendingDestruction';

CREATE FUNCTION check_destruction_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" JOIN "Form" f ON f.id=v."formId"
  WHERE s.id=NEW."submissionId" AND s."tenantId"=NEW."tenantId" AND f."serviceId"=NEW."serviceId")
 THEN RAISE EXCEPTION 'invalid destruction service' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.version<>OLD.version+1 OR (NEW."tenantId",NEW."serviceId",NEW."submissionId",NEW.source,NEW."retentionKey",NEW."previousStatus",NEW."requesterId",NEW."createdAt")
    IS DISTINCT FROM (OLD."tenantId",OLD."serviceId",OLD."submissionId",OLD.source,OLD."retentionKey",OLD."previousStatus",OLD."requesterId",OLD."createdAt")
  THEN RAISE EXCEPTION 'immutable destruction binding or invalid version' USING ERRCODE='23514'; END IF;
  IF OLD."startedAt" IS NOT NULL AND (NEW."startedAt" IS DISTINCT FROM OLD."startedAt" OR NEW.status IN ('pending','scheduled','cancelled','rejected') OR NEW."dueAt" IS DISTINCT FROM OLD."dueAt")
  THEN RAISE EXCEPTION 'destruction already started' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT (
   (OLD.status='pending' AND NEW.status IN ('scheduled','cancelled','rejected')) OR
   (OLD.status='scheduled' AND NEW.status IN ('pending','running','cancelled','rejected')) OR
   (OLD.status='running' AND NEW.status IN ('retry','failed','completed')) OR
   (OLD.status='retry' AND NEW.status IN ('running','failed')) OR
   (OLD.status='failed' AND NEW.status='retry'))
  THEN RAISE EXCEPTION 'invalid destruction transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "DestructionRequest_guard" BEFORE INSERT OR UPDATE ON "DestructionRequest" FOR EACH ROW EXECUTE FUNCTION check_destruction_request();

CREATE FUNCTION protect_submission_destruction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."tenantId",NEW."formVersionId",NEW."publicationId",NEW."originalRetentionUntil") IS DISTINCT FROM
    (OLD."tenantId",OLD."formVersionId",OLD."publicationId",OLD."originalRetentionUntil")
 THEN RAISE EXCEPTION 'immutable submission origin' USING ERRCODE='23514'; END IF;
 IF OLD.status='destroyed' THEN RAISE EXCEPTION 'submission destroyed' USING ERRCODE='23514'; END IF;
 IF (NEW.status IN ('destroying','destroyed') AND NEW."legalHold") OR (OLD.status='destroying' AND NEW.status NOT IN ('destroying','destroyed'))
 THEN RAISE EXCEPTION 'destruction barrier' USING ERRCODE='23514'; END IF;
 IF NEW.status='destroying' AND NOT EXISTS (SELECT 1 FROM "DestructionRequest" WHERE "submissionId"=NEW.id AND status='running')
 THEN RAISE EXCEPTION 'running destruction required' USING ERRCODE='23514'; END IF;
 IF NEW.status='destroyed' AND (OLD.status<>'destroying' OR NOT EXISTS (SELECT 1 FROM "DestructionCertificate" WHERE "submissionId"=NEW.id)
   OR EXISTS (SELECT 1 FROM "Answer" WHERE "submissionId"=NEW.id)
   OR EXISTS (SELECT 1 FROM "SubmissionNote" WHERE "submissionId"=NEW.id)
   OR EXISTS (SELECT 1 FROM "ConsentReceipt" WHERE "submissionId"=NEW.id)
   OR EXISTS (SELECT 1 FROM "Correction" WHERE "submissionId"=NEW.id)
   OR EXISTS (SELECT 1 FROM "FileObject" WHERE "submissionId"=NEW.id AND status<>'deleted'))
 THEN RAISE EXCEPTION 'destruction incomplete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Submission_destruction_guard" BEFORE UPDATE ON "Submission" FOR EACH ROW EXECUTE FUNCTION protect_submission_destruction();

CREATE FUNCTION protect_submission_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT;
BEGIN
 IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'evidence immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ConsentEvent' THEN SELECT "submissionId" INTO target FROM "ConsentReceipt" WHERE id=OLD."receiptId";
 ELSE target:=OLD."submissionId"; END IF;
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "DestructionRequest" d ON d."submissionId"=s.id
   WHERE s.id=target AND s.status='destroying' AND NOT s."legalHold" AND d.status='running')
 THEN RAISE EXCEPTION 'authorized destruction required' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
DROP TRIGGER consent_event_immutable ON "ConsentEvent";
DROP TRIGGER consent_receipt_immutable ON "ConsentReceipt";
DROP TRIGGER correction_immutable ON "Correction";
CREATE TRIGGER consent_event_immutable BEFORE UPDATE OR DELETE ON "ConsentEvent" FOR EACH ROW EXECUTE FUNCTION protect_submission_evidence();
CREATE TRIGGER consent_receipt_immutable BEFORE UPDATE OR DELETE ON "ConsentReceipt" FOR EACH ROW EXECUTE FUNCTION protect_submission_evidence();
CREATE TRIGGER correction_immutable BEFORE UPDATE OR DELETE ON "Correction" FOR EACH ROW EXECUTE FUNCTION protect_submission_evidence();
CREATE TRIGGER certificate_immutable BEFORE UPDATE OR DELETE ON "DestructionCertificate" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
COMMIT;
