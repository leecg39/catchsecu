-- DropForeignKey
ALTER TABLE "PurposeRevision" DROP CONSTRAINT "PurposeRevision_actor_fkey";

-- DropForeignKey
ALTER TABLE "RecipientRevision" DROP CONSTRAINT "RecipientRevision_actor_fkey";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "subjectRole" TEXT;

-- AlterTable
ALTER TABLE "RateLimit" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "TwoFactor" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Verification" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

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
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_tenantId_subjectId_fkey" FOREIGN KEY ("tenantId", "subjectId") REFERENCES "DataSubject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubject" ADD CONSTRAINT "DataSubject_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

