-- Even though encrypted answers can only be interpreted by the application,
-- every stored path must follow a possible default/option edge and finish at a
-- terminal exposed by its last page.
CREATE OR REPLACE FUNCTION check_submission_page_path() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE schema_version INTEGER; first_key TEXT; path_count INTEGER; invalid_edges INTEGER; last_section_id TEXT;
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

  WITH keys AS (
    SELECT value AS page_key, ordinality::integer AS position
    FROM jsonb_array_elements_text(NEW."visitedPageKeys") WITH ORDINALITY
  ), pairs AS (
    SELECT source.id AS source_id, destination.id AS destination_id
    FROM keys current_key JOIN keys next_key ON next_key.position=current_key.position+1
    JOIN "FormSection" source ON source."formVersionId"=NEW."formVersionId" AND source."pageKey"=current_key.page_key
    JOIN "FormSection" destination ON destination."formVersionId"=NEW."formVersionId" AND destination."pageKey"=next_key.page_key
  )
  SELECT count(*) INTO invalid_edges FROM pairs
  WHERE NOT EXISTS (
    SELECT 1 FROM "FormSection" source WHERE source.id=pairs.source_id
      AND source."destinationKind"='page' AND source."destinationSectionId"=pairs.destination_id
    UNION ALL
    SELECT 1 FROM "Question" q JOIN "QuestionOption" o ON o."questionId"=q.id
      WHERE q."sectionId"=pairs.source_id AND o."branchDestinationKind"='page' AND o."branchDestinationSectionId"=pairs.destination_id
  );
  IF invalid_edges<>0 THEN RAISE EXCEPTION 'page path contains impossible edge' USING ERRCODE='23514'; END IF;

  SELECT id INTO last_section_id FROM "FormSection" WHERE "formVersionId"=NEW."formVersionId"
    AND "pageKey"=NEW."visitedPageKeys"->>(jsonb_array_length(NEW."visitedPageKeys")-1);
  IF NOT EXISTS (
    SELECT 1 FROM "FormSection" s WHERE s.id=last_section_id AND s."destinationKind"=NEW."terminationKind"
    UNION ALL
    SELECT 1 FROM "Question" q JOIN "QuestionOption" o ON o."questionId"=q.id
      WHERE q."sectionId"=last_section_id AND o."branchDestinationKind"=NEW."terminationKind"
  ) THEN RAISE EXCEPTION 'page path terminal is impossible' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
