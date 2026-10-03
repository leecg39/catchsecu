import { subjectEmail, subjectName } from "@/contracts/subjects";
import { z } from "zod";
import { fail } from "./http";
type QuestionRule = { stableKey: string; label: string; type: string; required: boolean; subjectRole?: string | null; validationKind?: string; options: { value: string }[] };
export type Answers = Record<string, string | string[]>;
export function validateAnswers(questions: QuestionRule[], answers: Answers, partial = false) {
  const keys = new Set(questions.map(question => question.stableKey));
  for (const id of Object.keys(answers)) if (!keys.has(id)) fail(422, "UNKNOWN_QUESTION", "폼에 없는 질문의 답변입니다.");
  for (const question of questions) {
    if (partial && !(question.stableKey in answers)) continue;
    const value = answers[question.stableKey];
    if (value !== undefined && ((question.type === "체크박스") !== Array.isArray(value))) fail(422, "INVALID_ANSWER_TYPE", "답변 형식이 올바르지 않습니다.");
    const empty = value === undefined || (Array.isArray(value) ? value.length === 0 : !value.trim());
    if (question.required && empty) fail(422, "REQUIRED_ANSWER", question.label + " 항목을 입력해주세요.");
    if (empty) continue;
    const options = question.options.map(option => option.value);
    if (question.type === "체크박스") {
      if (!Array.isArray(value) || value.some(item => !options.includes(item)) || new Set(value).size !== value.length) fail(422, "INVALID_OPTION", "유효한 선택지를 선택해주세요.");
    } else {
      if (typeof value !== "string") fail(422, "INVALID_ANSWER_TYPE", "답변 형식이 올바르지 않습니다.");
      if (["객관식 답변", "드롭다운"].includes(question.type) && !options.includes(value)) fail(422, "INVALID_OPTION", "유효한 선택지를 선택해주세요.");
      if (question.type === "날짜" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) fail(422, "INVALID_DATE", "유효한 날짜를 입력해주세요.");
      if (question.type === "단문형 답변" && value.length > 1000) fail(422, "ANSWER_TOO_LONG", "단문 답변은 1000자까지 입력할 수 있습니다.");
      if (question.subjectRole === "name" && !subjectName.safeParse(value).success) fail(422, "INVALID_SUBJECT_NAME", "정보주체 이름은 1~100자로 입력해주세요.");
      if (question.subjectRole === "email" && !subjectEmail.safeParse(value).success) fail(422, "INVALID_SUBJECT_EMAIL", "정보주체 이메일 형식을 확인해주세요.");
      if (question.validationKind === "email" && !z.email().safeParse(value.trim()).success) fail(422, "INVALID_EMAIL", "이메일 형식을 확인해주세요.");
      if (question.validationKind === "phone" && !/^\+?\d{8,15}$/.test(value.replace(/[\s()-]/g, ""))) fail(422, "INVALID_PHONE", "전화번호 형식을 확인해주세요.");
      if (question.validationKind === "number" && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) fail(422, "INVALID_NUMBER", "숫자 형식을 확인해주세요.");
      if (question.type === "파일 업로드" && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail(422, "INVALID_ATTACHMENT", "업로드를 완료한 파일을 첨부해주세요.");
    }
  }
}
