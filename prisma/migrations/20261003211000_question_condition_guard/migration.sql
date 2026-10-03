ALTER TABLE "Question" ADD CONSTRAINT "Question_condition_operator_check" CHECK (
 "condition" IS NULL OR (
  jsonb_typeof("condition"->'operator')='string'
  AND "condition"->>'operator' IN ('equals','includes')
  AND char_length(btrim("condition"->>'value')) BETWEEN 1 AND 500
 )
);
