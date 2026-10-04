-- CreateIndex
CREATE INDEX "Submission_tenantId_submittedAt_idx" ON "Submission"("tenantId", "submittedAt");
