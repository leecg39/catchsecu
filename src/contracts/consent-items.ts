import { z } from "zod";
import type { QuestionPersonalInformation } from "./question-personal-information";

export const consentItemTypes = ["PERSONAL_INFORMATION", "SENSITIVE", "IDENTIFICATION", "RESIDENT"] as const;
export const MAX_FORM_CONSENT_ITEMS = 2000;
export const consentItemSchema = z.object({
  type: z.enum(consentItemTypes),
  name: z.string().min(1).max(50),
}).strict();
export const consentItemsSchema = z.array(consentItemSchema).max(MAX_FORM_CONSENT_ITEMS)
  .meta({ description: "Version-frozen projection of non-NONE question classifications in question/item order. Duplicates are preserved." });
export type ConsentItem = z.infer<typeof consentItemSchema>;

type ClassifiedQuestion = { catchFormPersonalInformationRequests?: readonly QuestionPersonalInformation[] };

/** Mirrors the source-observed flatMap projection: page/question order, then item order, with NON_PERSONAL_INFORMATION removed. */
export function collectConsentItems(questions: readonly ClassifiedQuestion[]): ConsentItem[] {
  return consentItemsSchema.parse(questions.flatMap(question => (question.catchFormPersonalInformationRequests ?? [])
    .filter(item => item.personalInformationType !== "NON_PERSONAL_INFORMATION")
    .map(item => ({ type: item.personalInformationType, name: item.detectedPersonalInformation }))));
}
export function hasConsentItemReview(questions: readonly ClassifiedQuestion[]): boolean {
  return questions.some(question => question.catchFormPersonalInformationRequests !== undefined);
}
