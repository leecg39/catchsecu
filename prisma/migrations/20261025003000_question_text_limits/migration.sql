-- Null preserves the rules of existing drafts and published versions. No backfill.
ALTER TABLE "Question" ADD COLUMN "textMaxLength" INTEGER;
ALTER TABLE "Question" ADD CONSTRAINT "Question_text_max_length_check" CHECK (
  "textMaxLength" IS NULL OR
  (type = '단문형 답변' AND "textMaxLength" BETWEEN 1 AND 1000) OR
  (type = '장문형 답변' AND "textMaxLength" BETWEEN 1 AND 20000)
);
