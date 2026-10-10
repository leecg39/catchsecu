-- Version-frozen projection of question classifications into the collection consent.
-- Existing versions stay at schema 0/NULL so approvals, receipts and published hashes remain byte-for-byte compatible.
ALTER TABLE "FormVersion"
  ADD COLUMN "consentItemSchemaVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "consentItems" JSONB;

CREATE FUNCTION valid_form_consent_items(value jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value) > 2000 THEN RETURN false; END IF;
  FOR item IN SELECT entry FROM jsonb_array_elements(value) AS entries(entry) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR NOT (item ?& ARRAY['type','name'])
      OR (item - ARRAY['type','name']) <> '{}'::jsonb
      OR jsonb_typeof(item->'type') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string'
      OR item->>'type' NOT IN ('PERSONAL_INFORMATION','SENSITIVE','IDENTIFICATION','RESIDENT')
      OR question_personal_information_utf16_length(item->>'name') NOT BETWEEN 1 AND 50
      OR btrim(item->>'name', U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') = ''
      THEN RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_consent_items_check" CHECK (
  ("consentItemSchemaVersion" = 0 AND "consentItems" IS NULL)
  OR ("consentItemSchemaVersion" = 1 AND "consentItems" IS NOT NULL AND valid_form_consent_items("consentItems"))
);

CREATE FUNCTION assert_form_consent_items_projection(version_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE schema_version integer; stored jsonb; projected jsonb;
BEGIN
  SELECT "consentItemSchemaVersion", "consentItems" INTO schema_version, stored FROM "FormVersion" WHERE id=version_id;
  IF NOT FOUND OR schema_version=0 THEN RETURN; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', item->>'personalInformationType', 'name', item->>'detectedPersonalInformation')
    ORDER BY q."order", entry.ordinality), '[]'::jsonb) INTO projected
  FROM "Question" q
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q."catchFormPersonalInformationRequests", '[]'::jsonb)) WITH ORDINALITY AS entry(item, ordinality)
  WHERE q."formVersionId"=version_id AND item->>'personalInformationType' <> 'NON_PERSONAL_INFORMATION';
  IF stored IS DISTINCT FROM projected THEN
    RAISE EXCEPTION 'form consent items do not match question classifications' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION check_form_consent_items_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='FormVersion' THEN
    PERFORM assert_form_consent_items_projection(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END);
  ELSE
    IF TG_OP='UPDATE' AND OLD."formVersionId" IS DISTINCT FROM NEW."formVersionId" THEN
      PERFORM assert_form_consent_items_projection(OLD."formVersionId");
    END IF;
    PERFORM assert_form_consent_items_projection(CASE WHEN TG_OP='DELETE' THEN OLD."formVersionId" ELSE NEW."formVersionId" END);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "FormVersion_consent_items_projection"
  AFTER INSERT OR UPDATE ON "FormVersion" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_form_consent_items_projection();
CREATE CONSTRAINT TRIGGER "Question_consent_items_projection"
  AFTER INSERT OR UPDATE OR DELETE ON "Question" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_form_consent_items_projection();
