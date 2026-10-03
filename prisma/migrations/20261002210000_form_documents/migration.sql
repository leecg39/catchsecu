BEGIN;

-- AlterTable
ALTER TABLE "ConsentReceipt" ADD COLUMN     "evidenceCipher" TEXT,
ADD COLUMN     "evidenceVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pdfCipher" TEXT,
ADD COLUMN     "pdfHash" TEXT;

-- AlterTable
ALTER TABLE "FormVersion" ADD COLUMN     "consentDisplay" JSONB,
ADD COLUMN     "receiptEvidenceVersion" INTEGER NOT NULL DEFAULT 0;

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
ALTER TABLE "FormDocumentBinding" ADD CONSTRAINT "FormDocumentBinding_tenantId_formVersionId_fkey" FOREIGN KEY ("tenantId", "formVersionId") REFERENCES "FormVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDocumentBinding" ADD CONSTRAINT "FormDocumentBinding_tenantId_serviceId_documentId_document_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId", "documentVersionId") REFERENCES "DocumentVersion"("tenantId", "serviceId", "documentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_consent_evidence" CHECK (
  ("receiptEvidenceVersion"=0 AND "consentDisplay" IS NULL) OR
  ("receiptEvidenceVersion"=1 AND "consentDisplay" IS NOT NULL AND jsonb_typeof("consentDisplay")='object')
);
ALTER TABLE "ConsentReceipt" ADD CONSTRAINT "ConsentReceipt_evidence" CHECK (
  ("evidenceVersion"=0 AND "evidenceCipher" IS NULL AND "pdfCipher" IS NULL AND "pdfHash" IS NULL) OR
  ("evidenceVersion"=1 AND "evidenceCipher" IS NOT NULL AND "evidenceCipher" LIKE 'v1.%'
    AND "pdfCipher" IS NOT NULL AND "pdfCipher" LIKE 'v1.%' AND "pdfHash" IS NOT NULL AND "pdfHash" ~ '^[a-f0-9]{64}$'
    AND "documentHash" ~ '^[a-f0-9]{64}$')
);
ALTER TABLE "FormDocumentBinding" ADD CONSTRAINT "FormDocumentBinding_values" CHECK (
  kind IN ('collection','third_party') AND "order" BETWEEN 0 AND 9 AND jsonb_typeof("displaySnapshot")='object'
);
CREATE FUNCTION guard_form_document_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id TEXT; parent_status TEXT; parent_tenant TEXT; parent_service TEXT; evidence_version INTEGER;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'replace draft bindings instead of mutating evidence' USING ERRCODE='23514'; END IF;
  parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD."formVersionId" ELSE NEW."formVersionId" END;
  SELECT v.status, v."tenantId", f."serviceId", v."receiptEvidenceVersion" INTO parent_status,parent_tenant,parent_service,evidence_version
    FROM "FormVersion" v JOIN "Form" f ON f.id=v."formId" WHERE v.id=parent_id FOR UPDATE OF v;
  IF parent_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'published form document bindings are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW."tenantId" IS DISTINCT FROM parent_tenant OR NEW."serviceId" IS DISTINCT FROM parent_service OR evidence_version<>1
    THEN RAISE EXCEPTION 'form document binding scope mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM "FormDocumentBinding" WHERE "formVersionId"=parent_id)>=10
    THEN RAISE EXCEPTION 'at most ten documents per form' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Document" d JOIN "DocumentVersion" v ON v."documentId"=d.id
      WHERE v.id=NEW."documentVersionId" AND d.status='published' AND d.type IN ('consent','overseas_transfer'))
    THEN RAISE EXCEPTION 'only published consent documents can be selected' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER form_document_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON "FormDocumentBinding" FOR EACH ROW EXECUTE FUNCTION guard_form_document_binding();
CREATE FUNCTION guard_form_document_publish() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='draft' AND NEW.status='published' AND EXISTS (
    SELECT 1 FROM "FormDocumentBinding" b JOIN "Document" d ON d.id=b."documentId"
      WHERE b."formVersionId"=NEW.id AND (d.status<>'published' OR NOT EXISTS (
        SELECT 1 FROM "DocumentPublication" p WHERE p."documentVersionId"=b."documentVersionId" AND p.status='active'
          AND (p."expiresAt" IS NULL OR p."expiresAt">CURRENT_TIMESTAMP))))
    THEN RAISE EXCEPTION 'selected consent document is no longer public' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER form_document_publish_guard BEFORE UPDATE ON "FormVersion" FOR EACH ROW EXECUTE FUNCTION guard_form_document_publish();
COMMIT;
