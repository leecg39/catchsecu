-- Source-observed information-pattern IDs only. Existing questions stay neutral,
-- and no caller supplied regular expression is persisted or executed.
ALTER TABLE "Question" ADD COLUMN "infoPatternId" INTEGER;
ALTER TABLE "Question" ADD CONSTRAINT "Question_info_pattern_check" CHECK (
  "infoPatternId" IS NULL OR
  ("infoPatternId"=1 AND type='단문형 답변') OR
  ("infoPatternId"=3 AND type='단문형 답변' AND "subjectRole" IS NULL) OR
  ("infoPatternId"=2 AND type='장문형 답변') OR
  ("infoPatternId"=4 AND type='이메일 직접 입력') OR
  ("infoPatternId"=7 AND type='주소') OR
  ("infoPatternId"=8 AND type='생년월일')
);
