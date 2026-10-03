-- DropForeignKey
ALTER TABLE "PurposeRevision" DROP CONSTRAINT "PurposeRevision_actor_fkey";

-- DropForeignKey
ALTER TABLE "RecipientRevision" DROP CONSTRAINT "RecipientRevision_actor_fkey";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "ConsentReceipt" ADD COLUMN     "evidenceCipher" TEXT,
ADD COLUMN     "evidenceVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pdfCipher" TEXT,
ADD COLUMN     "pdfHash" TEXT;

-- AlterTable
ALTER TABLE "FormVersion" ADD COLUMN     "consentDisplay" JSONB,
ADD COLUMN     "receiptEvidenceVersion" INTEGER NOT NULL DEFAULT 0;

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
CREATE TABLE "FormDocumentBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "kind" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "displaySnapshot" JSONB NOT NULL,

    CONSTRAINT "FormDocumentBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormDocumentBinding_tenantId_serviceId_documentVersionId_idx" ON "FormDocumentBinding"("tenantId", "serviceId", "documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "FormDocumentBinding_formVersionId_documentId_key" ON "FormDocumentBinding"("formVersionId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "FormDocumentBinding_formVersionId_order_key" ON "FormDocumentBinding"("formVersionId", "order");

-- AddForeignKey
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_actor_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDocumentBinding" ADD CONSTRAINT "FormDocumentBinding_tenantId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formVersionId") REFERENCES "FormVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDocumentBinding" ADD CONSTRAINT "FormDocumentBinding_tenantId_serviceId_documentId_document_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId", "documentVersionId") REFERENCES "DocumentVersion"("tenantId", "serviceId", "documentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

