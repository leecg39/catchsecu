-- Additive only: no backfill of published choices, answer ciphertext or approval snapshots.
ALTER TABLE "QuestionOption" ADD COLUMN "isCustomValue" boolean;
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_custom_true_only" CHECK (
  "isCustomValue" IS NULL OR "isCustomValue" = true
);
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_custom_label" CHECK (
  "isCustomValue" IS NULL OR (
    question_explanation_utf16_length(coalesce(label,value)) BETWEEN 1 AND 250
    AND length(btrim(coalesce(label,value), U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')) > 0
  )
);
CREATE UNIQUE INDEX "QuestionOption_one_custom_per_question" ON "QuestionOption"("questionId") WHERE "isCustomValue" = true;

-- Both directions serialize on the existing Form lock. These VOLATILE trigger functions
-- take a fresh READ COMMITTED snapshot in the query AFTER that lock is acquired, so an
-- uncommitted parent type / child flag cannot be overlooked after waiting for its writer.
-- A fixed-snapshot transaction cannot promise that fresh view. Explicitly reject these
-- mutations in repeatable read/serializable rather than silently allowing write skew.
-- Row acquisition by direct UPDATE may deadlock with the established Form-first order;
-- PostgreSQL aborts one writer (40P01), preserving the invariant. Application writes hold
-- Form before changing questions/options and release custom A before assigning custom B.
CREATE FUNCTION guard_custom_choice_option() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE form_id text; parent_type text;
BEGIN
  IF NEW."isCustomValue" IS NOT TRUE THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Custom choice mutations require READ COMMITTED' USING ERRCODE='0A000';
  END IF;
  SELECT v."formId" INTO form_id FROM "Question" q JOIN "FormVersion" v ON v.id=q."formVersionId" WHERE q.id=NEW."questionId";
  PERFORM id FROM "Form" WHERE id=form_id FOR UPDATE;
  SELECT type INTO parent_type FROM "Question" WHERE id=NEW."questionId";
  IF parent_type IS NULL OR parent_type NOT IN ('객관식 답변','체크박스','드롭다운') THEN
    RAISE EXCEPTION 'Custom choices require a supported choice question' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER custom_choice_option_guard BEFORE INSERT OR UPDATE ON "QuestionOption"
  FOR EACH ROW EXECUTE FUNCTION guard_custom_choice_option();

CREATE FUNCTION guard_custom_choice_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE form_id text;
BEGIN
  IF NEW.type IS NOT DISTINCT FROM OLD.type THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Question type mutations require READ COMMITTED' USING ERRCODE='0A000';
  END IF;
  SELECT "formId" INTO form_id FROM "FormVersion" WHERE id=NEW."formVersionId";
  PERFORM id FROM "Form" WHERE id=form_id FOR UPDATE;
  IF NEW.type NOT IN ('객관식 답변','체크박스','드롭다운')
    AND EXISTS (SELECT 1 FROM "QuestionOption" WHERE "questionId"=NEW.id AND "isCustomValue"=true) THEN
    RAISE EXCEPTION 'Remove custom choices before changing question type' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER custom_choice_parent_guard BEFORE UPDATE OF type ON "Question"
  FOR EACH ROW EXECUTE FUNCTION guard_custom_choice_parent();
-- Last position is a final-list API invariant, not an immediate row constraint. The
-- existing published_question/option guards continue to reject every historical write.
