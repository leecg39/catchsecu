BEGIN;
CREATE OR REPLACE FUNCTION catalog_items_valid(items jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; names text[] := '{}'; key text;
BEGIN
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(items) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(item->>'name')),0) NOT BETWEEN 1 AND 200
      OR coalesce(item->>'kind','') NOT IN ('general','sensitive','unique_identifier')
      OR jsonb_typeof(item->'required') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    key:=lower(btrim(normalize(item->>'name',NFKC)));
    IF key=ANY(names) THEN RETURN false; END IF; names:=array_append(names,key);
  END LOOP; RETURN true;
END $$;
ALTER TABLE "PurposeRevision" ADD CONSTRAINT "PurposeRevision_snapshot_check" CHECK (version>0 AND jsonb_typeof(snapshot)='object');
ALTER TABLE "RecipientRevision" ADD CONSTRAINT "RecipientRevision_snapshot_check" CHECK (version>0 AND jsonb_typeof(snapshot)='object');
CREATE FUNCTION require_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saved jsonb; expected jsonb; recipients jsonb;
BEGIN
  expected:=jsonb_build_object('id',NEW.id,'serviceId',NEW."serviceId",'version',NEW.version,'status',NEW.status,
    'name',NEW.name,'purpose',NEW.purpose,'items',NEW.items,'retentionMode',NEW."retentionMode",
    'retentionDays',NEW."retentionDays",'retentionReason',NEW."retentionReason");
  IF TG_TABLE_NAME='ProcessingPurpose' THEN
    SELECT snapshot INTO saved FROM "PurposeRevision" WHERE "tenantId"=NEW."tenantId" AND "purposeId"=NEW.id AND version=NEW.version;
    expected:=expected||jsonb_build_object('lawfulBasis',NEW."lawfulBasis",'basisReference',NEW."basisReference");
    SELECT coalesce(jsonb_agg("recipientId" ORDER BY "recipientId"),'[]'::jsonb) INTO recipients FROM "PurposeRecipient" WHERE "purposeId"=NEW.id;
    IF saved->'recipientIds' IS DISTINCT FROM recipients THEN RAISE EXCEPTION 'catalog revision links must match' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT snapshot INTO saved FROM "RecipientRevision" WHERE "tenantId"=NEW."tenantId" AND "recipientId"=NEW.id AND version=NEW.version;
    expected:=expected||jsonb_build_object('kind',NEW.kind,'countryCode',NEW."countryCode",'contact',NEW.contact,
      'transferMethod',NEW."transferMethod",'transferTiming',NEW."transferTiming",'refusalNotice',NEW."refusalNotice");
  END IF;
  IF saved IS NULL OR NOT saved @> expected THEN RAISE EXCEPTION 'matching catalog revision is required' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ProcessingPurpose_revision_required" AFTER INSERT OR UPDATE ON "ProcessingPurpose"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_catalog_revision();
CREATE CONSTRAINT TRIGGER "Recipient_revision_required" AFTER INSERT OR UPDATE ON "Recipient"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_catalog_revision();
COMMIT;
