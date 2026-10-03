BEGIN;

-- A submission may have one identity proof and one signature proof.
-- Each attempt still produces only one receipt; the same kind cannot be reused.
DROP INDEX "VerificationReceipt_submissionId_key";
CREATE UNIQUE INDEX "VerificationReceipt_tenantId_submissionId_kind_key"
  ON "VerificationReceipt"("tenantId", "submissionId", "kind");

COMMIT;
