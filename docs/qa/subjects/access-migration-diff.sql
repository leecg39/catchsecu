-- DropForeignKey
ALTER TABLE "PurposeRevision" DROP CONSTRAINT "PurposeRevision_actor_fkey";

-- DropForeignKey
ALTER TABLE "RecipientRevision" DROP CONSTRAINT "RecipientRevision_actor_fkey";

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
CREATE TABLE "SubjectAccessRequest" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectAccessScope" (
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "SubjectAccessScope_pkey" PRIMARY KEY ("requestId","subjectId")
);

-- CreateTable
CREATE TABLE "SubjectSession" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectWithdrawal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "submissionVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SubjectWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "reason" TEXT NOT NULL,
    "sourceSubmissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubjectAccessRequest_tokenHash_key" ON "SubjectAccessRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "SubjectAccessRequest_expiresAt_idx" ON "SubjectAccessRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "SubjectAccessScope_tenantId_subjectId_idx" ON "SubjectAccessScope"("tenantId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectSession_requestId_key" ON "SubjectSession"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectSession_tokenHash_key" ON "SubjectSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SubjectSession_expiresAt_idx" ON "SubjectSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SubjectWithdrawal_sessionId_submissionId_idx" ON "SubjectWithdrawal"("sessionId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_tenantId_serviceId_emailHash_channel_key" ON "Suppression"("tenantId", "serviceId", "emailHash", "channel");

-- AddForeignKey
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAccessScope" ADD CONSTRAINT "SubjectAccessScope_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SubjectAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAccessScope" ADD CONSTRAINT "SubjectAccessScope_tenantId_subjectId_fkey" FOREIGN KEY ("tenantId", "subjectId") REFERENCES "DataSubject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectSession" ADD CONSTRAINT "SubjectSession_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SubjectAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectWithdrawal" ADD CONSTRAINT "SubjectWithdrawal_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectWithdrawal" ADD CONSTRAINT "SubjectWithdrawal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SubjectSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_tenantId_sourceSubmissionId_fkey" FOREIGN KEY ("tenantId", "sourceSubmissionId") REFERENCES "Submission"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

