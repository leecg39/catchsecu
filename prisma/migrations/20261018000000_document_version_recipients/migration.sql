-- Preserve source identity separately from immutable public snapshot bytes.
-- Legacy versions have no source rows; current drafts cannot establish their history.
CREATE TABLE "DocumentVersionRecipient" (
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentVersionId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  CONSTRAINT "DocumentVersionRecipient_pkey" PRIMARY KEY ("tenantId", "documentVersionId", "recipientId"),
  CONSTRAINT "DocumentVersionRecipient_version_fkey"
    FOREIGN KEY ("tenantId", "serviceId", "documentId", "documentVersionId")
    REFERENCES "DocumentVersion" ("tenantId", "serviceId", "documentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DocumentVersionRecipient_recipient_fkey"
    FOREIGN KEY ("tenantId", "serviceId", "recipientId")
    REFERENCES "Recipient" ("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DocumentVersionRecipient_recipient_idx" ON "DocumentVersionRecipient" ("tenantId", "serviceId", "recipientId");

CREATE FUNCTION document_version_recipient_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "DocumentVersion"
    WHERE id=NEW."documentVersionId" AND "tenantId"=NEW."tenantId"
      AND "serviceId"=NEW."serviceId" AND "documentId"=NEW."documentId" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document version source scope does not exist' USING ERRCODE='23503';
  END IF;
  IF EXISTS (SELECT 1 FROM "DocumentPublication" WHERE "documentVersionId"=NEW."documentVersionId")
    OR EXISTS (SELECT 1 FROM "FormDocumentBinding" WHERE "documentVersionId"=NEW."documentVersionId")
    OR EXISTS (SELECT 1 FROM "DocumentPdf" WHERE "documentVersionId"=NEW."documentVersionId") THEN
    RAISE EXCEPTION 'Document version recipient sources are sealed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DocumentVersionRecipient_insert_guard"
  BEFORE INSERT ON "DocumentVersionRecipient" FOR EACH ROW EXECUTE FUNCTION document_version_recipient_insert_guard();
CREATE TRIGGER "DocumentVersionRecipient_immutable"
  BEFORE UPDATE OR DELETE ON "DocumentVersionRecipient" FOR EACH ROW EXECUTE FUNCTION document_version_immutable();
