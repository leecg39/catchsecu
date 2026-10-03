CREATE TABLE "JobAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobAttempt_jobId_createdAt_idx" ON "JobAttempt"("jobId", "createdAt");
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_outcome_check" CHECK ("outcome" IN ('leased','delivered','suppressed','retry','dead','expired','lease_exhausted'));
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_attempt_check" CHECK (attempt > 0);
