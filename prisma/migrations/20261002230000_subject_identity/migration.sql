-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "subjectRole" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "subjectId" TEXT;

-- CreateTable
CREATE TABLE "DataSubject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "nameHash" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "contactCipher" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataSubject_nameHash_emailHash_idx" ON "DataSubject"("nameHash", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "DataSubject_tenantId_id_key" ON "DataSubject"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DataSubject_tenantId_serviceId_identityHash_key" ON "DataSubject"("tenantId", "serviceId", "identityHash");

-- CreateIndex
CREATE INDEX "Submission_tenantId_subjectId_idx" ON "Submission"("tenantId", "subjectId");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_tenantId_subjectId_fkey" FOREIGN KEY ("tenantId", "subjectId") REFERENCES "DataSubject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubject" ADD CONSTRAINT "DataSubject_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Question" ADD CONSTRAINT "Question_subject_role_check" CHECK (
  "subjectRole" IS NULL OR ("subjectRole" IN ('name','email') AND type='단문형 답변' AND required));
CREATE UNIQUE INDEX "Question_subject_role_unique" ON "Question"("formVersionId","subjectRole") WHERE "subjectRole" IS NOT NULL;
ALTER TABLE "DataSubject" ADD CONSTRAINT "DataSubject_hash_check" CHECK (
  "identityHash" ~ '^[a-f0-9]{64}$' AND "nameHash" ~ '^[a-f0-9]{64}$' AND "emailHash" ~ '^[a-f0-9]{64}$' AND "contactCipher" LIKE 'v1.%');
CREATE FUNCTION guard_subject_questions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='published' AND (SELECT count(*) FROM "Question" WHERE "formVersionId"=NEW.id AND "subjectRole" IS NOT NULL)=1 THEN
    RAISE EXCEPTION 'both subject name and email are required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subject_question_publish_guard BEFORE UPDATE ON "FormVersion" FOR EACH ROW EXECUTE FUNCTION guard_subject_questions();
CREATE FUNCTION guard_submission_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."subjectId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "DataSubject" s JOIN "FormVersion" v ON v.id=NEW."formVersionId" JOIN "Form" f ON f.id=v."formId"
      WHERE s.id=NEW."subjectId" AND s."tenantId"=NEW."tenantId" AND s."serviceId"=f."serviceId") THEN
    RAISE EXCEPTION 'subject must belong to the submission service' USING ERRCODE='23514';
  END IF;
  IF NEW.status='destroyed' AND NEW."subjectId" IS NOT NULL THEN
    RAISE EXCEPTION 'destroyed submissions cannot retain identity bindings' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_subject_guard BEFORE INSERT OR UPDATE ON "Submission" FOR EACH ROW EXECUTE FUNCTION guard_submission_subject();
CREATE FUNCTION protect_subject_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'subject identities are immutable; rebind the submission' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subject_identity_immutable BEFORE UPDATE ON "DataSubject" FOR EACH ROW EXECUTE FUNCTION protect_subject_identity();
