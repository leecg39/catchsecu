-- Stable option destinations and canonical submitted page paths. Existing rows
-- remain legacy (pagePathVersion=0) and are not rewritten.
ALTER TABLE "QuestionOption"
  ADD COLUMN "branchDestinationKind" TEXT,
  ADD COLUMN "branchDestinationSectionId" TEXT;

ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_branch_destination_state" CHECK (
  ("branchDestinationKind" IS NULL AND "branchDestinationSectionId" IS NULL)
  OR ("branchDestinationKind" = 'page' AND "branchDestinationSectionId" IS NOT NULL)
  OR ("branchDestinationKind" IN ('consent','submit','ineligible') AND "branchDestinationSectionId" IS NULL)
);
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_branchDestinationSectionId_fkey"
  FOREIGN KEY ("branchDestinationSectionId") REFERENCES "FormSection"(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "QuestionOption_branchDestinationSectionId_idx" ON "QuestionOption"("branchDestinationSectionId");

CREATE OR REPLACE FUNCTION assert_form_section_graph(target_version_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  schema_version INTEGER;
  section_count INTEGER;
BEGIN
  SELECT "sectionSchemaVersion" INTO schema_version FROM "FormVersion" WHERE id = target_version_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO section_count FROM "FormSection" WHERE "formVersionId" = target_version_id;
  IF schema_version = 0 THEN
    IF section_count <> 0 OR EXISTS (
      SELECT 1 FROM "Question" q LEFT JOIN "QuestionOption" o ON o."questionId"=q.id
      WHERE q."formVersionId"=target_version_id AND (q."sectionId" IS NOT NULL OR o."branchDestinationKind" IS NOT NULL)
    ) THEN RAISE EXCEPTION 'legacy form version cannot own page placement or branches' USING ERRCODE='23514'; END IF;
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
    SELECT 1
    FROM "QuestionOption" o
    JOIN "Question" q ON q.id=o."questionId"
    LEFT JOIN "FormSection" destination ON destination.id=o."branchDestinationSectionId"
    WHERE q."formVersionId"=target_version_id AND o."branchDestinationKind" IS NOT NULL AND (
      q."sectionId" IS NULL OR q.type NOT IN ('객관식 답변','드롭다운') OR q.condition IS NOT NULL
      OR o."isCustomValue" IS TRUE
      OR (o."branchDestinationKind"='page' AND (destination.id IS NULL OR destination."formVersionId"<>target_version_id OR destination.id=q."sectionId"))
    )
  ) THEN RAISE EXCEPTION 'invalid form option branch' USING ERRCODE='23514'; END IF;

  IF EXISTS (
    SELECT 1 FROM "QuestionOption" o JOIN "Question" q ON q.id=o."questionId"
    WHERE q."formVersionId"=target_version_id AND o."branchDestinationKind" IS NOT NULL
    GROUP BY q."sectionId" HAVING count(DISTINCT q.id)>1
  ) THEN RAISE EXCEPTION 'form section allows one branch question' USING ERRCODE='23514'; END IF;

  IF EXISTS (
    WITH RECURSIVE walk AS (
      SELECT s.id AS start_id, s.id AS current_id, ARRAY[s.id]::TEXT[] AS path, false AS cycle
      FROM "FormSection" s WHERE s."formVersionId" = target_version_id
      UNION ALL
      SELECT walk.start_id, destination.id, walk.path || destination.id, destination.id = ANY(walk.path)
      FROM walk
      JOIN "FormSection" source ON source.id=walk.current_id
      JOIN LATERAL (
        SELECT source."destinationSectionId" AS id WHERE source."destinationKind"='page'
        UNION
        SELECT o."branchDestinationSectionId" FROM "Question" q JOIN "QuestionOption" o ON o."questionId"=q.id
          WHERE q."sectionId"=source.id AND o."branchDestinationKind"='page'
      ) edge ON edge.id IS NOT NULL
      JOIN "FormSection" destination ON destination.id=edge.id
      WHERE NOT walk.cycle
    )
    SELECT 1 FROM walk WHERE cycle
  ) THEN RAISE EXCEPTION 'form section branch paths must terminate' USING ERRCODE='23514'; END IF;

  IF (
    WITH RECURSIVE reachable(id) AS (
      SELECT id FROM "FormSection" WHERE "formVersionId"=target_version_id AND "order"=0
      UNION
      SELECT destination.id
      FROM reachable
      JOIN "FormSection" source ON source.id=reachable.id
      JOIN LATERAL (
        SELECT source."destinationSectionId" AS id WHERE source."destinationKind"='page'
        UNION
        SELECT o."branchDestinationSectionId" FROM "Question" q JOIN "QuestionOption" o ON o."questionId"=q.id
          WHERE q."sectionId"=source.id AND o."branchDestinationKind"='page'
      ) edge ON edge.id IS NOT NULL
      JOIN "FormSection" destination ON destination.id=edge.id
    )
    SELECT count(*) FROM reachable
  ) <> section_count THEN RAISE EXCEPTION 'every form section must be reachable' USING ERRCODE='23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION check_form_section_graph() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_version TEXT; new_version TEXT;
BEGIN
  IF TG_TABLE_NAME = 'FormVersion' THEN
    IF TG_OP <> 'INSERT' THEN old_version:=OLD.id; END IF;
    IF TG_OP <> 'DELETE' THEN new_version:=NEW.id; END IF;
  ELSIF TG_TABLE_NAME = 'QuestionOption' THEN
    IF TG_OP <> 'INSERT' THEN SELECT "formVersionId" INTO old_version FROM "Question" WHERE id=OLD."questionId"; END IF;
    IF TG_OP <> 'DELETE' THEN SELECT "formVersionId" INTO new_version FROM "Question" WHERE id=NEW."questionId"; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN old_version:=OLD."formVersionId"; END IF;
    IF TG_OP <> 'DELETE' THEN new_version:=NEW."formVersionId"; END IF;
  END IF;
  IF old_version IS NOT NULL THEN PERFORM assert_form_section_graph(old_version); END IF;
  IF new_version IS NOT NULL AND new_version IS DISTINCT FROM old_version THEN PERFORM assert_form_section_graph(new_version); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "QuestionOption_section_graph"
  AFTER INSERT OR UPDATE OR DELETE ON "QuestionOption" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_form_section_graph();

ALTER TABLE "Submission"
  ADD COLUMN "pagePathVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visitedPageKeys" JSONB,
  ADD COLUMN "terminationKind" TEXT;

CREATE FUNCTION valid_submission_page_path(path JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; value TEXT; seen TEXT[]:=ARRAY[]::TEXT[];
BEGIN
  IF path IS NULL OR jsonb_typeof(path)<>'array' OR jsonb_array_length(path)<1 OR jsonb_array_length(path)>50 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(path) LOOP
    IF jsonb_typeof(item)<>'string' THEN RETURN false; END IF;
    value:=item#>>'{}';
    IF value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR value=ANY(seen) THEN RETURN false; END IF;
    seen:=array_append(seen,value);
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_page_path_state" CHECK (
  ("pagePathVersion"=0 AND "visitedPageKeys" IS NULL AND "terminationKind" IS NULL)
  OR ("pagePathVersion"=1 AND valid_submission_page_path("visitedPageKeys") AND "terminationKind" IN ('consent','submit','ineligible'))
);

CREATE FUNCTION check_submission_page_path() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE schema_version INTEGER; first_key TEXT; path_count INTEGER;
BEGIN
  SELECT "sectionSchemaVersion" INTO schema_version FROM "FormVersion" WHERE id=NEW."formVersionId";
  IF NEW."pagePathVersion"=0 THEN
    IF NEW."importJobId" IS NULL AND schema_version=1 THEN RAISE EXCEPTION 'paged public submission requires page path evidence' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF schema_version<>1 OR NEW."importJobId" IS NOT NULL THEN RAISE EXCEPTION 'page path evidence source mismatch' USING ERRCODE='23514'; END IF;
  first_key:=NEW."visitedPageKeys"->>0;
  IF NOT EXISTS (SELECT 1 FROM "FormSection" WHERE "formVersionId"=NEW."formVersionId" AND "order"=0 AND "pageKey"=first_key)
    THEN RAISE EXCEPTION 'page path must start at first section' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO path_count FROM "FormSection" s
    WHERE s."formVersionId"=NEW."formVersionId" AND s."pageKey" IN (SELECT jsonb_array_elements_text(NEW."visitedPageKeys"));
  IF path_count<>jsonb_array_length(NEW."visitedPageKeys") THEN RAISE EXCEPTION 'page path contains foreign section' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submission_page_path_guard BEFORE INSERT OR UPDATE OF "pagePathVersion","visitedPageKeys","terminationKind","formVersionId","importJobId"
  ON "Submission" FOR EACH ROW EXECUTE FUNCTION check_submission_page_path();
