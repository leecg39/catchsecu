-- Version-owned pages and terminal notices are opt-in. Existing rows stay at
-- sectionSchemaVersion=0 with every new nullable field empty, so their DTO and
-- approval fingerprint remain byte-for-byte unchanged.
ALTER TABLE "FormVersion"
  ADD COLUMN "sectionSchemaVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completionPageMode" TEXT,
  ADD COLUMN "completionPageBody" TEXT,
  ADD COLUMN "completionPageBodyRich" JSONB,
  ADD COLUMN "closedPageMode" TEXT,
  ADD COLUMN "closedPageBody" TEXT,
  ADD COLUMN "closedPageBodyRich" JSONB;

ALTER TABLE "Question" ADD COLUMN "sectionId" TEXT;

CREATE TABLE "FormSection" (
  id TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "formVersionId" TEXT NOT NULL,
  "pageKey" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  "bodyRich" JSONB,
  "destinationKind" TEXT NOT NULL,
  "destinationSectionId" TEXT,
  "allowBack" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormSection_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX "FormSection_tenantId_formVersionId_id_key" ON "FormSection"("tenantId", "formVersionId", id);
CREATE UNIQUE INDEX "FormSection_tenantId_formVersionId_pageKey_key" ON "FormSection"("tenantId", "formVersionId", "pageKey");
ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_tenantId_formVersionId_order_key"
  UNIQUE ("tenantId", "formVersionId", "order") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_tenantId_formVersionId_fkey"
  FOREIGN KEY ("tenantId", "formVersionId") REFERENCES "FormVersion"("tenantId", id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_tenantId_formVersionId_destinationSectionId_fkey"
  FOREIGN KEY ("tenantId", "formVersionId", "destinationSectionId") REFERENCES "FormSection"("tenantId", "formVersionId", id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "Question" ADD CONSTRAINT "Question_tenantId_formVersionId_sectionId_fkey"
  FOREIGN KEY ("tenantId", "formVersionId", "sectionId") REFERENCES "FormSection"("tenantId", "formVersionId", id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_sectionSchemaVersion_check"
  CHECK ("sectionSchemaVersion" IN (0, 1));
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_completionPage_state" CHECK (
  ("completionPageMode" IS NULL AND "completionPageBody" IS NULL AND "completionPageBodyRich" IS NULL)
  OR ("completionPageMode" = 'default' AND "completionPageBody" IS NULL AND "completionPageBodyRich" IS NULL)
  OR ("completionPageMode" = 'custom' AND "completionPageBody" IS NOT NULL)
);
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_closedPage_state" CHECK (
  ("closedPageMode" IS NULL AND "closedPageBody" IS NULL AND "closedPageBodyRich" IS NULL)
  OR ("closedPageMode" = 'default' AND "closedPageBody" IS NULL AND "closedPageBodyRich" IS NULL)
  OR ("closedPageMode" = 'custom' AND "closedPageBody" IS NOT NULL)
);
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_notice_body_length" CHECK (
  ("completionPageBody" IS NULL OR char_length("completionPageBody") <= 20000)
  AND ("closedPageBody" IS NULL OR char_length("closedPageBody") <= 20000)
);
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_completionPageRich_shape" CHECK (
  "completionPageBodyRich" IS NULL OR (
    jsonb_typeof("completionPageBodyRich") = 'object'
    AND "completionPageBodyRich"->>'schemaVersion' = '1'
    AND jsonb_typeof("completionPageBodyRich"->'blocks') = 'array'
  )
);
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_closedPageRich_shape" CHECK (
  "closedPageBodyRich" IS NULL OR (
    jsonb_typeof("closedPageBodyRich") = 'object'
    AND "closedPageBodyRich"->>'schemaVersion' = '1'
    AND jsonb_typeof("closedPageBodyRich"->'blocks') = 'array'
  )
);
ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_pageKey_uuid" CHECK (
  "pageKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);
ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_content_limits" CHECK (
  "order" >= 0 AND "order" < 50 AND char_length(title) <= 200 AND char_length(body) <= 20000
);
ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_destination_state" CHECK (
  "destinationKind" IN ('page', 'consent', 'submit', 'ineligible')
  AND (("destinationKind" = 'page' AND "destinationSectionId" IS NOT NULL)
    OR ("destinationKind" <> 'page' AND "destinationSectionId" IS NULL))
  AND ("destinationSectionId" IS NULL OR "destinationSectionId" <> id)
);
ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_bodyRich_shape" CHECK (
  "bodyRich" IS NULL OR (
    jsonb_typeof("bodyRich") = 'object'
    AND "bodyRich"->>'schemaVersion' = '1'
    AND jsonb_typeof("bodyRich"->'blocks') = 'array'
  )
);

CREATE FUNCTION assert_form_section_graph(target_version_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  schema_version INTEGER;
  section_count INTEGER;
BEGIN
  SELECT "sectionSchemaVersion" INTO schema_version FROM "FormVersion" WHERE id = target_version_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO section_count FROM "FormSection" WHERE "formVersionId" = target_version_id;
  IF schema_version = 0 THEN
    IF section_count <> 0 OR EXISTS (
      SELECT 1 FROM "Question" WHERE "formVersionId" = target_version_id AND "sectionId" IS NOT NULL
    ) THEN RAISE EXCEPTION 'legacy form version cannot own page placement' USING ERRCODE='23514'; END IF;
    RETURN;
  END IF;

  IF section_count < 1 OR section_count > 50 THEN
    RAISE EXCEPTION 'paged form version requires 1 to 50 sections' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "FormSection" WHERE "formVersionId" = target_version_id
    GROUP BY "formVersionId" HAVING min("order") <> 0 OR max("order") <> count(*) - 1 OR count(DISTINCT "order") <> count(*)
  ) THEN RAISE EXCEPTION 'form section order must be contiguous' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM "FormSection" WHERE "formVersionId" = target_version_id AND "order" = 0
      AND (title <> '' OR body <> '' OR "bodyRich" IS NOT NULL)
  ) THEN RAISE EXCEPTION 'first form section content must be empty' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM "Question" WHERE "formVersionId" = target_version_id AND "sectionId" IS NULL
  ) THEN RAISE EXCEPTION 'paged form questions require section placement' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    WITH RECURSIVE walk AS (
      SELECT s.id AS start_id, s.id AS current_id, ARRAY[s.id]::TEXT[] AS path, false AS cycle
      FROM "FormSection" s WHERE s."formVersionId" = target_version_id
      UNION ALL
      SELECT walk.start_id, destination.id, walk.path || destination.id,
        destination.id = ANY(walk.path) AS cycle
      FROM walk
      JOIN "FormSection" source ON source.id = walk.current_id
      JOIN "FormSection" destination ON destination.id = source."destinationSectionId"
      WHERE source."destinationKind" = 'page' AND NOT walk.cycle
    )
    SELECT 1 FROM walk WHERE cycle
  ) THEN RAISE EXCEPTION 'form section path must terminate' USING ERRCODE='23514'; END IF;
END;
$$;

CREATE FUNCTION check_form_section_graph() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_form_section_graph(CASE WHEN TG_TABLE_NAME = 'FormVersion' THEN OLD.id ELSE OLD."formVersionId" END);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_form_section_graph(CASE WHEN TG_TABLE_NAME = 'FormVersion' THEN NEW.id ELSE NEW."formVersionId" END);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "FormVersion_section_graph"
  AFTER INSERT OR UPDATE OR DELETE ON "FormVersion" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_form_section_graph();
CREATE CONSTRAINT TRIGGER "FormSection_graph"
  AFTER INSERT OR UPDATE OR DELETE ON "FormSection" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_form_section_graph();
CREATE CONSTRAINT TRIGGER "Question_section_graph"
  AFTER INSERT OR UPDATE OR DELETE ON "Question" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_form_section_graph();

CREATE FUNCTION protect_published_section() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM "FormVersion" WHERE id = OLD."formVersionId" AND status = 'published'
  ) THEN RAISE EXCEPTION 'Published form sections are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1 FROM "FormVersion" WHERE id = NEW."formVersionId" AND status = 'published'
  ) THEN RAISE EXCEPTION 'Published form sections are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER published_section_immutable BEFORE INSERT OR UPDATE OR DELETE ON "FormSection"
  FOR EACH ROW EXECUTE FUNCTION protect_published_section();
