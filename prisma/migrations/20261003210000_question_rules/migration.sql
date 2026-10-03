ALTER TABLE "Question" ADD COLUMN "condition" jsonb, ADD COLUMN "matrixRows" jsonb, ADD COLUMN "selectionLimits" jsonb;
ALTER TABLE "Question" ADD CONSTRAINT "Question_type_check" CHECK (type IN ('단문형 답변','장문형 답변','객관식 답변','체크박스','드롭다운','날짜','파일 업로드','행렬형 단일 선택','행렬형 복수 선택'));

CREATE FUNCTION valid_question_settings(kind text, subject_role text, branch jsonb, rows jsonb, limits jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb; row_ids text[] := ARRAY[]::text[]; minimum integer; maximum integer;
BEGIN
 IF branch IS NOT NULL THEN
  IF jsonb_typeof(branch)<>'object' OR NOT branch ?& ARRAY['questionId','operator','value']
   OR branch-ARRAY['questionId','operator','value']::text[] <> '{}'::jsonb
   OR jsonb_typeof(branch->'questionId')<>'string' OR (branch->>'questionId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
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
   OR limits-ARRAY['min','max']::text[] <> '{}'::jsonb THEN RETURN false; END IF;
  IF limits ? 'min' THEN
   IF jsonb_typeof(limits->'min')<>'number' OR (limits->>'min') !~ '^[0-9]+$' THEN RETURN false; END IF;
   minimum := (limits->>'min')::numeric; IF minimum NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
  END IF;
  IF limits ? 'max' THEN
   IF jsonb_typeof(limits->'max')<>'number' OR (limits->>'max') !~ '^[0-9]+$' THEN RETURN false; END IF;
   maximum := (limits->>'max')::numeric; IF maximum NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  END IF;
  IF coalesce(minimum,0)>coalesce(maximum,100) THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN numeric_value_out_of_range THEN RETURN false;
END $$;
ALTER TABLE "Question" ADD CONSTRAINT "Question_settings_check" CHECK (valid_question_settings(type,"subjectRole","condition","matrixRows","selectionLimits"));

CREATE FUNCTION guard_question_rules_publish() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record; source record; option_count integer;
BEGIN
 IF NEW.status<>'published' OR OLD.status='published' THEN RETURN NEW; END IF;
 FOR q IN SELECT * FROM "Question" WHERE "formVersionId"=NEW.id ORDER BY "order" LOOP
  SELECT count(*) INTO option_count FROM "QuestionOption" WHERE "questionId"=q.id;
  IF q.type IN ('객관식 답변','체크박스','드롭다운','행렬형 단일 선택','행렬형 복수 선택') AND option_count=0 THEN
   RAISE EXCEPTION 'Choice questions need options' USING ERRCODE='23514';
  END IF;
  IF q."selectionLimits" IS NOT NULL AND (coalesce((q."selectionLimits"->>'min')::integer,0)>option_count OR coalesce((q."selectionLimits"->>'max')::integer,0)>option_count) THEN
   RAISE EXCEPTION 'Selection count exceeds available options' USING ERRCODE='23514';
  END IF;
  IF q."condition" IS NOT NULL THEN
   SELECT * INTO source FROM "Question" WHERE "formVersionId"=NEW.id AND "stableKey"=q."condition"->>'questionId' AND "order"<q."order";
   IF NOT FOUND OR (q."condition"->>'operator'='equals' AND source.type NOT IN ('객관식 답변','드롭다운'))
    OR (q."condition"->>'operator'='includes' AND source.type<>'체크박스')
    OR NOT EXISTS (SELECT 1 FROM "QuestionOption" WHERE "questionId"=source.id AND value=q."condition"->>'value')
    OR NEW.marketing->>'nameQuestionId'=q."stableKey" OR NEW.marketing->>'emailQuestionId'=q."stableKey" OR NEW.marketing->>'smsQuestionId'=q."stableKey" THEN
    RAISE EXCEPTION 'Invalid branch reference' USING ERRCODE='23514';
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER question_rules_publish_guard BEFORE UPDATE ON "FormVersion" FOR EACH ROW EXECUTE FUNCTION guard_question_rules_publish();
