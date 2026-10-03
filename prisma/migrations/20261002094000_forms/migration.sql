-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "RateLimit" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "TwoFactor" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Verification" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedVersionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "body" TEXT NOT NULL DEFAULT '',
    "verify" BOOLEAN NOT NULL DEFAULT false,
    "font" TEXT NOT NULL DEFAULT '14px',
    "bold" BOOLEAN NOT NULL DEFAULT false,
    "consentRequired" BOOLEAN NOT NULL DEFAULT true,
    "consentPurpose" TEXT NOT NULL DEFAULT '',
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "maxResponses" INTEGER NOT NULL DEFAULT 100,
    "showSubmitNotice" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormFavorite" (
    "tenantId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,

    CONSTRAINT "FormFavorite_pkey" PRIMARY KEY ("tenantId","memberId","formId")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "maxResponses" INTEGER NOT NULL,
    "responseCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedUrl" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "version" INTEGER NOT NULL DEFAULT 1,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueCipher" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedFields" TEXT[],
    "beforeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Form_tenantId_serviceId_status_createdAt_id_idx" ON "Form"("tenantId", "serviceId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Form_tenantId_id_key" ON "Form"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FormVersion_tenantId_id_key" ON "FormVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FormVersion_tenantId_formId_id_key" ON "FormVersion"("tenantId", "formId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FormVersion_formId_number_key" ON "FormVersion"("formId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Question_tenantId_formVersionId_id_key" ON "Question"("tenantId", "formVersionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Question_tenantId_formVersionId_stableKey_key" ON "Question"("tenantId", "formVersionId", "stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionId_value_key" ON "QuestionOption"("questionId", "value");

-- CreateIndex
CREATE INDEX "FormTemplate_tenantId_status_idx" ON "FormTemplate"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_tokenHash_key" ON "Publication"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_tenantId_id_key" ON "Publication"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_tenantId_id_formVersionId_key" ON "Publication"("tenantId", "id", "formVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "FixedUrl_slug_key" ON "FixedUrl"("slug");

-- CreateIndex
CREATE INDEX "FixedUrl_tenantId_status_idx" ON "FixedUrl"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Submission_tenantId_formVersionId_submittedAt_id_idx" ON "Submission"("tenantId", "formVersionId", "submittedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_tenantId_id_key" ON "Submission"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_tenantId_id_formVersionId_key" ON "Submission"("tenantId", "id", "formVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_submissionId_questionId_key" ON "Answer"("submissionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentReceipt_tenantId_id_key" ON "ConsentReceipt"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_tenantId_ownerId_fkey" FOREIGN KEY ("tenantId", "ownerId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_tenantId_id_publishedVersionId_fkey" FOREIGN KEY ("tenantId", "id", "publishedVersionId") REFERENCES "FormVersion"("tenantId", "formId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_tenantId_formId_fkey" FOREIGN KEY ("tenantId", "formId") REFERENCES "Form"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_tenantId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formVersionId") REFERENCES "FormVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFavorite" ADD CONSTRAINT "FormFavorite_tenantId_memberId_fkey" FOREIGN KEY ("tenantId", "memberId") REFERENCES "Membership"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFavorite" ADD CONSTRAINT "FormFavorite_tenantId_formId_fkey" FOREIGN KEY ("tenantId", "formId") REFERENCES "Form"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_tenantId_formId_fkey" FOREIGN KEY ("tenantId", "formId") REFERENCES "Form"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_tenantId_formId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formId", "formVersionId") REFERENCES "FormVersion"("tenantId", "formId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedUrl" ADD CONSTRAINT "FixedUrl_tenantId_publicationId_fkey" FOREIGN KEY ("tenantId", "publicationId") REFERENCES "Publication"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_tenantId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formVersionId") REFERENCES "FormVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_tenantId_publicationId_formVersionId_fkey" FOREIGN KEY ("tenantId", "publicationId", "formVersionId") REFERENCES "Publication"("tenantId", "id", "formVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_tenantId_submissionId_formVersionId_fkey" FOREIGN KEY ("tenantId", "submissionId", "formVersionId") REFERENCES "Submission"("tenantId", "id", "formVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_tenantId_formVersionId_questionId_fkey" FOREIGN KEY ("tenantId", "formVersionId", "questionId") REFERENCES "Question"("tenantId", "formVersionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentReceipt" ADD CONSTRAINT "ConsentReceipt_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_tenantId_receiptId_fkey" FOREIGN KEY ("tenantId", "receiptId") REFERENCES "ConsentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FormVersion_one_draft" ON "FormVersion" ("tenantId", "formId") WHERE status = 'draft';
ALTER TABLE "Form" ADD CONSTRAINT "Form_status_check" CHECK (status IN ('draft', 'pendingApproval', 'published', 'paused', 'archived'));
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_status_check" CHECK (status IN ('draft', 'published'));
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_ranges" CHECK (number > 0 AND "retentionDays" BETWEEN 1 AND 36500 AND "maxResponses" BETWEEN 1 AND 1000000);
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_limits" CHECK ("responseCount" >= 0 AND "responseCount" <= "maxResponses");
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_status_check" CHECK (status IN ('active', 'revoked', 'expired'));
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_status_check" CHECK (status IN ('submitted', 'corrected', 'withdrawn', 'pendingDestruction', 'destroyed'));

CREATE FUNCTION protect_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Published form versions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER published_version_immutable BEFORE UPDATE OR DELETE ON "FormVersion" FOR EACH ROW EXECUTE FUNCTION protect_published_version();

CREATE FUNCTION protect_published_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "FormVersion" WHERE id = OLD."formVersionId" AND status = 'published') THEN
    RAISE EXCEPTION 'Published questions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM "FormVersion" WHERE id = NEW."formVersionId" AND status = 'published') THEN
    RAISE EXCEPTION 'Published questions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER published_question_immutable BEFORE INSERT OR UPDATE OR DELETE ON "Question" FOR EACH ROW EXECUTE FUNCTION protect_published_question();

CREATE FUNCTION protect_published_option() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE question_id TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM "Question" q JOIN "FormVersion" v ON v.id=q."formVersionId" WHERE q.id=OLD."questionId" AND v.status='published') THEN
      RAISE EXCEPTION 'Published options are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "Question" q JOIN "FormVersion" v ON v.id=q."formVersionId" WHERE q.id=NEW."questionId" AND v.status='published') THEN
      RAISE EXCEPTION 'Published options are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER published_option_immutable BEFORE INSERT OR UPDATE OR DELETE ON "QuestionOption" FOR EACH ROW EXECUTE FUNCTION protect_published_option();
CREATE TRIGGER consent_event_immutable BEFORE UPDATE OR DELETE ON "ConsentEvent" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER consent_receipt_immutable BEFORE UPDATE OR DELETE ON "ConsentReceipt" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER correction_immutable BEFORE UPDATE OR DELETE ON "Correction" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
