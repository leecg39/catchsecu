BEGIN;

CREATE FUNCTION verification_receipt_live_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submission "Submission";
BEGIN
  IF NEW."submissionId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO submission FROM "Submission" WHERE id=NEW."submissionId" AND "tenantId"=NEW."tenantId" FOR SHARE;
  IF NOT FOUND OR submission.status IN ('destroying','destroyed')
    OR (NOT submission."legalHold" AND submission."retentionUntil"<=clock_timestamp())
    OR NEW."retentionUntil">submission."originalRetentionUntil"
    THEN RAISE EXCEPTION 'verification receipt requires available submission' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_receipt_00_live BEFORE INSERT OR UPDATE ON "VerificationReceipt"
  FOR EACH ROW EXECUTE FUNCTION verification_receipt_live_submission();

CREATE FUNCTION verification_receipt_erase_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."submissionId" IS NULL THEN
    IF OLD."retentionUntil">clock_timestamp() THEN RAISE EXCEPTION 'unexpired verification receipt' USING ERRCODE='23514'; END IF;
  ELSE
    PERFORM id FROM "Submission" WHERE id=OLD."submissionId" AND "tenantId"=OLD."tenantId" FOR SHARE;
    IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "DestructionRequest" d ON d."submissionId"=s.id AND d."tenantId"=s."tenantId"
      WHERE s.id=OLD."submissionId" AND s."tenantId"=OLD."tenantId" AND s.status='destroying' AND NOT s."legalHold"
        AND d.status='running' AND d."leaseUntil">clock_timestamp())
      THEN RAISE EXCEPTION 'verification erasure requires current destruction lease' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER verification_receipt_erase_guard BEFORE DELETE ON "VerificationReceipt"
  FOR EACH ROW EXECUTE FUNCTION verification_receipt_erase_guard();

CREATE FUNCTION verification_receipt_erase_related() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "VerificationEvent" WHERE "attemptId"=OLD."attemptId" AND "tenantId"=OLD."tenantId";
  DELETE FROM "VerificationAttempt" WHERE id=OLD."attemptId" AND "tenantId"=OLD."tenantId";
  RETURN OLD;
END $$;
CREATE TRIGGER verification_receipt_erase_related AFTER DELETE ON "VerificationReceipt"
  FOR EACH ROW EXECUTE FUNCTION verification_receipt_erase_related();

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('validate_destruction_certificate()'::regprocedure) INTO definition;
  IF position('''campaignRecipients''' IN definition)=0 THEN RAISE EXCEPTION 'destruction count contract not found'; END IF;
  EXECUTE replace(definition,'''campaignRecipients''','''campaignRecipients'',''verificationReceipts'',''verificationEvents'',''verificationAttempts''');
END $$;

CREATE FUNCTION certificate_requires_verification_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "VerificationReceipt" WHERE "submissionId"=NEW."submissionId" AND "tenantId"=NEW."tenantId")
    OR NOT EXISTS (SELECT 1 FROM "DestructionRequest" WHERE id=NEW."requestId" AND "tenantId"=NEW."tenantId"
      AND "submissionId"=NEW."submissionId" AND status='running' AND "leaseUntil">clock_timestamp())
    THEN RAISE EXCEPTION 'certificate requires verification erasure and current lease' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER certificate_verification_erasure BEFORE INSERT ON "DestructionCertificate"
  FOR EACH ROW EXECUTE FUNCTION certificate_requires_verification_erasure();

COMMIT;
