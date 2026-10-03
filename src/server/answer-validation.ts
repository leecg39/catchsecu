import { subjectEmail, subjectName } from "@/contracts/subjects";
import { z } from "zod";
import { fail } from "./http";
import { conditionSchema, rowSchema, selectionLimitsSchema, matrixTypes, emptyAnswer, isEmptyAnswer, visibleQuestionIds, type Answers, type AnswerValue } from "@/contracts/questions";
export type { Answers } from "@/contracts/questions";
type QuestionRule = { stableKey: string; label: string; type: string; required: boolean; subjectRole?: string | null; validationKind?: string;
  condition?: unknown; matrixRows?: unknown; selectionLimits?: unknown; options: { value: string }[] };
function checkChoices(value: string[], options: string[], limits: { min?: number; max?: number } | undefined) {
  if (value.some(item => !options.includes(item)) || new Set(value).size !== value.length) fail(422, "INVALID_OPTION", "유효한 선택지를 선택해주세요.");
  if (value.length < (limits?.min ?? 0) || value.length > (limits?.max ?? 100)) fail(422, "SELECTION_COUNT", "선택 항목의 최소·최대 개수를 확인해주세요.");
}
export function validateAnswers(questions: QuestionRule[], answers: Answers, partial = false, baseline?: Answers): Answers {
  const keys = new Set(questions.map(question => question.stableKey));
  for (const id of Object.keys(answers)) if (!keys.has(id)) fail(422, "UNKNOWN_QUESTION", "폼에 없는 질문의 답변입니다.");
  const normalized = { ...baseline, ...answers };
  const visible = visibleQuestionIds(questions.map(q => ({ id: q.stableKey, ...(q.condition ? { condition: conditionSchema.parse(q.condition) } : {}) })), normalized);
  for (const question of questions) {
    if (!visible.has(question.stableKey)) {
      if (!isEmptyAnswer(answers[question.stableKey])) fail(422, "HIDDEN_ANSWER", "표시되지 않은 질문에는 답변을 제출할 수 없습니다.");
      normalized[question.stableKey] = emptyAnswer(question.type); continue;
    }
    if (partial && !baseline && !(question.stableKey in answers)) continue;
    const value = normalized[question.stableKey], options = question.options.map(option => option.value);
    const limits = question.selectionLimits ? selectionLimitsSchema.parse(question.selectionLimits) : undefined;
    if (matrixTypes.includes(question.type)) {
      if (value !== undefined && (typeof value !== "object" || Array.isArray(value))) fail(422, "INVALID_ANSWER_TYPE", "행렬 답변은 행별 선택값으로 제출해주세요.");
      const rows = rowSchema.array().parse(question.matrixRows), selected = (value ?? {}) as Record<string, string | string[]>;
      if (Object.keys(selected).some(id => !rows.some(row => row.id === id))) fail(422, "UNKNOWN_MATRIX_ROW", "행렬에 없는 행의 답변입니다.");
      for (const row of rows) {
        const item = selected[row.id];
        if (item !== undefined && ((question.type === "행렬형 복수 선택") !== Array.isArray(item))) fail(422, "INVALID_ANSWER_TYPE", "행별 단일·복수 선택 형식을 확인해주세요.");
        if (question.required && isEmptyAnswer(item)) fail(422, "REQUIRED_ANSWER", question.label + " · " + row.label + " 항목을 입력해주세요.");
        if (isEmptyAnswer(item)) continue;
        if (Array.isArray(item)) checkChoices(item, options, limits);
        else if (!options.includes(item)) fail(422, "INVALID_OPTION", "유효한 행렬 선택지를 선택해주세요.");
      }
      normalized[question.stableKey] = selected; continue;
    }
    if (value !== undefined && typeof value === "object" && !Array.isArray(value)) fail(422, "INVALID_ANSWER_TYPE", "답변 형식이 올바르지 않습니다.");
    if (value !== undefined && ((question.type === "체크박스") !== Array.isArray(value))) fail(422, "INVALID_ANSWER_TYPE", "답변 형식이 올바르지 않습니다.");
    const empty = isEmptyAnswer(value);
    if (question.required && empty) fail(422, "REQUIRED_ANSWER", question.label + " 항목을 입력해주세요.");
    if (empty) { normalized[question.stableKey] = emptyAnswer(question.type); continue; }
    if (question.type === "체크박스") {
      if (!Array.isArray(value)) fail(422, "INVALID_ANSWER_TYPE", "복수 선택 답변을 제출해주세요.");
      checkChoices(value, options, limits);
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
  return normalized as Record<string, AnswerValue>;
}
