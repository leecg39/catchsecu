ALTER TABLE "Job" ADD COLUMN "localCopyErasedAt" TIMESTAMP(3);
CREATE INDEX "Job_payloadErasedAt_localCopyErasedAt_idx" ON "Job"("payloadErasedAt","localCopyErasedAt");
ALTER TABLE "Job" ADD CONSTRAINT marketing_local_copy_erasure CHECK (
  "localCopyErasedAt" IS NULL OR ("payloadErasedAt" IS NOT NULL AND status IN ('done','cancelled','dead'))
);
CREATE FUNCTION guard_marketing_local_copy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."localCopyErasedAt" IS NOT NULL AND NEW."localCopyErasedAt" IS DISTINCT FROM OLD."localCopyErasedAt"
  THEN RAISE EXCEPTION 'local erasure evidence is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER marketing_local_copy_guard BEFORE UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION guard_marketing_local_copy();
CREATE FUNCTION require_marketing_copy_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Job" WHERE "marketingSubmissionId"=NEW."submissionId" AND "localCopyErasedAt" IS NULL)
  THEN RAISE EXCEPTION 'certificate requires local delivery copy erasure' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER certificate_marketing_copy_guard BEFORE INSERT ON "DestructionCertificate"
FOR EACH ROW EXECUTE FUNCTION require_marketing_copy_erasure();
