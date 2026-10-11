import { z } from "zod";
import { questionTypes } from "./questions";
import { formLanguageSchema } from "./form-language";
import { questionPersonalInformationItemSchema, personalInformationTypes, type PersonalInformationType } from "./question-personal-information";

/**
 * Local deterministic personal-information analyzer contract.
 *
 * The original product calls a proprietary NLP service (`company-operated-service/nlp`)
 * when a Korean question title changes; the engine itself is unobserved (U02). This
 * contract mirrors the wire shape — items carry source NLP plus a feedback identifier —
 * while the implementation is a documented local dictionary/rules engine. Automatic
 * analysis runs for Korean (`ko`) forms only; other languages return an empty proposal.
 */
export const NLP_ENGINE_ID = "local-deterministic-v1" as const;

export const nlpAnalyzeInput = z.object({
  formLanguage: formLanguageSchema,
  questionType: z.enum(questionTypes),
  label: z.string().trim().min(1).max(3000),
  optionLabels: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
}).strict();
export type NlpAnalyzeInput = z.infer<typeof nlpAnalyzeInput>;

export const nlpAnalyzedItemSchema = z.object({
  nlpFeedbackId: z.uuid(),
  personalInformationType: z.enum(personalInformationTypes),
  detectedPersonalInformation: z.string().min(1).max(50),
  personalInformationSource: z.literal("NLP"),
}).strict();
export type NlpAnalyzedItem = z.infer<typeof nlpAnalyzedItemSchema>;

export const nlpAnalyzeResult = z.object({
  engine: z.literal(NLP_ENGINE_ID),
  items: z.array(nlpAnalyzedItemSchema).max(20),
  /** Suggested question type when the top detection implies a dedicated type (RESIDENT→단문형). */
  suggestedType: z.enum(questionTypes).nullable(),
}).strict();
export type NlpAnalyzeResult = z.infer<typeof nlpAnalyzeResult>;

export const nlpFeedbackInput = z.object({
  formLanguage: formLanguageSchema,
  questionType: z.enum(questionTypes),
  label: z.string().trim().min(1).max(3000),
  proposed: z.array(nlpAnalyzedItemSchema).min(1).max(20),
  corrected: z.array(questionPersonalInformationItemSchema).max(20),
}).strict();
export type NlpFeedbackInput = z.infer<typeof nlpFeedbackInput>;

export type PersonalInformationRule = { pattern: RegExp; type: PersonalInformationType; name: string; suggest?: string };
