BEGIN;
-- A link-only write must obey the same immutable revision contract as a root write.
CREATE FUNCTION assert_catalog_links_match(purpose_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE saved jsonb; actual jsonb;
BEGIN
  SELECT r.snapshot->'recipientIds' INTO saved
    FROM "ProcessingPurpose" p JOIN "PurposeRevision" r
      ON r."tenantId"=p."tenantId" AND r."purposeId"=p.id AND r.version=p.version
    WHERE p.id=purpose_id;
  SELECT coalesce(jsonb_agg("recipientId" ORDER BY "recipientId"),'[]'::jsonb) INTO actual
    FROM "PurposeRecipient" WHERE "purposeId"=purpose_id;
  IF saved IS DISTINCT FROM actual THEN
    RAISE EXCEPTION 'purpose links require a matching revision' USING ERRCODE='23514';
  END IF;
END $$;
CREATE FUNCTION require_catalog_link_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','UPDATE') THEN PERFORM assert_catalog_links_match(OLD."purposeId"); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN PERFORM assert_catalog_links_match(NEW."purposeId"); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "PurposeRecipient_revision_required" AFTER INSERT OR UPDATE OR DELETE ON "PurposeRecipient"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_catalog_link_revision();
COMMIT;
