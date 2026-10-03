import { z } from "zod";
import { normalizeSubjectEmail, normalizeSubjectName } from "./subjects";
export const marketingChannel = z.enum(["email", "sms"]);
export type MarketingChannel = z.infer<typeof marketingChannel>;
export const marketingConfig = z.object({
  purpose: z.string().trim().min(1).max(3000), nameQuestionId: z.uuid(),
  emailQuestionId: z.uuid().optional(), smsQuestionId: z.uuid().optional(),
}).strict().refine(v => !!v.emailQuestionId || !!v.smsQuestionId, "하나 이상의 연락 채널을 선택해주세요.");
export type MarketingConfig = z.infer<typeof marketingConfig>;
export function validateMarketingConfig(config: MarketingConfig | null | undefined, questions: { id: string; type: string }[]) {
  if (!config) return;
  const ids = [config.nameQuestionId, config.emailQuestionId, config.smsQuestionId].filter((v): v is string => !!v);
  if (new Set(ids).size !== ids.length || ids.some(id => !questions.some(q => q.id === id && ["단문형 답변", "장문형 답변"].includes(q.type))))
    throw new Error("마케팅 이름과 연락처를 서로 다른 텍스트 질문에 지정해주세요.");
}
export function normalizeMarketingContact(channel: MarketingChannel, value: string) {
  if (channel === "email") return normalizeSubjectEmail(value);
  const phone = value.trim().replace(/[\s()-]/g, "");
  const canonical = /^01[016789]\d{7,8}$/.test(phone) ? "+82" + phone.slice(1) : phone;
  return z.string().regex(/^\+[1-9]\d{7,14}$/, "국가번호를 포함한 전화번호 또는 국내 휴대전화번호를 입력해주세요.").parse(canonical);
}
export { normalizeSubjectName as normalizeMarketingName };
export const marketingCreate = z.object({
  serviceId: z.uuid(), submissionId: z.uuid(), channel: marketingChannel, nameQuestionId: z.uuid(), contactQuestionId: z.uuid(),
  grantedAt: z.iso.datetime({ offset: true }), purpose: z.string().trim().min(1).max(3000),
  reference: z.string().trim().min(5).max(1000), attested: z.literal(true),
}).strict();
export const marketingChange = z.object({ version: z.number().int().positive(), excluded: z.boolean() }).strict();
export const marketingVersions = z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).min(1).max(100)
  .refine(v => new Set(v.map(r => r.id)).size === v.length, "중복된 항목입니다.");
export const marketingList = z.object({
  serviceId: z.uuid(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(254).default(""), channel: marketingChannel.optional(),
  status: z.enum(["granted", "withdrawn", "erased"]).optional(), excluded: z.enum(["true", "false"]).optional(),
}).strict();
export const marketingSummaryQuery = z.object({
  search: z.string().trim().max(100).default(""), serviceId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(value => !value.from || !value.to || new Date(value.from) < new Date(value.to),
  { path: ["to"], message: "종료 시각은 시작 시각 이후여야 합니다." });
export type MarketingSummaryQuery = z.infer<typeof marketingSummaryQuery>;
export type MarketingRecord = {
  id: string; serviceId: string; version: number; channel: MarketingChannel; name: string | null; contact: string | null;
  status: "granted" | "withdrawn" | "erased"; excluded: boolean; grantedAt: string; withdrawnAt: string | null;
  sourceSubmissionId: string; sourceTitle: string; sourceKind: string; retentionUntil: string; available: boolean; eligible: boolean; denial: string | null;
  evidence?: { purpose: string; reference: string; grantedAt: string; sourceKind: string } | null;
  events?: { id: string; kind: string; version: number; createdAt: string }[];
};
export type MarketingSource = { id: string; title: string; createdAt: string; retentionUntil: string; questions: { id: string; label: string; value: string }[] };
export type MarketingSummary = {
  asOf: string; period: { from: string; to: string };
  items: { id: string; name: string; granted: number; withdrawn: number; erased: number;
    excluded: number; eligible: number; suppressed: number; total: number;
    periodGrants: number; periodWithdrawals: number; periodErasures: number }[];
};
export const marketingStatus = { granted: "동의", withdrawn: "철회", erased: "삭제" };
export const marketingEventLabel: Record<string, string> = { granted: "동의 등록", reconsented: "새 근거로 재동의", excluded: "발송 제외", included: "발송 제외 해제", withdrawn: "동의 철회", erased: "개인정보 삭제", source_withdrawn: "원본 응답 동의 철회", source_unavailable: "원본 응답 파기 절차 시작", source_corrected: "원본 연락처 정정으로 이전 동의 삭제" };
