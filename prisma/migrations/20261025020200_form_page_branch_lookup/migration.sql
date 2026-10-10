-- Graph guards ask only for options that actually branch. Keep ordinary large
-- choice sets out of those scans while preserving the full option table.
CREATE INDEX "QuestionOption_branch_question_idx"
  ON "QuestionOption"("questionId") WHERE "branchDestinationKind" IS NOT NULL;
