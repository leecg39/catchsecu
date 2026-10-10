import { z } from "zod";
import { questionExplanationSchema } from "./question-explanations";
import { questionMaterialsSchema } from "./question-materials";
import { questionPersonalInformationSchema, questionPersonalInformationError } from "./question-personal-information";
import { emptyForeignAddress, foreignAddressSchema, formatForeignAddress, normalizeForeignAddress } from "./address-questions";
import { DRAWING_QUESTION_TYPE, drawingAnswerSchema, isDrawingAnswer, type DrawingAnswer } from "./drawing-questions";
import { customChoiceAnswerSchema, customChoiceTypes, isCustomChoiceAnswer, selectedChoiceValues, validCustomChoiceText, MAX_CUSTOM_CHOICE_LABEL_LENGTH, type CustomChoiceAnswer } from "./custom-choice";
import { authorAssetKeySchema, optionImageError } from "./author-assets";
import { formDestinationSchema } from "./form-sections";
import { infoPatternError, infoPatternIdSchema } from "./question-patterns";

export const questionTypes = ["단문형 답변", "장문형 답변", "객관식 답변", "체크박스", "드롭다운", "날짜", "파일 업로드", "행렬형 단일 선택", "행렬형 복수 선택", "연락처", "이메일", "이메일 직접 입력", "생년월일", "주소", "해외 주소", DRAWING_QUESTION_TYPE] as const;
export const matrixTypes: readonly string[] = ["행렬형 단일 선택", "행렬형 복수 선택"];
export const choiceTypes: readonly string[] = ["객관식 답변", "체크박스", "드롭다운", ...matrixTypes];
export const conditionSchema = z.object({ questionId: z.uuid(), operator: z.enum(["equals", "includes"]), value: z.string().trim().min(1).max(500), optionId: z.uuid().optional() }).strict();
export const optionDefinitionSchema = z.object({ id: z.uuid(), label: z.string().trim().min(1).max(500), value: z.string().trim().min(1).max(500), isCustomValue: z.boolean().optional(), optionImageKey: authorAssetKeySchema.nullable().optional(), branchDestination: formDestinationSchema.optional() }).strict()
  .refine(option => option.isCustomValue !== true || validCustomChoiceText(option.label, MAX_CUSTOM_CHOICE_LABEL_LENGTH), "기타 보기 이름은 유효한 문자로 250자 이내로 입력해주세요.");
export type OptionDefinition = z.infer<typeof optionDefinitionSchema>;
export const rowSchema = z.object({ id: z.uuid(), label: z.string().trim().min(1).max(500) }).strict();
export const selectionLimitsSchema = z.object({ min: z.number().int().min(0).max(100).optional(), max: z.number().int().min(1).max(100).optional(), mode: z.literal("exact").optional() }).strict()
  .refine(value => value.min !== undefined || value.max !== undefined, "최소 또는 최대 선택 수를 입력해주세요.")
  .refine(value => (value.min ?? 0) <= (value.max ?? 100), "최소 선택 수는 최대 선택 수 이하여야 합니다.")
  .refine(value => value.mode !== "exact" || (value.min !== undefined && value.min > 0 && value.min === value.max), "정확한 선택 수는 최소·최대를 같은 양수로 지정해주세요.");
export const questionSchema = z.object({ id: z.uuid(), pageId: z.uuid().optional(), type: z.enum(questionTypes), label: z.string().trim().min(1).max(3000), required: z.boolean(),
  additionalExplanation: questionExplanationSchema.optional(),
  questionImageKey: authorAssetKeySchema.nullable().optional(),
  materialList: questionMaterialsSchema.optional(),
  catchFormPersonalInformationRequests: questionPersonalInformationSchema.optional(),
  infoPatternId: infoPatternIdSchema.optional(),
  textMaxLength: z.number().int().min(1).max(20000).optional(),
  subjectRole: z.enum(["name", "email"]).optional(), options: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  optionDefinitions: z.array(optionDefinitionSchema).max(100).optional(),
  condition: conditionSchema.optional(), rows: z.array(rowSchema).min(1).max(100).optional(), selectionLimits: selectionLimitsSchema.optional(),
}).strict().superRefine((question, ctx) => {
  const error = questionPersonalInformationError(question);
  if (error) ctx.addIssue({ code: "custom", message: error, path: ["catchFormPersonalInformationRequests"] });
  const patternError = infoPatternError(question.type, question.infoPatternId, question.subjectRole);
  if (patternError) ctx.addIssue({ code: "custom", message: patternError, path: ["infoPatternId"] });
  const imageError = optionImageError(question);
  if (imageError) ctx.addIssue({ code: "custom", message: imageError, path: ["optionDefinitions"] });
});
export type QuestionDefinition = z.infer<typeof questionSchema>;
export type MatrixRows = z.infer<typeof rowSchema>[];
export type AnswerValue = string | string[] | Record<string, string | string[]> | DrawingAnswer | CustomChoiceAnswer | null;
export type Answers = Record<string, AnswerValue>;
const matrixAnswer = z.record(z.uuid(), z.union([z.string().max(1000), z.array(z.string().max(1000)).max(100)]))
  .refine(value => Object.keys(value).length <= 100, "행렬 답변은 100행까지 입력할 수 있습니다.").meta({ maxProperties: 100 });
export const answersSchema = z.record(z.uuid(), z.union([z.string().max(20000), z.array(z.string().max(1000)).max(100), matrixAnswer, foreignAddressSchema, drawingAnswerSchema, customChoiceAnswerSchema, z.null()]));

export function validateQuestionDefinitions(questions: QuestionDefinition[], publishing = false, alwaysVisibleIds: string[] = []) {
  const seen = new Map<string, QuestionDefinition>();
  const optionIds = new Set<string>();
  for (const question of questions) {
    if (!(questionTypes as readonly string[]).includes(question.type)) throw new Error("지원하지 않는 질문 유형입니다.");
    const personalInformationError = questionPersonalInformationError(question);
    if (personalInformationError) throw new Error(personalInformationError);
    const patternError = infoPatternError(question.type, question.infoPatternId, question.subjectRole);
    if (patternError) throw new Error(patternError);
    const imageError = optionImageError(question);
    if (imageError) throw new Error(imageError);
    if (question.questionImageKey != null && !authorAssetKeySchema.safeParse(question.questionImageKey).success)
      throw new Error("문항 이미지의 자산 키를 확인해주세요.");
    if (question.additionalExplanation !== undefined && !questionExplanationSchema.safeParse(question.additionalExplanation).success)
      throw new Error("추가 설명은 유효한 문자로 3000자 이내로 입력해주세요.");
    if (question.materialList !== undefined && !questionMaterialsSchema.safeParse(question.materialList).success)
      throw new Error("참고 자료의 파일·링크·순서와 최대 3개 제한을 확인해주세요.");
    if (seen.has(question.id)) throw new Error("질문 ID가 중복되었습니다.");
    if (question.options && new Set(question.options).size !== question.options.length) throw new Error("선택지가 중복되었습니다.");
    if (!choiceTypes.includes(question.type) && (question.options?.length || question.optionDefinitions?.length))
      throw new Error("보기 설정은 선택형 질문에만 사용할 수 있습니다.");
    if (question.optionDefinitions) {
      if (question.optionDefinitions.length > 100 || question.optionDefinitions.some(option => !optionDefinitionSchema.safeParse(option).success))
        throw new Error("보기의 이름·ID·기타 설정과 최대 100개 제한을 확인해주세요.");
      const custom = question.optionDefinitions.filter(option => option.isCustomValue === true);
      if (custom.some(option => !validCustomChoiceText(option.label, MAX_CUSTOM_CHOICE_LABEL_LENGTH)))
        throw new Error("기타 보기 이름은 유효한 문자로 250자 이내로 입력해주세요.");
      if (custom.length && (!customChoiceTypes.includes(question.type) || custom.length > 1 || question.optionDefinitions.at(-1) !== custom[0]))
        throw new Error("기타 보기는 객관식·체크박스·드롭다운의 마지막에 한 개만 지정해주세요.");
      if (JSON.stringify(question.options ?? []) !== JSON.stringify(question.optionDefinitions.map(option => option.value)))
        throw new Error("보기 정보와 선택값의 순서가 일치하지 않습니다.");
      for (const option of question.optionDefinitions) {
        if (optionIds.has(option.id)) throw new Error("보기 ID가 중복되었습니다.");
        optionIds.add(option.id);
      }
    }
    if (publishing && choiceTypes.includes(question.type) && !question.options?.length) throw new Error("선택형 질문에 선택지를 입력해주세요.");
    if (question.textMaxLength !== undefined && (!textQuestionTypes.includes(question.type) || question.textMaxLength > (question.type === "단문형 답변" ? 1000 : 20000)))
      throw new Error("글자 수 제한은 단문 1~1000자, 장문 1~20000자로 지정해주세요.");
    const matrix = matrixTypes.includes(question.type);
    if (matrix && !question.rows?.length) throw new Error("행렬형 질문에 행을 입력해주세요.");
    if (!matrix && question.rows) throw new Error("행 설정은 행렬형 질문에만 사용할 수 있습니다.");
    if (question.rows && new Set(question.rows.map(row => row.id)).size !== question.rows.length) throw new Error("행 ID가 중복되었습니다.");
    if (question.selectionLimits) {
      if (!["체크박스", "행렬형 복수 선택"].includes(question.type)) throw new Error("선택 수 제한은 복수 선택 질문에 지정해주세요.");
      if ((question.selectionLimits.min ?? 0) > (question.options?.length ?? 0) || (question.selectionLimits.max ?? 0) > (question.options?.length ?? 0))
        throw new Error("선택 수 제한은 선택지 수 이하여야 합니다.");
    }
    if (question.condition) {
      const source = seen.get(question.condition.questionId);
      const expected = question.condition.operator === "includes" ? ["체크박스"] : ["객관식 답변", "드롭다운"];
      if (!source || !expected.includes(source.type) || !source.options?.includes(question.condition.value))
        throw new Error("분기 조건은 앞에 있는 선택형 질문의 유효한 답변에 연결해주세요.");
      if (question.condition.optionId && !source.optionDefinitions?.some(option => option.id === question.condition!.optionId && option.value === question.condition!.value))
        throw new Error("분기 조건의 보기 ID와 선택값이 일치하지 않습니다.");
      if (question.subjectRole || alwaysVisibleIds.includes(question.id)) throw new Error("정보주체·마케팅 이름과 연락처는 항상 표시해야 합니다.");
    }
    seen.set(question.id, question);
  }
}
export function visibleQuestionIds(questions: Pick<QuestionDefinition, "id" | "condition">[], answers: Answers) {
  const visible = new Set<string>();
  for (const question of questions) {
    const condition = question.condition, value = condition ? answers[condition.questionId] : undefined;
    const selected = selectedChoiceValues(value);
    if (!condition || (visible.has(condition.questionId) && (condition.operator === "equals" ? selected.length === 1 && selected[0] === condition.value : selected.includes(condition.value))))
      visible.add(question.id);
  }
  return visible;
}
export function emptyAnswer(type: string): AnswerValue { return type === DRAWING_QUESTION_TYPE ? null : type === "해외 주소" ? emptyForeignAddress() : type === "체크박스" ? [] : matrixTypes.includes(type) ? {} : ""; }
export function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (isDrawingAnswer(value)) return false;
  // Structured custom input is never a blank answer, even when an invalid client omits
  // its selection. Validate/reject it; do not silently discard text behind a hidden branch.
  if ("kind" in value && value.kind === "custom-choice") return false;
  return Object.values(value).every(item => Array.isArray(item) ? item.length === 0 : typeof item === "string" && !item.trim());
}
export function optionLabel(value: string, options?: Pick<OptionDefinition, "label" | "value">[]): string {
  return options?.find(option => option.value === value)?.label ?? value;
}
export function displayOptions(question: Pick<QuestionDefinition, "type" | "options" | "optionDefinitions">): Pick<OptionDefinition, "label" | "value">[] {
  if (!choiceTypes.includes(question.type)) return [];
  return question.optionDefinitions ?? (question.options ?? []).map(value => ({ label: value, value }));
}
export function formatAnswer(value: AnswerValue | undefined, rows?: MatrixRows, options?: Pick<OptionDefinition, "label" | "value">[], questionType?: string): string {
  if (questionType && !choiceTypes.includes(questionType)) options = undefined;
  if (isEmptyAnswer(value)) return "-";
  // File names require file.read and must be rendered from the authorized FileInfo.
  if (questionType === DRAWING_QUESTION_TYPE || isDrawingAnswer(value)) return "첨부파일";
  if (questionType === "해외 주소") return formatForeignAddress(normalizeForeignAddress(value));
  if (isCustomChoiceAnswer(value)) return value.selectedValues.map(item => {
    const custom = options?.find(option => "id" in option && option.id === value.custom.optionId);
    return item === custom?.value ? optionLabel(item, options) + ": " + value.custom.text : optionLabel(item, options);
  }).join(", ") + (options?.some(option => "id" in option && option.id === value.custom.optionId) ? "" : ": " + value.custom.text);
  if (typeof value === "string") return optionLabel(value, options);
  if (Array.isArray(value)) return value.map(item => optionLabel(item, options)).join(", ");
  const matrix = value as Record<string, string | string[]>;
  const entries = rows ? rows.filter(row => row.id in matrix).map(row => [row.id, matrix[row.id]] as const) : Object.entries(matrix);
  return entries.map(([id, answer]) => (rows?.find(row => row.id === id)?.label ?? id) + ": " + (Array.isArray(answer) ? answer.map(item => optionLabel(item, options)).join(", ") : optionLabel(answer || "-", options))).join(" / ");
}

export const textQuestionTypes: readonly string[] = ["단문형 답변", "장문형 답변"];
export function newTextMaxLength(type: string): number | undefined { return type === "단문형 답변" ? 100 : type === "장문형 답변" ? 1000 : undefined; }
export function questionTextMaxLength(question: { type: string; textMaxLength?: number | null }): number | undefined {
  if (!textQuestionTypes.includes(question.type)) return undefined;
  return question.textMaxLength ?? (question.type === "단문형 답변" ? 1000 : 20000);
}
export function answerTextMaxLength(question: { type: string; textMaxLength?: number | null; subjectRole?: string | null }): number | undefined {
  if (!textQuestionTypes.includes(question.type)) return undefined;
  const length = questionTextMaxLength(question)!;
  return Math.min(length, question.subjectRole === "name" ? 100 : question.subjectRole === "email" ? 254 : length);
}
