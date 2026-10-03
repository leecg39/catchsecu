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
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "refusalNotice" TEXT NOT NULL DEFAULT '',
    "rightsContact" TEXT NOT NULL DEFAULT '',
    "effectiveDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "draftRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPurpose" (
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "purposeId" TEXT NOT NULL,

    CONSTRAINT "DocumentPurpose_pkey" PRIMARY KEY ("tenantId","documentId","purposeId")
);

-- CreateTable
CREATE TABLE "DocumentRecipient" (
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,

    CONSTRAINT "DocumentRecipient_pkey" PRIMARY KEY ("tenantId","documentId","recipientId")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "renderedText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPublication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClauseTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClauseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceConsentDisplay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nameMode" TEXT NOT NULL,
    "startText" TEXT NOT NULL DEFAULT '',
    "processorText" TEXT NOT NULL DEFAULT '',
    "policyText" TEXT NOT NULL DEFAULT '',
    "requiredText" TEXT NOT NULL DEFAULT '',
    "optionalText" TEXT NOT NULL DEFAULT '',
    "policyMode" TEXT NOT NULL DEFAULT 'none',
    "externalUrl" TEXT NOT NULL DEFAULT '',
    "publicationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceConsentDisplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_tenantId_serviceId_status_createdAt_id_idx" ON "Document"("tenantId", "serviceId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Document_tenantId_serviceId_id_key" ON "Document"("tenantId", "serviceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_tenantId_serviceId_documentId_id_key" ON "DocumentVersion"("tenantId", "serviceId", "documentId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_number_key" ON "DocumentVersion"("documentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPublication_tokenHash_key" ON "DocumentPublication"("tokenHash");

-- CreateIndex
CREATE INDEX "DocumentPublication_tenantId_documentId_status_idx" ON "DocumentPublication"("tenantId", "documentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPublication_tenantId_serviceId_id_key" ON "DocumentPublication"("tenantId", "serviceId", "id");

-- CreateIndex
CREATE INDEX "ClauseTemplate_tenantId_serviceId_status_createdAt_id_idx" ON "ClauseTemplate"("tenantId", "serviceId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceConsentDisplay_tenantId_serviceId_kind_key" ON "ServiceConsentDisplay"("tenantId", "serviceId", "kind");

-- AddForeignKey
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_createdBy_fkey" FOREIGN KEY ("tenantId", "createdBy") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPurpose" ADD CONSTRAINT "DocumentPurpose_tenantId_serviceId_documentId_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId") REFERENCES "Document"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPurpose" ADD CONSTRAINT "DocumentPurpose_tenantId_serviceId_purposeId_fkey" FOREIGN KEY ("tenantId", "serviceId", "purposeId") REFERENCES "ProcessingPurpose"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecipient" ADD CONSTRAINT "DocumentRecipient_tenantId_serviceId_documentId_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId") REFERENCES "Document"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecipient" ADD CONSTRAINT "DocumentRecipient_tenantId_serviceId_recipientId_fkey" FOREIGN KEY ("tenantId", "serviceId", "recipientId") REFERENCES "Recipient"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_tenantId_serviceId_documentId_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId") REFERENCES "Document"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPublication" ADD CONSTRAINT "DocumentPublication_tenantId_serviceId_documentId_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId") REFERENCES "Document"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPublication" ADD CONSTRAINT "DocumentPublication_tenantId_serviceId_documentId_document_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId", "documentVersionId") REFERENCES "DocumentVersion"("tenantId", "serviceId", "documentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClauseTemplate" ADD CONSTRAINT "ClauseTemplate_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceConsentDisplay" ADD CONSTRAINT "ServiceConsentDisplay_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceConsentDisplay" ADD CONSTRAINT "ServiceConsentDisplay_tenantId_serviceId_publicationId_fkey" FOREIGN KEY ("tenantId", "serviceId", "publicationId") REFERENCES "DocumentPublication"("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

