CREATE OR REPLACE FUNCTION validate_destruction_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "DestructionRequest" d ON d."submissionId"=s.id
   WHERE s.id=NEW."submissionId" AND s."tenantId"=NEW."tenantId" AND s.status='destroying' AND NOT s."legalHold" AND d.id=NEW."requestId" AND d.status='running')
   OR EXISTS (SELECT 1 FROM "Submission" WHERE id=NEW."submissionId" AND "subjectId" IS NOT NULL)
   OR EXISTS (SELECT 1 FROM "Answer" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "SubmissionNote" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "Correction" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ConsentReceipt" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportEvidence" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportRow" WHERE "submissionId"=NEW."submissionId" AND ("payloadCipher" IS NOT NULL OR digest IS NOT NULL))
   OR EXISTS (SELECT 1 FROM "FileObject" WHERE "submissionId"=NEW."submissionId" AND status<>'deleted')
 THEN RAISE EXCEPTION 'certificate requires completed erasure' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.counts)<>'object' OR EXISTS (SELECT 1 FROM jsonb_each(NEW.counts) e
   WHERE e.key NOT IN ('answers','notes','correctionPayloads','corrections','consentEvents','receipts','files','importEvidence','importRows','subjectBindings','dataSubjects')
   OR e.value::text !~ '^[0-9]+$')
 THEN RAISE EXCEPTION 'certificate contains invalid counts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
