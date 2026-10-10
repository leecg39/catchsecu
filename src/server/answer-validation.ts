import { specialAnswerError, specialQuestionTypes } from "@/contracts/special-questions";
import { customChoiceTypes, customChoiceAnswerSchema } from "@/contracts/custom-choice";
import { DRAWING_QUESTION_TYPE, drawingAnswerSchema } from "@/contracts/drawing-questions";
import { isInternationalFormLanguage } from "@/contracts/form-language";
import { internationalContactError } from "@/contracts/international-contact";
import { domesticAddressError, foreignAddressError, foreignAddressSchema, normalizeForeignAddress } from "@/contracts/address-questions";
import { subjectEmail, subjectName } from "@/contracts/subjects";
import { z } from "zod";
import { infoPatternAnswerError } from "@/contracts/question-patterns";
import { fail } from "./http";
import { questionTextMaxLength, conditionSchema, rowSchema, selectionLimitsSchema, matrixTypes, emptyAnswer, isEmptyAnswer, visibleQuestionIds, type Answers, type AnswerValue } from "@/contracts/questions";
export type { Answers } from "@/contracts/questions";
type QuestionRule = { stableKey: string; label: string; type: string; required: boolean; subjectRole?: string | null; validationKind?: string; infoPatternId?: number | null; textMaxLength?: number | null;
  condition?: unknown; matrixRows?: unknown; selectionLimits?: unknown; options: { id?: string; stableKey?: string | null; value: string; isCustomValue?: boolean | null }[] };
function checkChoices(value: string[], options: string[], limits: { min?: number; max?: number } | undefined) {
  if (value.some(item => !options.includes(item)) || new Set(value).size !== value.length) fail(422, "INVALID_OPTION", "유효한 선택지를 선택해주세요.");
  if (value.length < (limits?.min ?? 0) || value.length > (limits?.max ?? 100)) fail(422, "SELECTION_COUNT", "선택 항목의 최소·최대 개수를 확인해주세요.");
}
export function validateAnswers(questions: QuestionRule[], answers: Answers, partial = false, baseline?: Answers, formLanguage?: string | null,
  activeQuestionIds?: ReadonlySet<string>): Answers {
  const keys = new Set(questions.map(question => question.stableKey));
  for (const id of Object.keys(answers)) if (!keys.has(id)) fail(422, "UNKNOWN_QUESTION", "폼에 없는 질문의 답변입니다.");
  const normalized = { ...baseline, ...answers };
  const activeQuestions = activeQuestionIds ? questions.filter(question => activeQuestionIds.has(question.stableKey)) : questions;
  const visible = visibleQuestionIds(activeQuestions.map(q => ({ id: q.stableKey, ...(q.condition ? { condition: conditionSchema.parse(q.condition) } : {}) })), normalized);
  for (const question of questions) {
    if (activeQuestionIds && !activeQuestionIds.has(question.stableKey)) {
      if (!isEmptyAnswer(answers[question.stableKey])) fail(422, "UNVISITED_ANSWER", "방문하지 않은 페이지의 질문에는 답변을 제출할 수 없습니다.");
      normalized[question.stableKey] = emptyAnswer(question.type); continue;
    }
    if (!visible.has(question.stableKey)) {
      if (!isEmptyAnswer(answers[question.stableKey])) fail(422, "HIDDEN_ANSWER", "표시되지 않은 질문에는 답변을 제출할 수 없습니다.");
      normalized[question.stableKey] = emptyAnswer(question.type); continue;
    }
    if (partial && !baseline && !(question.stableKey in answers)) continue;
    const value = normalized[question.stableKey], options = question.options.map(option => option.value);
    const limits = question.selectionLimits ? selectionLimitsSchema.parse(question.selectionLimits) : undefined;
    if (customChoiceTypes.includes(question.type)) {
      const customOption = question.options.find(option => option.isCustomValue === true);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const parsed = customChoiceAnswerSchema.safeParse(value);
        if (!parsed.success || !customOption || parsed.data.custom.optionId !== (customOption.stableKey ?? customOption.id)
          || !parsed.data.selectedValues.includes(customOption.value)
          || parsed.data.selectedValues.some(item => !options.includes(item))
          || new Set(parsed.data.selectedValues).size !== parsed.data.selectedValues.length
          || (question.type !== "체크박스" && parsed.data.selectedValues.length !== 1))
          fail(422, "INVALID_CUSTOM_CHOICE", "기타 보기의 선택값·ID와 직접입력 내용을 확인해주세요.");
        if (question.type === "체크박스") checkChoices(parsed.data.selectedValues, options, limits);
        // Only the new structured wire is canonicalized. Keep legacy array order unchanged.
        normalized[question.stableKey] = { kind: "custom-choice", selectedValues: options.filter(item => parsed.data.selectedValues.includes(item)),
          custom: { optionId: parsed.data.custom.optionId, text: parsed.data.custom.text } };
        continue;
      }
      if (customOption && (Array.isArray(value) ? value.includes(customOption.value) : value === customOption.value))
        fail(422, "INVALID_CUSTOM_CHOICE", "기타 보기를 선택하면 직접입력 내용을 함께 제출해주세요.");
    }
    if (question.type === DRAWING_QUESTION_TYPE) {
      if (value === undefined || value === null) {
        if (question.required) fail(422, "REQUIRED_ANSWER", question.label + " 항목을 입력해주세요.");
        normalized[question.stableKey] = null; continue;
      }
      const drawing = drawingAnswerSchema.safeParse(value);
      if (!drawing.success) fail(422, "INVALID_DRAWING", "검사를 완료한 그림 파일 정보를 제출해주세요.");
      // Zod emits the fixed metadata key order; file ownership and metadata are checked under the file lock.
      normalized[question.stableKey] = drawing.data; continue;
    }
    // Null belongs only to DRAW; do not silently coerce a legacy matrix's null to {}.
    if (value === null) fail(422, "INVALID_ANSWER_TYPE", "답변 형식이 올바르지 않습니다.");
    if (question.type === "해외 주소") {
      if (value !== undefined && !foreignAddressSchema.safeParse(value).success) fail(422, "INVALID_ADDRESS", "해외 주소는 지정된 7개 문자열 필드와 유효한 국가로 제출해주세요.");
      const address = normalizeForeignAddress(value);
      if (question.required && isEmptyAnswer(address)) fail(422, "REQUIRED_ANSWER", question.label + " 항목을 입력해주세요.");
      const error = foreignAddressError(address, question.required);
      if (error) fail(422, "INVALID_ADDRESS", error);
      normalized[question.stableKey] = address; continue;
    }
    if (matrixTypes.includes(question.type)) {
      if (value !== undefined && (typeof value !== "object" || Array.isArray(value))) fail(422, "INVALID_ANSWER_TYPE", "행렬 답변은 행별 선택값으로 제출해주세요.");
      const rows = rowSchema.array().parse(question.matrixRows), selected = (value ?? {}) as Record<string, string | string[]>;
      if (Object.keys(selected).some(id => !rows.some(row => row.id === id))) fail(422, "UNKNOWN_MATRIX_ROW", "행렬에 없는 행의 답변입니다.");
      const exactRows = limits?.mode === "exact" && (question.required || !isEmptyAnswer(selected));
      for (const row of rows) {
        const item = selected[row.id];
        if (item !== undefined && ((question.type === "행렬형 복수 선택") !== Array.isArray(item))) fail(422, "INVALID_ANSWER_TYPE", "행별 단일·복수 선택 형식을 확인해주세요.");
        if (question.required && isEmptyAnswer(item)) fail(422, "REQUIRED_ANSWER", question.label + " · " + row.label + " 항목을 입력해주세요.");
        if (exactRows && isEmptyAnswer(item)) fail(422, "SELECTION_COUNT", question.label + " · " + row.label + "에서 정확히 " + limits!.min + "개를 선택해주세요.");
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
      if (question.type === "주소") {
        const error = domesticAddressError(value);
        if (error) fail(422, "INVALID_ADDRESS", error);
        normalized[question.stableKey] = value.trim();
      }

      if (question.subjectRole === "name" && !subjectName.safeParse(value).success) fail(422, "INVALID_SUBJECT_NAME", "정보주체 이름은 1~100자로 입력해주세요.");
      if (question.subjectRole === "email" && !subjectEmail.safeParse(value).success) fail(422, "INVALID_SUBJECT_EMAIL", "정보주체 이메일 형식을 확인해주세요.");
      const specialError = question.type === "연락처" && isInternationalFormLanguage(formLanguage)
        ? internationalContactError(value, question.required) : specialAnswerError(question.type, value);
      if (specialError) fail(422, "INVALID_SPECIAL_ANSWER", specialError);
      const patternError = infoPatternAnswerError(question.infoPatternId, value);
      if (patternError) fail(422, "INVALID_INFO_PATTERN", patternError);
      if (specialQuestionTypes.includes(question.type)) normalized[question.stableKey] = value.trim();
      const maxLength = questionTextMaxLength(question);
      if (maxLength !== undefined && value.length > maxLength) fail(422, "ANSWER_TOO_LONG", question.label + " 답변은 " + maxLength + "자까지 입력할 수 있습니다.");
      if (question.validationKind === "email" && !z.email().safeParse(value.trim()).success) fail(422, "INVALID_EMAIL", "이메일 형식을 확인해주세요.");
      if (question.validationKind === "phone" && !/^\+?\d{8,15}$/.test(value.replace(/[\s()-]/g, ""))) fail(422, "INVALID_PHONE", "전화번호 형식을 확인해주세요.");
      if (question.validationKind === "number" && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) fail(422, "INVALID_NUMBER", "숫자 형식을 확인해주세요.");
      if (question.type === "파일 업로드" && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail(422, "INVALID_ATTACHMENT", "업로드를 완료한 파일을 첨부해주세요.");
    }
  }
  return normalized as Record<string, AnswerValue>;
}
