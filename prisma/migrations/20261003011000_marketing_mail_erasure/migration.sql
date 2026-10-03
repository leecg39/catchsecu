

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "marketingPreferenceId" TEXT,
ADD COLUMN     "marketingSubmissionId" TEXT,
ADD COLUMN     "payloadErasedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_marketingPreferenceId_fkey" FOREIGN KEY ("tenantId", "marketingPreferenceId") REFERENCES "MarketingPreference"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_marketingSubmissionId_fkey" FOREIGN KEY ("tenantId", "marketingSubmissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Job_marketing_source" ON "Job"("marketingSubmissionId");
CREATE INDEX "Job_marketing_preference" ON "Job"("marketingPreferenceId");
ALTER TABLE "Job" ADD CONSTRAINT "marketing_job_binding" CHECK (("marketingPreferenceId" IS NULL AND "marketingSubmissionId" IS NULL) OR ("tenantId" IS NOT NULL AND "marketingPreferenceId" IS NOT NULL AND "marketingSubmissionId" IS NOT NULL AND type='mail'));
CREATE FUNCTION guard_marketing_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW."marketingPreferenceId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "MarketingPreference" p WHERE p.id=NEW."marketingPreferenceId" AND p."tenantId"=NEW."tenantId" AND p."sourceSubmissionId"=NEW."marketingSubmissionId" AND p.status='granted')
 THEN RAISE EXCEPTION 'invalid marketing job binding' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW."marketingPreferenceId",NEW."marketingSubmissionId",NEW."tenantId") IS DISTINCT FROM ROW(OLD."marketingPreferenceId",OLD."marketingSubmissionId",OLD."tenantId")
 THEN RAISE EXCEPTION 'immutable marketing job binding' USING ERRCODE='23514'; END IF;
 IF NEW."payloadErasedAt" IS NOT NULL AND NEW.status IN ('queued','leased','retry') THEN RAISE EXCEPTION 'erased jobs cannot run' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketing_job_guard BEFORE INSERT OR UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION guard_marketing_job();

CREATE OR REPLACE FUNCTION validate_destruction_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "DestructionRequest" d ON d."submissionId"=s.id
   WHERE s.id=NEW."submissionId" AND s."tenantId"=NEW."tenantId" AND s.status='destroying' AND NOT s."legalHold" AND d.id=NEW."requestId" AND d.status='running')
   OR EXISTS (SELECT 1 FROM "Submission" WHERE id=NEW."submissionId" AND "subjectId" IS NOT NULL)
   OR EXISTS (SELECT 1 FROM "MarketingPreference" WHERE "sourceSubmissionId"=NEW."submissionId" AND ("contactCipher" IS NOT NULL OR "evidenceCipher" IS NOT NULL OR "nameHash" IS NOT NULL))
   OR EXISTS (SELECT 1 FROM "Job" WHERE "marketingSubmissionId"=NEW."submissionId" AND "payloadErasedAt" IS NULL)
   OR EXISTS (SELECT 1 FROM "Answer" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "SubmissionNote" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "Correction" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ConsentReceipt" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportEvidence" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportRow" WHERE "submissionId"=NEW."submissionId" AND ("payloadCipher" IS NOT NULL OR digest IS NOT NULL))
   OR EXISTS (SELECT 1 FROM "FileObject" WHERE "submissionId"=NEW."submissionId" AND status<>'deleted')
 THEN RAISE EXCEPTION 'certificate requires completed erasure' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.counts)<>'object' OR EXISTS (SELECT 1 FROM jsonb_each(NEW.counts) e
   WHERE e.key NOT IN ('answers','notes','correctionPayloads','corrections','consentEvents','receipts','files','importEvidence','importRows','subjectBindings','dataSubjects','marketingPreferences','marketingJobs')
   OR e.value::text !~ '^[0-9]+$')
 THEN RAISE EXCEPTION 'certificate contains invalid counts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
