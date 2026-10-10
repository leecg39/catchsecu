-- PL/pgSQL resolves the prior local `value` name against the set-returning
-- function column ambiguously. Use explicit aliases for deterministic parsing.
CREATE OR REPLACE FUNCTION valid_submission_page_path(path JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; item_value TEXT; seen TEXT[]:=ARRAY[]::TEXT[];
BEGIN
  IF path IS NULL OR jsonb_typeof(path)<>'array' OR jsonb_array_length(path)<1 OR jsonb_array_length(path)>50 THEN RETURN false; END IF;
  FOR item IN SELECT element FROM jsonb_array_elements(path) AS j(element) LOOP
    IF jsonb_typeof(item)<>'string' THEN RETURN false; END IF;
    item_value:=item#>>'{}';
    IF item_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR item_value=ANY(seen) THEN RETURN false; END IF;
    seen:=array_append(seen,item_value);
  END LOOP;
  RETURN true;
END;
$$;
