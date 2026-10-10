-- Add address question types without rewriting existing questions or published answers.
ALTER TABLE "Question" DROP CONSTRAINT "Question_type_check";
ALTER TABLE "Question" ADD CONSTRAINT "Question_type_check" CHECK (type IN (
  '단문형 답변','장문형 답변','객관식 답변','체크박스','드롭다운','날짜','파일 업로드','행렬형 단일 선택','행렬형 복수 선택',
  '연락처','이메일','이메일 직접 입력','생년월일','주소','해외 주소'
));
