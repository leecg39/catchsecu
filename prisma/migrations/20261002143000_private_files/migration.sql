BEGIN;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "FileObject") THEN RAISE EXCEPTION 'Legacy files need an explicit encryption and service binding migration'; END IF; END $$;

-- AlterTable
ALTER TABLE "FileObject" DROP COLUMN "originalName",
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "formVersionId" TEXT,
ADD COLUMN     "nameCipher" TEXT,
ADD COLUMN     "ownerKind" TEXT NOT NULL,
ADD COLUMN     "publicationId" TEXT,
ADD COLUMN     "questionId" TEXT,
ADD COLUMN     "scanEngine" TEXT,
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "serviceId" TEXT NOT NULL,
ADD COLUMN     "submissionId" TEXT,
ADD COLUMN     "uploadTokenHash" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "ownerId" DROP NOT NULL,
ALTER COLUMN "sha256" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'pending';

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_uploadTokenHash_key" ON "FileObject"("uploadTokenHash");

-- CreateIndex
CREATE INDEX "FileObject_tenantId_serviceId_status_idx" ON "FileObject"("tenantId", "serviceId", "status");

-- CreateIndex
CREATE INDEX "FileObject_tenantId_submissionId_questionId_idx" ON "FileObject"("tenantId", "submissionId", "questionId");

-- CreateIndex
CREATE INDEX "FileObject_status_expiresAt_idx" ON "FileObject"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_publicationId_formVersionId_fkey" FOREIGN KEY ("tenantId", "publicationId", "formVersionId") REFERENCES "Publication"("tenantId", "id", "formVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_formVersionId_questionId_fkey" FOREIGN KEY ("tenantId", "formVersionId", "questionId") REFERENCES "Question"("tenantId", "formVersionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_submissionId_formVersionId_fkey" FOREIGN KEY ("tenantId", "submissionId", "formVersionId") REFERENCES "Submission"("tenantId", "id", "formVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "FileObject"
  ADD CONSTRAINT "FileObject_status_check" CHECK (status IN ('pending','uploaded','ready','attached','rejected','deleting','deleted')),
  ADD CONSTRAINT "FileObject_scan_check" CHECK ("scanStatus" IN ('pending','clean','infected','error')),
  ADD CONSTRAINT "FileObject_clean_check" CHECK (status NOT IN ('ready','attached') OR ("scanStatus"='clean' AND "scannedAt" IS NOT NULL AND "scanEngine" IS NOT NULL)),
  ADD CONSTRAINT "FileObject_metadata_check" CHECK ((status='deleted' AND size=0 AND "nameCipher" IS NULL AND sha256 IS NULL) OR (status<>'deleted' AND size BETWEEN 1 AND 10485760 AND "nameCipher" IS NOT NULL AND sha256 IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$')),
  ADD CONSTRAINT "FileObject_version_check" CHECK (version>0),
  ADD CONSTRAINT "FileObject_mime_check" CHECK (mime IN ('application/pdf','image/png','image/jpeg','text/plain','text/csv')),
  ADD CONSTRAINT "FileObject_question_binding_check" CHECK (("publicationId" IS NULL AND "formVersionId" IS NULL AND "questionId" IS NULL AND "submissionId" IS NULL) OR ("publicationId" IS NOT NULL AND "formVersionId" IS NOT NULL AND "questionId" IS NOT NULL)),
  ADD CONSTRAINT "FileObject_owner_check" CHECK (("ownerKind"='member' AND "ownerId" IS NOT NULL AND "uploadTokenHash" IS NULL) OR ("ownerKind"='public' AND "ownerId" IS NULL AND "publicationId" IS NOT NULL AND ((status IN ('pending','uploaded','ready','rejected') AND "uploadTokenHash" IS NOT NULL) OR (status IN ('attached','deleting','deleted') AND "uploadTokenHash" IS NULL)))),
  ADD CONSTRAINT "FileObject_expiry_check" CHECK (status NOT IN ('pending','uploaded','ready','rejected') OR "expiresAt" IS NOT NULL),
  ADD CONSTRAINT "FileObject_attached_check" CHECK (status<>'attached' OR ("submissionId" IS NOT NULL AND "expiresAt" IS NULL AND "uploadTokenHash" IS NULL));

CREATE FUNCTION check_file_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW."scanStatus"<>'pending' OR NEW.version<>1) THEN
    RAISE EXCEPTION 'files must start pending' USING ERRCODE='23514';
  END IF;
  IF NEW."questionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Question" q JOIN "FormVersion" v ON v.id=q."formVersionId"
    JOIN "Form" f ON f.id=v."formId"
    JOIN "Publication" p ON p.id=NEW."publicationId" AND p."formVersionId"=v.id AND p."tenantId"=f."tenantId"
    WHERE q.id=NEW."questionId" AND q.type='파일 업로드' AND q."formVersionId"=NEW."formVersionId"
      AND f."serviceId"=NEW."serviceId" AND f."tenantId"=NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'invalid file question or service' USING ERRCODE='23514';
  END IF;
  IF NEW."submissionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Submission" WHERE id=NEW."submissionId" AND "tenantId"=NEW."tenantId"
      AND "publicationId"=NEW."publicationId" AND "formVersionId"=NEW."formVersionId"
  ) THEN
    RAISE EXCEPTION 'invalid file submission' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status='deleted' OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'invalid file revision' USING ERRCODE='23514';
    END IF;
    IF (NEW."tenantId",NEW."serviceId",NEW."ownerKind",NEW."ownerId",NEW."storageKey",NEW.mime,NEW."publicationId",NEW."formVersionId",NEW."questionId")
      IS DISTINCT FROM (OLD."tenantId",OLD."serviceId",OLD."ownerKind",OLD."ownerId",OLD."storageKey",OLD.mime,OLD."publicationId",OLD."formVersionId",OLD."questionId") THEN
      RAISE EXCEPTION 'immutable file binding' USING ERRCODE='23514';
    END IF;
    IF NEW."submissionId" IS DISTINCT FROM OLD."submissionId" AND NOT
      (OLD."submissionId" IS NULL AND NEW."submissionId" IS NOT NULL AND OLD.status='ready' AND NEW.status='attached') THEN
      RAISE EXCEPTION 'immutable file submission' USING ERRCODE='23514';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='pending' AND NEW.status IN ('uploaded','deleting')) OR
      (OLD.status='uploaded' AND NEW.status IN ('ready','rejected','deleting')) OR
      (OLD.status='ready' AND NEW.status IN ('attached','deleting')) OR
      (OLD.status IN ('attached','rejected') AND NEW.status='deleting') OR
      (OLD.status='deleting' AND NEW.status='deleted')
    ) THEN RAISE EXCEPTION 'invalid file transition' USING ERRCODE='23514'; END IF;
    IF NEW.status<>'deleted' AND (NEW.size,NEW.sha256) IS DISTINCT FROM (OLD.size,OLD.sha256) THEN
      RAISE EXCEPTION 'immutable file bytes' USING ERRCODE='23514';
    END IF;
    IF NEW."nameCipher" IS DISTINCT FROM OLD."nameCipher" AND NOT
      (NEW.status='deleted' OR (OLD.status='ready' AND NEW.status='ready' AND OLD."ownerKind"='member' AND OLD."submissionId" IS NULL)) THEN
      RAISE EXCEPTION 'immutable attachment filename' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FileObject_guard" BEFORE INSERT OR UPDATE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION check_file_object();
COMMIT;
