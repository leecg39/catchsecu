-- Additive draft extension: existing documents and immutable snapshots stay untouched.
CREATE TABLE "DocumentPolicyDraft" (
  "documentId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  CONSTRAINT "DocumentPolicyDraft_pkey" PRIMARY KEY ("documentId"),
  CONSTRAINT "DocumentPolicyDraft_tenantId_serviceId_documentId_fkey"
    FOREIGN KEY ("tenantId", "serviceId", "documentId")
    REFERENCES "Document" ("tenantId", "serviceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DocumentPolicyDraft_payload_check" CHECK (
    "schemaVersion" = 1 AND jsonb_typeof("payload") = 'object'
    AND ("payload"->>'schemaVersion') IS NOT DISTINCT FROM '1'
    AND octet_length("payload"::text) <= 150000
  )
);
CREATE UNIQUE INDEX "DocumentPolicyDraft_tenantId_serviceId_documentId_key" ON "DocumentPolicyDraft" ("tenantId", "serviceId", "documentId");
CREATE FUNCTION document_policy_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "Document" WHERE id=NEW."documentId"
    AND "tenantId"=NEW."tenantId" AND "serviceId"=NEW."serviceId" AND type='privacy_policy' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Policy details require a privacy policy in the same service' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DocumentPolicyDraft_scope_guard" BEFORE INSERT OR UPDATE ON "DocumentPolicyDraft"
  FOR EACH ROW EXECUTE FUNCTION document_policy_draft_guard();
