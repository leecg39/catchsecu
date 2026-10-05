import { marketingConfig, marketingChannel, validateMarketingConfig } from "./marketing";
import { z } from "zod";
import { checkSubjectQuestions } from "./subjects";
import { questionSchema, answersSchema, validateQuestionDefinitions } from "./questions";
import { formDocumentSelections } from "./form-documents";
import { submissionVerification } from "./verification";

export { questionSchema } from "./questions";
export const formContentSchema = z.object({
  body: z.string().max(20000),
  questions: z.array(questionSchema).min(1).max(100),
  verify: z.boolean().optional(),
  font: z.enum(["12px", "14px", "15px", "16px", "20px", "24px", "32px"]).optional(),
  bold: z.boolean().optional(),
  consentRequired: z.boolean(),
  consentPurpose: z.string().max(3000),
  retentionDays: z.number().int().min(1).max(36500).nullable(),
  maxResponses: z.number().int().min(1).max(1000000),
  showSubmitNotice: z.boolean().optional(),
  documentConsents: formDocumentSelections.optional(),
  marketing: marketingConfig.nullable().optional(),
}).strict();
export const formInput = z.object({
  serviceId: z.uuid(), title: z.string().trim().min(1).max(200), content: formContentSchema,
}).strict();
export const submissionInput = z.object({
  answers: answersSchema,
  marketingChannels: z.array(marketingChannel).max(2).refine(v => new Set(v).size === v.length).optional(),
  consent: z.boolean(), marketingConsent: z.boolean().optional(),
  documentConsents: z.array(z.uuid()).max(10).refine(value => new Set(value).size === value.length, "동의 항목이 중복되었습니다.").optional(),
  attachments: z.record(z.uuid(), z.object({ fileId: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()).optional(),
  verification: submissionVerification.optional(),
}).strict();
export const fileInput = z.object({
  name: z.string().trim().min(1).max(200)
    .refine(value => !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\"), "파일 이름에 사용할 수 없는 문자가 있습니다.")
    .refine(value => new TextDecoder().decode(new TextEncoder().encode(value)) === value, "파일 이름의 문자 인코딩을 확인해주세요."),
  mime: z.enum(["application/pdf", "image/png", "image/jpeg", "text/csv", "text/plain"]),
  size: z.number().int().min(1).max(10485760),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const invitationInput = z.object({
  email: z.email(),
  role: z.enum(["admin", "editor", "viewer", "privacy", "sender", "billing", "security", "auditor"]),
  serviceIds: z.array(z.uuid()).min(1).max(100),
}).strict();
export { documentInput } from "./documents";

// Cross-field publication validation stays stricter than draft saving.
export function validateFormForPublish(content: z.infer<typeof formContentSchema>) {
  checkSubjectQuestions(content.questions, true);
  validateMarketingConfig(content.marketing, content.questions);
  validateQuestionDefinitions(content.questions, true, content.marketing ? [content.marketing.nameQuestionId, content.marketing.emailQuestionId, content.marketing.smsQuestionId].filter((id): id is string => !!id) : []);
  const ids = new Set<string>();
  for (const question of content.questions) {
    if (ids.has(question.id)) throw new Error("질문 ID가 중복되었습니다.");
    ids.add(question.id);
    if (["객관식 답변", "체크박스", "드롭다운"].includes(question.type)) {
      if (!question.options?.length) throw new Error("선택형 질문에 선택지를 입력해주세요.");
      if (new Set(question.options).size !== question.options.length) throw new Error("선택지가 중복되었습니다.");
    }
  }
  if (content.consentRequired && !content.consentPurpose.trim()) throw new Error("개인정보 수집·이용 목적을 입력해주세요.");
}
