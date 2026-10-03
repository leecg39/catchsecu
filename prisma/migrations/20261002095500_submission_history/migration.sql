-- CreateTable
CREATE TABLE "CorrectionPayload" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "correctionId" TEXT NOT NULL,
    "beforeCipher" TEXT NOT NULL,
    "afterCipher" TEXT NOT NULL,

    CONSTRAINT "CorrectionPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "textCipher" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionPayload_correctionId_key" ON "CorrectionPayload"("correctionId");

-- CreateIndex
CREATE INDEX "CorrectionPayload_tenantId_idx" ON "CorrectionPayload"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionPayload_tenantId_correctionId_key" ON "CorrectionPayload"("tenantId", "correctionId");

-- CreateIndex
CREATE INDEX "SubmissionNote_tenantId_submissionId_createdAt_id_idx" ON "SubmissionNote"("tenantId", "submissionId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionNote_tenantId_id_key" ON "SubmissionNote"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Correction_tenantId_id_key" ON "Correction"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CorrectionPayload" ADD CONSTRAINT "CorrectionPayload_tenantId_correctionId_fkey" FOREIGN KEY ("tenantId", "correctionId") REFERENCES "Correction"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionNote" ADD CONSTRAINT "SubmissionNote_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubmissionNote" ADD CONSTRAINT "SubmissionNote_version_check" CHECK (version > 0);
CREATE TRIGGER correction_payload_no_update BEFORE UPDATE ON "CorrectionPayload" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
