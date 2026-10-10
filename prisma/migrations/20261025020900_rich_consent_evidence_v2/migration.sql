BEGIN;

ALTER TABLE "FormVersion" DROP CONSTRAINT "FormVersion_consent_evidence";
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_consent_evidence" CHECK (
  ("receiptEvidenceVersion"=0 AND "consentDisplay" IS NULL) OR
  ("receiptEvidenceVersion" IN (1,2) AND "consentDisplay" IS NOT NULL AND jsonb_typeof("consentDisplay")='object')
);

ALTER TABLE "ConsentReceipt" DROP CONSTRAINT "ConsentReceipt_evidence";
ALTER TABLE "ConsentReceipt" ADD CONSTRAINT "ConsentReceipt_evidence" CHECK (
  ("evidenceVersion"=0 AND "evidenceCipher" IS NULL AND "pdfCipher" IS NULL AND "pdfHash" IS NULL) OR
  ("evidenceVersion" IN (1,2) AND "evidenceCipher" IS NOT NULL AND "evidenceCipher" LIKE 'v1.%'
    AND "pdfCipher" IS NOT NULL AND "pdfCipher" LIKE 'v1.%' AND "pdfHash" IS NOT NULL AND "pdfHash" ~ '^[a-f0-9]{64}$'
    AND "documentHash" ~ '^[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION guard_form_document_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id TEXT; parent_status TEXT; parent_tenant TEXT; parent_service TEXT; evidence_version INTEGER;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'replace draft bindings instead of mutating evidence' USING ERRCODE='23514'; END IF;
  parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD."formVersionId" ELSE NEW."formVersionId" END;
  SELECT v.status, v."tenantId", f."serviceId", v."receiptEvidenceVersion" INTO parent_status,parent_tenant,parent_service,evidence_version
    FROM "FormVersion" v JOIN "Form" f ON f.id=v."formId" WHERE v.id=parent_id FOR UPDATE OF v;
  IF parent_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'published form document bindings are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW."tenantId" IS DISTINCT FROM parent_tenant OR NEW."serviceId" IS DISTINCT FROM parent_service OR evidence_version NOT IN (1,2)
    THEN RAISE EXCEPTION 'form document binding scope mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM "FormDocumentBinding" WHERE "formVersionId"=parent_id)>=10
    THEN RAISE EXCEPTION 'at most ten documents per form' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Document" d JOIN "DocumentVersion" v ON v."documentId"=d.id
      WHERE v.id=NEW."documentVersionId" AND d.status='published' AND d.type IN ('consent','overseas_transfer'))
    THEN RAISE EXCEPTION 'only published consent documents can be selected' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

COMMIT;
