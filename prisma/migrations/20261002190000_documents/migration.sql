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

ALTER TABLE "Document" ADD CONSTRAINT "Document_fields_check" CHECK (
  type IN ('consent','privacy_policy','overseas_transfer') AND status IN ('draft','published','private','archived')
  AND version > 0 AND "draftRevision" > 0 AND length(btrim(title)) BETWEEN 1 AND 200
  AND length(body) <= 20000 AND length("refusalNotice") <= 3000 AND length("rightsContact") <= 2000
  AND "effectiveDate" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_fields_check" CHECK (
  number > 0 AND "draftRevision" > 0 AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(snapshot)='object' AND snapshot->>'schemaVersion'='1'
  AND length("renderedText") > 0);
ALTER TABLE "DocumentPublication" ADD CONSTRAINT "DocumentPublication_fields_check" CHECK (
  "tokenHash" ~ '^[a-f0-9]{64}$' AND "tokenCipher" LIKE 'v1.%'
  AND ((status='active' AND "revokedAt" IS NULL) OR (status='revoked' AND "revokedAt" IS NOT NULL))
  AND ("expiresAt" IS NULL OR "expiresAt">"createdAt"));
ALTER TABLE "ClauseTemplate" ADD CONSTRAINT "ClauseTemplate_fields_check" CHECK (
  type IN ('consent','privacy_policy','overseas_transfer') AND status IN ('active','archived')
  AND version>0 AND length(btrim(title)) BETWEEN 1 AND 200 AND length(btrim(body)) BETWEEN 1 AND 20000);
ALTER TABLE "ServiceConsentDisplay" ADD CONSTRAINT "ServiceConsentDisplay_fields_check" CHECK (
  kind IN ('collection','third_party') AND "nameMode" IN ('service_company','company_service','service','company') AND version>0
  AND length("startText")<=200 AND length("processorText")<=200 AND length("policyText")<=200 AND length("requiredText")<=200 AND length("optionalText")<=200
  AND (("policyMode"='none' AND "externalUrl"='' AND "publicationId" IS NULL)
    OR ("policyMode"='external' AND "externalUrl" ~ '^https://' AND length("externalUrl")<=2000 AND "publicationId" IS NULL)
    OR ("policyMode"='document' AND "externalUrl"='' AND "publicationId" IS NOT NULL)));

CREATE FUNCTION document_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published document versions cannot be changed or deleted'; END $$;
CREATE TRIGGER "DocumentVersion_immutable" BEFORE UPDATE OR DELETE ON "DocumentVersion" FOR EACH ROW EXECUTE FUNCTION document_version_immutable();

CREATE FUNCTION document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Documents are archived, not deleted'; END IF;
  IF (NEW.id,NEW."tenantId",NEW."serviceId",NEW."createdBy",NEW.type,NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."tenantId",OLD."serviceId",OLD."createdBy",OLD.type,OLD."createdAt")
     OR NEW.version<>OLD.version+1 OR NEW."draftRevision" NOT IN (OLD."draftRevision",OLD."draftRevision"+1)
     THEN RAISE EXCEPTION 'Invalid document revision'; END IF;
  IF (NEW.title,NEW.body,NEW."refusalNotice",NEW."rightsContact",NEW."effectiveDate") IS DISTINCT FROM
     (OLD.title,OLD.body,OLD."refusalNotice",OLD."rightsContact",OLD."effectiveDate") AND NEW."draftRevision"<>OLD."draftRevision"+1
     THEN RAISE EXCEPTION 'Content changes require a new draft revision'; END IF;
  IF OLD.status='archived' AND (NEW.status<>'draft' OR NEW."draftRevision"<>OLD."draftRevision")
     THEN RAISE EXCEPTION 'Archived documents can only be restored as drafts'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Document_guard" BEFORE UPDATE OR DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION document_guard();

CREATE FUNCTION document_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document publication history cannot be deleted'; END IF;
  IF (to_jsonb(NEW)-'status'-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'revokedAt')
     OR OLD.status<>'active' OR NEW.status<>'revoked' THEN RAISE EXCEPTION 'Only active document links may be revoked'; END IF;
  IF EXISTS(SELECT 1 FROM "ServiceConsentDisplay" WHERE "publicationId"=OLD.id)
     THEN RAISE EXCEPTION 'Disconnect the service display before revocation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DocumentPublication_guard" BEFORE UPDATE OR DELETE ON "DocumentPublication" FOR EACH ROW EXECUTE FUNCTION document_publication_guard();

CREATE FUNCTION document_setting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ((NEW.id,NEW."tenantId",NEW."serviceId",NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."tenantId",OLD."serviceId",OLD."createdAt") OR NEW.version<>OLD.version+1)
     THEN RAISE EXCEPTION 'Invalid settings version'; END IF;
  IF TG_TABLE_NAME='ServiceConsentDisplay' THEN
    IF TG_OP='UPDATE' AND NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'Display kind is immutable'; END IF;
    IF NEW."publicationId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "DocumentPublication" p JOIN "Document" d ON d.id=p."documentId"
      WHERE p.id=NEW."publicationId" AND p."tenantId"=NEW."tenantId" AND p."serviceId"=NEW."serviceId"
        AND d.type='privacy_policy' AND d.status='published' AND p.status='active'
        AND (p."expiresAt" IS NULL OR p."expiresAt">CURRENT_TIMESTAMP))
      THEN RAISE EXCEPTION 'Display must reference an active privacy policy'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClauseTemplate_guard" BEFORE UPDATE ON "ClauseTemplate" FOR EACH ROW EXECUTE FUNCTION document_setting_guard();
CREATE TRIGGER "ServiceConsentDisplay_guard" BEFORE INSERT OR UPDATE ON "ServiceConsentDisplay" FOR EACH ROW EXECUTE FUNCTION document_setting_guard();
