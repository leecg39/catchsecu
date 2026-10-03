BEGIN;
CREATE FUNCTION prevent_erased_subject_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT; state TEXT;
BEGIN
 IF TG_TABLE_NAME='ConsentEvent' THEN
   SELECT "submissionId" INTO target FROM "ConsentReceipt" WHERE id=NEW."receiptId";
 ELSIF TG_TABLE_NAME='CorrectionPayload' THEN
   SELECT "submissionId" INTO target FROM "Correction" WHERE id=NEW."correctionId";
 ELSE target:=NEW."submissionId"; END IF;
 IF target IS NULL THEN RETURN NEW; END IF;
 SELECT status INTO state FROM "Submission" WHERE id=target FOR SHARE;
 IF state IN ('destroying','destroyed') THEN
   IF TG_TABLE_NAME='FileObject' AND TG_OP='UPDATE' AND NEW.status IN ('deleting','deleted') THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'subject destruction write barrier' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subject_write_barrier BEFORE INSERT OR UPDATE ON "Answer" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();
CREATE TRIGGER subject_write_barrier BEFORE INSERT OR UPDATE ON "SubmissionNote" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();
CREATE TRIGGER subject_write_barrier BEFORE INSERT ON "Correction" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();
CREATE TRIGGER subject_write_barrier BEFORE INSERT ON "CorrectionPayload" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();
CREATE TRIGGER subject_write_barrier BEFORE INSERT ON "ConsentReceipt" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();
CREATE TRIGGER subject_write_barrier BEFORE INSERT ON "ConsentEvent" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();
CREATE TRIGGER subject_write_barrier BEFORE INSERT OR UPDATE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();

CREATE FUNCTION validate_destruction_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "DestructionRequest" d ON d."submissionId"=s.id
   WHERE s.id=NEW."submissionId" AND s."tenantId"=NEW."tenantId" AND s.status='destroying' AND NOT s."legalHold" AND d.id=NEW."requestId" AND d.status='running')
   OR EXISTS (SELECT 1 FROM "Answer" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "SubmissionNote" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "Correction" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ConsentReceipt" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "FileObject" WHERE "submissionId"=NEW."submissionId" AND status<>'deleted')
 THEN RAISE EXCEPTION 'certificate requires completed erasure' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.counts)<>'object' OR EXISTS (SELECT 1 FROM jsonb_each(NEW.counts) e
   WHERE e.key NOT IN ('answers','notes','correctionPayloads','corrections','consentEvents','receipts','files')
   OR e.value::text !~ '^[0-9]+$')
 THEN RAISE EXCEPTION 'certificate contains invalid counts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER certificate_requires_erasure BEFORE INSERT ON "DestructionCertificate" FOR EACH ROW EXECUTE FUNCTION validate_destruction_certificate();
COMMIT;
