import { z } from "zod";

export const questionTypes = ["단문형 답변", "장문형 답변", "객관식 답변", "체크박스", "드롭다운", "날짜", "파일 업로드", "행렬형 단일 선택", "행렬형 복수 선택"] as const;
export const matrixTypes: readonly string[] = ["행렬형 단일 선택", "행렬형 복수 선택"];
export const choiceTypes: readonly string[] = ["객관식 답변", "체크박스", "드롭다운", ...matrixTypes];
export const conditionSchema = z.object({ questionId: z.uuid(), operator: z.enum(["equals", "includes"]), value: z.string().trim().min(1).max(500) }).strict();
export const rowSchema = z.object({ id: z.uuid(), label: z.string().trim().min(1).max(500) }).strict();
export const selectionLimitsSchema = z.object({ min: z.number().int().min(0).max(100).optional(), max: z.number().int().min(1).max(100).optional() }).strict()
  .refine(value => value.min !== undefined || value.max !== undefined, "최소 또는 최대 선택 수를 입력해주세요.")
  .refine(value => (value.min ?? 0) <= (value.max ?? 100), "최소 선택 수는 최대 선택 수 이하여야 합니다.");
export const questionSchema = z.object({ id: z.uuid(), type: z.enum(questionTypes), label: z.string().trim().min(1).max(3000), required: z.boolean(),
  subjectRole: z.enum(["name", "email"]).optional(), options: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  condition: conditionSchema.optional(), rows: z.array(rowSchema).min(1).max(100).optional(), selectionLimits: selectionLimitsSchema.optional(),
}).strict();
export type QuestionDefinition = z.infer<typeof questionSchema>;
export type MatrixRows = z.infer<typeof rowSchema>[];
export type AnswerValue = string | string[] | Record<string, string | string[]>;
export type Answers = Record<string, AnswerValue>;
const matrixAnswer = z.record(z.uuid(), z.union([z.string().max(1000), z.array(z.string().max(1000)).max(100)]))
  .refine(value => Object.keys(value).length <= 100, "행렬 답변은 100행까지 입력할 수 있습니다.").meta({ maxProperties: 100 });
export const answersSchema = z.record(z.uuid(), z.union([z.string().max(20000), z.array(z.string().max(1000)).max(100), matrixAnswer]));

export function validateQuestionDefinitions(questions: QuestionDefinition[], publishing = false, alwaysVisibleIds: string[] = []) {
  const seen = new Map<string, QuestionDefinition>();
  for (const question of questions) {
    if (seen.has(question.id)) throw new Error("질문 ID가 중복되었습니다.");
    if (question.options && new Set(question.options).size !== question.options.length) throw new Error("선택지가 중복되었습니다.");
    if (publishing && choiceTypes.includes(question.type) && !question.options?.length) throw new Error("선택형 질문에 선택지를 입력해주세요.");
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
      if (question.subjectRole || alwaysVisibleIds.includes(question.id)) throw new Error("정보주체·마케팅 이름과 연락처는 항상 표시해야 합니다.");
    }
    seen.set(question.id, question);
  }
}
export function visibleQuestionIds(questions: Pick<QuestionDefinition, "id" | "condition">[], answers: Answers) {
  const visible = new Set<string>();
  for (const question of questions) {
    const condition = question.condition, value = condition ? answers[condition.questionId] : undefined;
    if (!condition || (visible.has(condition.questionId) && (condition.operator === "equals" ? value === condition.value : Array.isArray(value) && value.includes(condition.value))))
      visible.add(question.id);
  }
  return visible;
}
export function emptyAnswer(type: string): AnswerValue { return type === "체크박스" ? [] : matrixTypes.includes(type) ? {} : ""; }
export function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value).every(item => Array.isArray(item) ? item.length === 0 : !item.trim());
}
export function formatAnswer(value: AnswerValue | undefined, rows?: MatrixRows): string {
  if (isEmptyAnswer(value)) return "-";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  const entries = rows ? rows.filter(row => row.id in value!).map(row => [row.id, value![row.id]] as const) : Object.entries(value!);
  return entries.map(([id, answer]) => (rows?.find(row => row.id === id)?.label ?? id) + ": " + (Array.isArray(answer) ? answer.join(", ") : answer || "-")).join(" / ");
}
