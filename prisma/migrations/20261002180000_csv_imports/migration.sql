BEGIN;
-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "encoding" TEXT NOT NULL DEFAULT 'utf-8';

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'form';

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "importJobId" TEXT,
ADD COLUMN     "importRowNo" INTEGER,
ALTER COLUMN "publicationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "committerId" TEXT,
    "title" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "purposeId" TEXT,
    "sourceRecipientId" TEXT,
    "headersCipher" TEXT,
    "mappingCipher" TEXT,
    "snapshotCipher" TEXT,
    "purposeVersion" INTEGER,
    "sourceRecipientVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "version" INTEGER NOT NULL DEFAULT 1,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "formVersionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "payloadCipher" TEXT,
    "digest" TEXT,
    "errors" JSONB NOT NULL,
    "duplicateOf" INTEGER,
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportEvidence" (
    "submissionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "payloadCipher" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportEvidence_pkey" PRIMARY KEY ("submissionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_fileId_key" ON "ImportJob"("fileId");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_serviceId_status_createdAt_id_idx" ON "ImportJob"("tenantId", "serviceId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ImportJob_status_leaseUntil_nextAttemptAt_idx" ON "ImportJob"("status", "leaseUntil", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ImportJob_expiresAt_idx" ON "ImportJob"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_tenantId_serviceId_fileId_key" ON "ImportJob"("tenantId", "serviceId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_tenantId_id_key" ON "ImportJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_tenantId_id_formVersionId_key" ON "ImportJob"("tenantId", "id", "formVersionId");

-- CreateIndex
CREATE INDEX "ImportRow_tenantId_jobId_status_rowNo_idx" ON "ImportRow"("tenantId", "jobId", "status", "rowNo");

-- CreateIndex
CREATE INDEX "ImportRow_submissionId_idx" ON "ImportRow"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_tenantId_jobId_rowNo_key" ON "ImportRow"("tenantId", "jobId", "rowNo");

-- CreateIndex
CREATE UNIQUE INDEX "ImportEvidence_tenantId_submissionId_key" ON "ImportEvidence"("tenantId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_tenantId_serviceId_id_key" ON "FileObject"("tenantId", "serviceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_tenantId_importJobId_importRowNo_key" ON "Submission"("tenantId", "importJobId", "importRowNo");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_tenantId_importJobId_formVersionId_fkey" FOREIGN KEY ("tenantId", "importJobId", "formVersionId") REFERENCES "ImportJob"("tenantId", "id", "formVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_creatorId_fkey" FOREIGN KEY ("tenantId", "creatorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_committerId_fkey" FOREIGN KEY ("tenantId", "committerId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_serviceId_fileId_fkey" FOREIGN KEY ("tenantId", "serviceId", "fileId") REFERENCES "FileObject"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_serviceId_purposeId_fkey" FOREIGN KEY ("tenantId", "serviceId", "purposeId") REFERENCES "ProcessingPurpose"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_serviceId_sourceRecipientId_fkey" FOREIGN KEY ("tenantId", "serviceId", "sourceRecipientId") REFERENCES "Recipient"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formVersionId") REFERENCES "FormVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "ImportJob"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_tenantId_jobId_duplicateOf_fkey" FOREIGN KEY ("tenantId", "jobId", "duplicateOf") REFERENCES "ImportRow"("tenantId", "jobId", "rowNo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportEvidence" ADD CONSTRAINT "ImportEvidence_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportEvidence" ADD CONSTRAINT "ImportEvidence_tenantId_jobId_fkey" FOREIGN KEY ("tenantId", "jobId") REFERENCES "ImportJob"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FileObject" DROP CONSTRAINT "FileObject_owner_check";
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_owner_check" CHECK (
 ("ownerKind" IN ('member','import') AND "ownerId" IS NOT NULL AND "uploadTokenHash" IS NULL) OR
 ("ownerKind"='public' AND "ownerId" IS NULL AND "publicationId" IS NOT NULL AND
 ((status IN ('pending','uploaded','ready','rejected') AND "uploadTokenHash" IS NOT NULL) OR (status IN ('attached','deleting','deleted') AND "uploadTokenHash" IS NULL))));
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_import_check" CHECK (
 encoding IN ('utf-8','euc-kr') AND (encoding='utf-8' OR "ownerKind"='import') AND
 ("ownerKind"<>'import' OR (mime='text/csv' AND "questionId" IS NULL AND "submissionId" IS NULL AND "formVersionId" IS NULL AND "publicationId" IS NULL)));
CREATE FUNCTION protect_file_encoding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.encoding IS DISTINCT FROM OLD.encoding THEN RAISE EXCEPTION 'immutable encoding' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER file_encoding_immutable BEFORE UPDATE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION protect_file_encoding();
ALTER TABLE "Form" ADD CONSTRAINT "Form_source_check" CHECK ("sourceType" IN ('form','import') AND ("sourceType"<>'import' OR (status='archived' AND "publishedVersionId" IS NULL)));
CREATE FUNCTION protect_import_form() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='Publication' THEN
   IF EXISTS (SELECT 1 FROM "Form" WHERE id=NEW."formId" AND "sourceType"='import') THEN RAISE EXCEPTION 'import forms cannot publish' USING ERRCODE='23514'; END IF;
 ELSIF NEW."sourceType" IS DISTINCT FROM OLD."sourceType" THEN RAISE EXCEPTION 'immutable form origin' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_form_immutable BEFORE UPDATE ON "Form" FOR EACH ROW EXECUTE FUNCTION protect_import_form();
CREATE TRIGGER publication_not_import BEFORE INSERT OR UPDATE ON "Publication" FOR EACH ROW EXECUTE FUNCTION protect_import_form();
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_source_check" CHECK (
 ("publicationId" IS NOT NULL AND "importJobId" IS NULL AND "importRowNo" IS NULL) OR
 ("publicationId" IS NULL AND "importJobId" IS NOT NULL AND "importRowNo">=2));
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_state_check" CHECK (
 status IN ('uploading','draft','validated','committing','retry','failed','completed','partialFailed','cancelled','expired','archived') AND
 version>0 AND "totalRows" BETWEEN 0 AND 10000 AND "validRows">=0 AND "invalidRows">=0 AND "skippedRows">=0 AND "importedRows">=0 AND
 "validRows"+"invalidRows"+"skippedRows"<="totalRows" AND "importedRows"<="validRows" AND attempts>=0 AND
 (("leaseOwner" IS NULL)=("leaseUntil" IS NULL)) AND ("leaseOwner" IS NULL OR status='committing') AND
 ("startedAt" IS NULL OR "committerId" IS NOT NULL) AND
 (status NOT IN ('completed','partialFailed') OR ("completedAt" IS NOT NULL AND "importedRows"="validRows")));
CREATE FUNCTION guard_import_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'uploading' OR NEW.version<>1 OR NOT EXISTS (SELECT 1 FROM "FileObject" WHERE id=NEW."fileId" AND "ownerKind"='import' AND "ownerId"=NEW."creatorId" AND status='pending')
   THEN RAISE EXCEPTION 'invalid initial import' USING ERRCODE='23514'; END IF;
 ELSE
   IF NEW.version<>OLD.version+1 OR (NEW.id,NEW."tenantId",NEW."serviceId",NEW."creatorId",NEW."fileId",NEW."expiresAt",NEW.title) IS DISTINCT FROM
    (OLD.id,OLD."tenantId",OLD."serviceId",OLD."creatorId",OLD."fileId",OLD."expiresAt",OLD.title)
   THEN RAISE EXCEPTION 'immutable import binding' USING ERRCODE='23514'; END IF;
   IF OLD."formVersionId" IS NOT NULL AND NEW."formVersionId" IS DISTINCT FROM OLD."formVersionId" THEN RAISE EXCEPTION 'immutable import form' USING ERRCODE='23514'; END IF;
   IF OLD."startedAt" IS NOT NULL AND (
      (NEW."purposeId",NEW."sourceRecipientId",NEW."purposeVersion",NEW."sourceRecipientVersion",NEW."startedAt") IS DISTINCT FROM (OLD."purposeId",OLD."sourceRecipientId",OLD."purposeVersion",OLD."sourceRecipientVersion",OLD."startedAt") OR
      (NEW."mappingCipher" IS NOT NULL AND NEW."mappingCipher" IS DISTINCT FROM OLD."mappingCipher") OR
      (NEW."snapshotCipher" IS NOT NULL AND NEW."snapshotCipher" IS DISTINCT FROM OLD."snapshotCipher") OR
      (NEW."headersCipher" IS NOT NULL AND NEW."headersCipher" IS DISTINCT FROM OLD."headersCipher"))
   THEN RAISE EXCEPTION 'committed import config immutable' USING ERRCODE='23514'; END IF;
   IF NEW.status<>OLD.status AND NOT (
     (OLD.status='uploading' AND NEW.status IN ('draft','cancelled','expired')) OR
     (OLD.status IN ('draft','validated') AND NEW.status IN ('draft','validated','cancelled','expired')) OR
     (OLD.status='validated' AND NEW.status='committing') OR
     (OLD.status IN ('committing','retry') AND NEW.status IN ('committing','retry','failed','completed','partialFailed','expired')) OR
     (OLD.status='failed' AND NEW.status IN ('committing','archived','expired')) OR
     (OLD.status IN ('completed','partialFailed') AND NEW.status='archived'))
   THEN RAISE EXCEPTION 'invalid import transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."formVersionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FormVersion" v JOIN "Form" f ON f.id=v."formId"
 WHERE v.id=NEW."formVersionId" AND f."serviceId"=NEW."serviceId" AND f."sourceType"='import' AND v.status='published')
 THEN RAISE EXCEPTION 'invalid import form binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_job_guard BEFORE INSERT OR UPDATE ON "ImportJob" FOR EACH ROW EXECUTE FUNCTION guard_import_job();
CREATE FUNCTION guard_import_submission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW."importJobId",NEW."importRowNo") IS DISTINCT FROM (OLD."importJobId",OLD."importRowNo") THEN RAISE EXCEPTION 'immutable import origin' USING ERRCODE='23514'; END IF;
 ELSIF NEW."importJobId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "ImportJob" j JOIN "FileObject" f ON f.id=j."fileId" JOIN "ImportRow" r ON r."jobId"=j.id
   WHERE j.id=NEW."importJobId" AND j.status='committing' AND f.status='deleted' AND j."formVersionId"=NEW."formVersionId" AND j."tenantId"=NEW."tenantId"
   AND j."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') AND r."rowNo"=NEW."importRowNo" AND r.status='valid' AND r."submissionId" IS NULL)
 THEN RAISE EXCEPTION 'import must be validated and original erased' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_submission_guard BEFORE INSERT OR UPDATE ON "Submission" FOR EACH ROW EXECUTE FUNCTION guard_import_submission();
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_state_check" CHECK (
 "rowNo">=2 AND "lineNo">=2 AND status IN ('valid','error','duplicate','imported') AND
 ("duplicateOf" IS NULL OR "duplicateOf"<"rowNo") AND (status<>'duplicate' OR "duplicateOf" IS NOT NULL) AND
 (status<>'imported' OR ("submissionId" IS NOT NULL AND "payloadCipher" IS NULL AND digest IS NULL)) AND jsonb_typeof(errors)='array');
CREATE FUNCTION guard_import_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job "ImportJob"; target TEXT; cleared BOOLEAN:=false;
BEGIN
 IF TG_OP='DELETE' THEN
   SELECT * INTO job FROM "ImportJob" WHERE id=OLD."jobId";
   IF job."startedAt" IS NOT NULL THEN RAISE EXCEPTION 'committed row immutable' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 SELECT * INTO job FROM "ImportJob" WHERE id=NEW."jobId";
 IF TG_OP='INSERT' AND (job.status NOT IN ('draft','validated') OR NEW.status NOT IN ('valid','error','duplicate') OR NEW."submissionId" IS NOT NULL)
 THEN RAISE EXCEPTION 'invalid staging row' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW."tenantId",NEW."jobId",NEW."rowNo",NEW."lineNo",NEW."duplicateOf") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."jobId",OLD."rowNo",OLD."lineNo",OLD."duplicateOf") OR
     (NEW."payloadCipher" IS NOT NULL AND NEW."payloadCipher" IS DISTINCT FROM OLD."payloadCipher") OR (NEW.digest IS NOT NULL AND NEW.digest IS DISTINCT FROM OLD.digest) OR
     (OLD."submissionId" IS NOT NULL AND NEW."submissionId" IS DISTINCT FROM OLD."submissionId")
   THEN RAISE EXCEPTION 'immutable staging binding' USING ERRCODE='23514'; END IF;
   cleared:= NEW."payloadCipher" IS NULL AND NEW.digest IS NULL AND NEW.status=OLD.status AND NEW.errors=OLD.errors AND NEW."submissionId" IS NOT DISTINCT FROM OLD."submissionId";
   IF NOT cleared AND (job.status<>'committing' OR (NEW.status<>OLD.status AND NOT (OLD.status='valid' AND NEW.status IN ('imported','error'))))
   THEN RAISE EXCEPTION 'invalid row transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."submissionId" IS NOT NULL AND NOT cleared THEN
   SELECT status INTO target FROM "Submission" WHERE id=NEW."submissionId" AND "tenantId"=NEW."tenantId" AND "importJobId"=NEW."jobId"
     AND "importRowNo"=COALESCE(NEW."duplicateOf",NEW."rowNo") FOR SHARE;
   IF target IS NULL OR target IN ('destroying','destroyed') THEN RAISE EXCEPTION 'invalid row subject' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_row_guard BEFORE INSERT OR UPDATE OR DELETE ON "ImportRow" FOR EACH ROW EXECUTE FUNCTION guard_import_row();
CREATE FUNCTION guard_import_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Submission" WHERE id=NEW."submissionId" AND "tenantId"=NEW."tenantId" AND "importJobId"=NEW."jobId")
 THEN RAISE EXCEPTION 'invalid import evidence' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER import_evidence_binding BEFORE INSERT ON "ImportEvidence" FOR EACH ROW EXECUTE FUNCTION guard_import_evidence();
CREATE TRIGGER import_evidence_immutable BEFORE UPDATE OR DELETE ON "ImportEvidence" FOR EACH ROW EXECUTE FUNCTION protect_submission_evidence();
CREATE TRIGGER subject_write_barrier BEFORE INSERT ON "ImportEvidence" FOR EACH ROW EXECUTE FUNCTION prevent_erased_subject_write();
UPDATE "ServiceGrant" g SET capabilities=ARRAY(SELECT DISTINCT c FROM unnest(g.capabilities||ARRAY['import.read','import.write']) c)
FROM "Membership" m WHERE m.id=g."memberId" AND (
 (m.role='editor' AND g.capabilities @> ARRAY['service.read','form.read','form.write','form.publish','document.read','document.write','file.write']) OR
 (m.role='privacy' AND g.capabilities @> ARRAY['service.read','form.read','submission.read','submission.write','submission.destroy','file.read','audit.read']));
CREATE OR REPLACE FUNCTION validate_destruction_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Submission" s JOIN "DestructionRequest" d ON d."submissionId"=s.id
   WHERE s.id=NEW."submissionId" AND s."tenantId"=NEW."tenantId" AND s.status='destroying' AND NOT s."legalHold" AND d.id=NEW."requestId" AND d.status='running')
   OR EXISTS (SELECT 1 FROM "Answer" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "SubmissionNote" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "Correction" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ConsentReceipt" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportEvidence" WHERE "submissionId"=NEW."submissionId")
   OR EXISTS (SELECT 1 FROM "ImportRow" WHERE "submissionId"=NEW."submissionId" AND ("payloadCipher" IS NOT NULL OR digest IS NOT NULL))
   OR EXISTS (SELECT 1 FROM "FileObject" WHERE "submissionId"=NEW."submissionId" AND status<>'deleted')
 THEN RAISE EXCEPTION 'certificate requires completed erasure' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.counts)<>'object' OR EXISTS (SELECT 1 FROM jsonb_each(NEW.counts) e
   WHERE e.key NOT IN ('answers','notes','correctionPayloads','corrections','consentEvents','receipts','files','importEvidence','importRows')
   OR e.value::text !~ '^[0-9]+$')
 THEN RAISE EXCEPTION 'certificate contains invalid counts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

COMMIT;
