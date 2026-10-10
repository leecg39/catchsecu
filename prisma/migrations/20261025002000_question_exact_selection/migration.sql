-- Add explicit exact selection semantics; existing min/max JSON is never rewritten.
CREATE OR REPLACE FUNCTION valid_question_settings(kind text, subject_role text, branch jsonb, rows jsonb, limits jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb; row_ids text[] := ARRAY[]::text[]; minimum integer; maximum integer;
BEGIN
 IF branch IS NOT NULL THEN
  IF jsonb_typeof(branch)<>'object' OR NOT branch ?& ARRAY['questionId','operator','value']
   OR branch-ARRAY['questionId','operator','value','optionId']::text[] <> '{}'::jsonb
   OR jsonb_typeof(branch->'questionId')<>'string' OR (branch->>'questionId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   OR (branch ? 'optionId' AND (jsonb_typeof(branch->'optionId')<>'string' OR branch->>'optionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
   OR branch->>'operator' NOT IN ('equals','includes') OR jsonb_typeof(branch->'value')<>'string'
   OR char_length(branch->>'value') NOT BETWEEN 1 AND 500 OR subject_role IS NOT NULL THEN RETURN false; END IF;
 END IF;
 IF kind IN ('행렬형 단일 선택','행렬형 복수 선택') THEN
  IF rows IS NULL OR jsonb_typeof(rows)<>'array' THEN RETURN false; END IF;
  IF jsonb_array_length(rows) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(rows) LOOP
   IF jsonb_typeof(r)<>'object' OR NOT r ?& ARRAY['id','label'] OR r-ARRAY['id','label']::text[] <> '{}'::jsonb
    OR jsonb_typeof(r->'id')<>'string' OR (r->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR jsonb_typeof(r->'label')<>'string' OR char_length(btrim(r->>'label')) NOT BETWEEN 1 AND 500
    OR r->>'id'=ANY(row_ids) THEN RETURN false; END IF;
   row_ids := array_append(row_ids,r->>'id');
  END LOOP;
 ELSIF rows IS NOT NULL THEN RETURN false;
 END IF;
 IF limits IS NOT NULL THEN
  IF kind NOT IN ('체크박스','행렬형 복수 선택') OR jsonb_typeof(limits)<>'object' OR limits='{}'::jsonb
   OR limits-ARRAY['min','max','mode']::text[] <> '{}'::jsonb THEN RETURN false; END IF;
  IF limits ? 'min' THEN
   IF jsonb_typeof(limits->'min')<>'number' OR (limits->>'min') !~ '^[0-9]+$' THEN RETURN false; END IF;
   minimum := (limits->>'min')::numeric; IF minimum NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
  END IF;
  IF limits ? 'max' THEN
   IF jsonb_typeof(limits->'max')<>'number' OR (limits->>'max') !~ '^[0-9]+$' THEN RETURN false; END IF;
   maximum := (limits->>'max')::numeric; IF maximum NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  END IF;
  IF coalesce(minimum,0)>coalesce(maximum,100) THEN RETURN false; END IF;
  IF limits ? 'mode' THEN
   IF jsonb_typeof(limits->'mode')<>'string' OR limits->>'mode'<>'exact'
    OR minimum IS NULL OR maximum IS NULL OR minimum<1 OR minimum<>maximum THEN RETURN false; END IF;
  END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN numeric_value_out_of_range THEN RETURN false;
END $$;

