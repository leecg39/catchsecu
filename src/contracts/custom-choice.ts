import { z } from "zod";

export const customChoiceTypes: readonly string[] = ["객관식 답변", "체크박스", "드롭다운"];
export const MAX_CUSTOM_CHOICE_TEXT_LENGTH = 100;
export const MAX_CUSTOM_CHOICE_LABEL_LENGTH = 250;
export function validCustomChoiceText(value: string, limit: number): boolean {
  return value.length <= limit && !!value.trim() && !value.includes("\0")
    && new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
}
export const customChoiceAnswerSchema = z.object({
  kind: z.literal("custom-choice"),
  selectedValues: z.array(z.string().min(1).max(500)).min(1).max(100),
  custom: z.object({ optionId: z.uuid(), text: z.string()
    .refine(value => validCustomChoiceText(value, MAX_CUSTOM_CHOICE_TEXT_LENGTH), "직접입력은 공백을 제외한 내용을 포함해 100자 이내로 입력해주세요.")
    .meta({ "x-max-utf16-length": MAX_CUSTOM_CHOICE_TEXT_LENGTH, description: "Literal custom text; preserve whitespace. Reject NUL and unpaired UTF-16 surrogates." }),
  }).strict(),
}).strict();
export type CustomChoiceAnswer = z.infer<typeof customChoiceAnswerSchema>;
export function isCustomChoiceAnswer(value: unknown): value is CustomChoiceAnswer {
  return customChoiceAnswerSchema.safeParse(value).success;
}
/** Reads selections from UI's incomplete text state too. It deliberately does NOT validate
 * the submitted shape, question type, option ownership or required custom text. */
export function selectedChoiceValues(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object" && "kind" in value && value.kind === "custom-choice"
    && "selectedValues" in value && Array.isArray(value.selectedValues))
    return value.selectedValues.filter((item): item is string => typeof item === "string");
  return [];
}
