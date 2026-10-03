CREATE TABLE "DocumentPdf" (
  "documentVersionId" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "rendererVersion" INTEGER NOT NULL,
  "fontHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "pdfHash" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentPdf_version_fkey" FOREIGN KEY ("tenantId", "serviceId", "documentId", "documentVersionId")
    REFERENCES "DocumentVersion" ("tenantId", "serviceId", "documentId", id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "DocumentPdf_values" CHECK (
    "rendererVersion" > 0 AND "pageCount" BETWEEN 1 AND 250
    AND "fontHash" ~ '^[a-f0-9]{64}$' AND "contentHash" ~ '^[a-f0-9]{64}$'
    AND "pdfHash" = encode(sha256("bytes"), 'hex')
    AND octet_length("bytes") BETWEEN 1000 AND 16777216
    AND substring("bytes" FROM 1 FOR 5) = decode('255044462d', 'hex')
  )
);
CREATE INDEX "DocumentPdf_tenantId_serviceId_documentId_idx" ON "DocumentPdf" ("tenantId", "serviceId", "documentId");
CREATE UNIQUE INDEX "DocumentPdf_tenantId_serviceId_documentId_documentVersionId_key" ON "DocumentPdf" ("tenantId", "serviceId", "documentId", "documentVersionId");
CREATE FUNCTION validate_document_pdf() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "DocumentVersion" v WHERE v.id=NEW."documentVersionId" AND v."contentHash"=NEW."contentHash")
    THEN RAISE EXCEPTION 'PDF must refer to the exact document content hash' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_pdf_source BEFORE INSERT ON "DocumentPdf" FOR EACH ROW EXECUTE FUNCTION validate_document_pdf();
CREATE TRIGGER document_pdf_immutable BEFORE UPDATE OR DELETE ON "DocumentPdf" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
