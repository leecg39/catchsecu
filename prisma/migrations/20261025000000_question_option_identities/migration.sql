-- Additive migration: never UPDATE existing published questions/options or approval snapshots.
ALTER TABLE "FormVersion" ADD COLUMN "optionSchemaVersion" integer NOT NULL DEFAULT 0;
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_option_schema_check" CHECK ("optionSchemaVersion" IN (0,1));
ALTER TABLE "QuestionOption" ADD COLUMN "stableKey" text, ADD COLUMN label text;
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_identity_check" CHECK (
 ("stableKey" IS NULL AND label IS NULL) OR
 ("stableKey" IS NOT NULL AND "stableKey" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND label IS NOT NULL AND char_length(btrim(label)) BETWEEN 1 AND 500));
CREATE UNIQUE INDEX "QuestionOption_questionId_stableKey_key" ON "QuestionOption"("questionId","stableKey");
CREATE INDEX "QuestionOption_stableKey_idx" ON "QuestionOption"("stableKey");

CREATE FUNCTION guard_option_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE form_id text; question_key text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD."stableKey" IS NOT NULL AND (NEW."stableKey" IS DISTINCT FROM OLD."stableKey" OR NEW.value IS DISTINCT FROM OLD.value OR NEW."questionId"<>OLD."questionId") THEN
   RAISE EXCEPTION 'Option identity/value is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD."stableKey" IS NULL AND NEW."stableKey" IS NOT NULL AND (NEW."stableKey"<>OLD.id OR NEW.value<>OLD.value OR NEW."questionId"<>OLD."questionId") THEN
   RAISE EXCEPTION 'Legacy identity must retain its row identity and value' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW."stableKey" IS NOT NULL THEN
  SELECT v."formId",q."stableKey" INTO form_id,question_key FROM "Question" q JOIN "FormVersion" v ON v.id=q."formVersionId" WHERE q.id=NEW."questionId";
  -- Serializes same-form identity checks, including direct database writers.
  PERFORM id FROM "Form" WHERE id=form_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "QuestionOption" o JOIN "Question" q ON q.id=o."questionId" JOIN "FormVersion" v ON v.id=q."formVersionId"
   WHERE v."formId"=form_id AND (o."stableKey"=NEW."stableKey" OR (o."stableKey" IS NULL AND o.id=NEW."stableKey"))
    AND (q."stableKey"<>question_key OR o.value<>NEW.value)) THEN
   RAISE EXCEPTION 'Option identity belongs to another question or value' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER option_identity_guard BEFORE INSERT OR UPDATE ON "QuestionOption" FOR EACH ROW EXECUTE FUNCTION guard_option_identity();


CREATE OR REPLACE FUNCTION guard_question_rules_publish() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record; source record; option_count integer;
BEGIN
 IF NEW.status<>'published' OR OLD.status='published' THEN RETURN NEW; END IF;
 FOR q IN SELECT * FROM "Question" WHERE "formVersionId"=NEW.id ORDER BY "order" LOOP
  IF NEW."optionSchemaVersion"=1 AND EXISTS (SELECT 1 FROM "QuestionOption" WHERE "questionId"=q.id AND ("stableKey" IS NULL OR label IS NULL)) THEN
   RAISE EXCEPTION 'Canonical choices require identities and labels' USING ERRCODE='23514';
  END IF;
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
    OR NOT EXISTS (SELECT 1 FROM "QuestionOption" WHERE "questionId"=source.id AND value=q."condition"->>'value' AND (NOT q."condition" ? 'optionId' OR coalesce("stableKey",id)=q."condition"->>'optionId'))
    OR NEW.marketing->>'nameQuestionId'=q."stableKey" OR NEW.marketing->>'emailQuestionId'=q."stableKey" OR NEW.marketing->>'smsQuestionId'=q."stableKey" THEN
    RAISE EXCEPTION 'Invalid branch reference' USING ERRCODE='23514';
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
