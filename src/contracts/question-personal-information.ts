import { z } from "zod";

export const MAX_QUESTION_PERSONAL_INFORMATION = 20;
export const MAX_PERSONAL_INFORMATION_NAME_LENGTH = 50;
export const personalInformationTypes = ["PERSONAL_INFORMATION", "SENSITIVE", "IDENTIFICATION", "RESIDENT", "NON_PERSONAL_INFORMATION"] as const;
export type PersonalInformationType = typeof personalInformationTypes[number];
const nameSchema = z.string()
  .refine(value => value.length <= MAX_PERSONAL_INFORMATION_NAME_LENGTH, "개인정보 항목 이름은 50자 이내로 입력해주세요.")
  .refine(value => !value.includes("\u0000") && new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value, "개인정보 항목 이름의 문자 인코딩을 확인해주세요.")
  .meta({ description: "Literal manual classification name; whitespace is preserved. NONE requires exactly empty text and other types require nonempty text after JavaScript trim.", "x-max-utf16-length": MAX_PERSONAL_INFORMATION_NAME_LENGTH });
export const questionPersonalInformationItemSchema = z.object({
  nlpFeedbackId: z.null(),
  personalInformationType: z.enum(personalInformationTypes),
  detectedPersonalInformation: nameSchema,
  personalInformationSource: z.literal("USER"),
}).strict().superRefine((value, ctx) => {
  if (value.personalInformationType === "NON_PERSONAL_INFORMATION" ? value.detectedPersonalInformation !== "" : !value.detectedPersonalInformation.trim())
    ctx.addIssue({ code: "custom", path: ["detectedPersonalInformation"], message: value.personalInformationType === "NON_PERSONAL_INFORMATION"
      ? "개인정보가 아닌 항목의 이름은 빈 문자열이어야 합니다." : "개인정보 항목 이름을 입력해주세요." });
});
export type QuestionPersonalInformation = z.infer<typeof questionPersonalInformationItemSchema>;
export const questionPersonalInformationSchema = z.array(questionPersonalInformationItemSchema).max(MAX_QUESTION_PERSONAL_INFORMATION)
  .meta({ description: "Ordered manual USER classifications; duplicates and NONE mixed with other types are preserved. NLP and feedback IDs are unsupported." });
export function hasResidentPersonalInformation(items?: readonly QuestionPersonalInformation[] | null): boolean {
  return !!items?.some(item => item.personalInformationType === "RESIDENT");
}
/** Shared by request validation and typed server calls, including state after omission merges. */
export function questionPersonalInformationError(question: { type: string; required: boolean; catchFormPersonalInformationRequests?: unknown }): string | undefined {
  if (question.catchFormPersonalInformationRequests === undefined) return;
  const parsed = questionPersonalInformationSchema.safeParse(question.catchFormPersonalInformationRequests);
  if (!parsed.success) return "개인정보 분류의 항목·이름·최대 20개 제한을 확인해주세요.";
  if (["행렬형 단일 선택", "행렬형 복수 선택"].includes(question.type) && parsed.data.some(item => item.personalInformationType !== "NON_PERSONAL_INFORMATION"))
    return "행렬형 질문은 개인정보가 아닌 항목만 지정할 수 있습니다.";
  if (hasResidentPersonalInformation(parsed.data) && !question.required) return "주민등록번호 분류가 있는 질문은 필수로 지정해주세요.";
}
type ClassifiedQuestion = { id: string; catchFormPersonalInformationRequests?: QuestionPersonalInformation[] };
/** Preserve only current same-logical-question metadata. [] removes it and does not consult history. */
export function normalizeQuestionPersonalInformation<T extends ClassifiedQuestion>(questions: T[], previous: ClassifiedQuestion[] = []): T[] {
  const existing = new Map(previous.map(question => [question.id, question.catchFormPersonalInformationRequests]));
  return questions.map(question => {
    const value = question.catchFormPersonalInformationRequests === undefined ? existing.get(question.id) : question.catchFormPersonalInformationRequests;
    const classifications = value === undefined ? undefined : questionPersonalInformationSchema.parse(value);
    const { catchFormPersonalInformationRequests: _classifications, ...rest } = question; void _classifications;
    return { ...rest, ...(classifications?.length ? { catchFormPersonalInformationRequests: classifications } : {}) } as T;
  });
}
