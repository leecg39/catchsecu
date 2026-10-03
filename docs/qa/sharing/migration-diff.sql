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
CREATE TABLE "ShareGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "emailCipher" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareField" (
    "tenantId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,

    CONSTRAINT "ShareField_pkey" PRIMARY KEY ("grantId","questionId")
);

-- CreateTable
CREATE TABLE "ViewerChallenge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "grantVersion" INTEGER NOT NULL,
    "clientHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewerChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewerSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "grantVersion" INTEGER NOT NULL,
    "challengeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareGrant_codeHash_key" ON "ShareGrant"("codeHash");

-- CreateIndex
CREATE INDEX "ShareGrant_tenantId_formId_createdAt_id_idx" ON "ShareGrant"("tenantId", "formId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ShareGrant_expiresAt_idx" ON "ShareGrant"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShareGrant_tenantId_id_key" ON "ShareGrant"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ShareGrant_tenantId_id_formVersionId_key" ON "ShareGrant"("tenantId", "id", "formVersionId");

-- CreateIndex
CREATE INDEX "ViewerChallenge_grantId_createdAt_idx" ON "ViewerChallenge"("grantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerChallenge_tenantId_grantId_id_key" ON "ViewerChallenge"("tenantId", "grantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerSession_challengeId_key" ON "ViewerSession"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerSession_tokenHash_key" ON "ViewerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ViewerSession_grantId_expiresAt_idx" ON "ViewerSession"("grantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerSession_tenantId_grantId_challengeId_key" ON "ViewerSession"("tenantId", "grantId", "challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "Form_tenantId_serviceId_id_key" ON "Form"("tenantId", "serviceId", "id");

-- AddForeignKey
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareGrant" ADD CONSTRAINT "ShareGrant_tenantId_serviceId_formId_fkey" FOREIGN KEY ("tenantId", "serviceId", "formId") REFERENCES "Form"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareGrant" ADD CONSTRAINT "ShareGrant_tenantId_formId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formId", "formVersionId") REFERENCES "FormVersion"("tenantId", "formId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareGrant" ADD CONSTRAINT "ShareGrant_tenantId_createdBy_fkey" FOREIGN KEY ("tenantId", "createdBy") REFERENCES "Membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareField" ADD CONSTRAINT "ShareField_tenantId_grantId_formVersionId_fkey" FOREIGN KEY ("tenantId", "grantId", "formVersionId") REFERENCES "ShareGrant"("tenantId", "id", "formVersionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareField" ADD CONSTRAINT "ShareField_tenantId_formVersionId_questionId_fkey" FOREIGN KEY ("tenantId", "formVersionId", "questionId") REFERENCES "Question"("tenantId", "formVersionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewerChallenge" ADD CONSTRAINT "ViewerChallenge_tenantId_grantId_fkey" FOREIGN KEY ("tenantId", "grantId") REFERENCES "ShareGrant"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewerSession" ADD CONSTRAINT "ViewerSession_tenantId_grantId_fkey" FOREIGN KEY ("tenantId", "grantId") REFERENCES "ShareGrant"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewerSession" ADD CONSTRAINT "ViewerSession_tenantId_grantId_challengeId_fkey" FOREIGN KEY ("tenantId", "grantId", "challengeId") REFERENCES "ViewerChallenge"("tenantId", "grantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

