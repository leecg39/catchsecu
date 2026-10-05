import type { FeedbackSummary } from "./email-feedback";
import type { FileInfo } from "./files";
import { z } from "zod";
export const CAMPAIGN_MAIL_JOB_TYPE = "mail.campaign.v3";
export const CAMPAIGN_MAIL_JOB_TYPES = ["mail.campaign.v1", "mail.campaign.v2", CAMPAIGN_MAIL_JOB_TYPE];
export const MAX_CAMPAIGN_RECIPIENTS = 1000;
export const campaignChannel = z.enum(["email", "sms", "kakao"]);
export { messageContent as campaignContent } from "./message-content";
import { messageContent as campaignContent, messageTitle as title } from "./message-content";
export type CampaignContent = z.infer<typeof campaignContent>;
export const campaignCreate = z.object({ serviceId: z.uuid(), channel: campaignChannel, source: z.enum(["direct", "form"]), title,
  senderId: z.uuid().nullable().default(null), kakaoTemplateId: z.uuid().nullable().default(null), content: campaignContent }).strict();
export const campaignVersion = z.object({ version: z.number().int().positive() }).strict();
export const campaignPatch = campaignCreate.omit({ serviceId: true, channel: true, source: true }).extend(campaignVersion.shape).strict();
export const campaignTargets = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("direct"), version: z.number().int().positive(), contacts: z.array(z.string().trim().min(1).max(254)).max(MAX_CAMPAIGN_RECIPIENTS) }).strict(),
  z.object({ mode: z.literal("selection"), version: z.number().int().positive(), preferenceIds: z.array(z.uuid()).max(MAX_CAMPAIGN_RECIPIENTS) }).strict(),
  z.object({ mode: z.literal("csv"), version: z.number().int().positive(), csv: z.string().min(1).max(300000) }).strict(),
]);
export const campaignSchedule = campaignVersion.extend({ at: z.iso.datetime({ offset: true }).nullable(), excludeInvalid: z.boolean().default(false) }).strict();
export const campaignReschedule = campaignVersion.extend({ at: z.iso.datetime({ offset: true }) }).strict();
export const campaignRetry = campaignVersion.extend({ ids: z.array(z.uuid()).min(1).max(100) }).strict();
export const campaignList = z.object({ serviceId: z.uuid(), channel: campaignChannel, page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(200).default(""),
  status: z.enum(["all", "draft", "scheduled", "dispatching", "completed", "partial_failed", "failed", "cancelled", "deleted", "expired"]).default("all"),
  archived: z.enum(["false", "true"]).default("false"), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() }).strict();
export const deliveryList = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["all", "draft", "queued", "sending", "local_delivered", "accepted", "unknown", "excluded", "failed", "cancelled"]).default("all") }).strict();
export const campaignSourceList = z.object({ serviceId: z.uuid(), channel: campaignChannel, formId: z.uuid().optional(), search: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export const campaignStatuses: Record<string, string> = { draft: "초안", scheduled: "예약", dispatching: "처리 중", completed: "처리 완료", partial_failed: "일부 미발송", failed: "발송 실패", cancelled: "취소", deleted: "삭제", expired: "보관 종료" };
export const deliveryStatuses: Record<string, string> = { draft: "검증 대기", queued: "예약 대기", sending: "처리 중", local_delivered: "로컬 메일함 전달", accepted: "SMTP 접수", unknown: "결과 확인 필요", excluded: "발송 제외", failed: "실패", cancelled: "취소" };
export const deliveryReasons: Record<string, string> = { EMAIL_SUPPRESSED: "이메일 반송·신고·수신거부로 차단", INVALID_CONTACT: "주소·번호 형식 오류", CONSENT_REQUIRED: "등록된 동의 없음", WITHDRAWN: "동의 철회 또는 발송 제외", SOURCE_UNAVAILABLE: "원본 응답 사용 종료", CONSENT_CHANGED: "동의 근거가 변경됨", VARIABLE_MISSING: "변수에 필요한 값 없음", SENDER_UNAVAILABLE: "발신자 인증·버전 확인 필요", TEMPLATE_UNAVAILABLE: "승인된 알림톡 템플릿과 확인된 채널이 필요합니다", KAKAO_PROVIDER_REQUIRED: "알림톡 발송 공급자를 연결한 뒤 발송할 수 있습니다", CANCELLED: "캠페인 취소", DATA_ERASED: "원문 보관 종료", DELIVERY_FAILED: "전달 실패", DELIVERY_UNCERTAIN: "공급자 접수 여부 확인 필요", PERMISSION_REVOKED: "발송 담당자 권한 종료", SERVICE_UNAVAILABLE: "서비스 사용 종료", ATTACHMENT_UNAVAILABLE: "첨부파일 무결성·보관 상태 확인 필요" };
export type CampaignRecord = { id: string; serviceId: string; channel: "email" | "sms" | "kakao"; source: "direct" | "form"; title: string; content: CampaignContent | null; status: string; senderId: string | null; senderVersion: number | null; kakaoTemplateId: string | null; kakaoTemplateVersion: number | null;
  files: FileInfo[]; messageTemplateId: string | null; messageTemplateVersion: number | null; version: number; scheduledAt: string | null; requestedAt: string | null; completedAt: string | null; archivedAt: string | null; expiresAt: string; createdAt: string; updatedAt: string; creator: string; total: number; counts: Record<string, number>; events?: { version: number; kind: string; createdAt: string }[] };
export type DeliveryRecord = { id: string; position: number; contact: string | null; name: string | null; preferenceId: string | null; sourceSubmissionId: string | null; status: string; reason: string | null; attempt: number; acceptedAt: string | null; erasedAt: string | null; feedback: FeedbackSummary | null };
export type CampaignPreview = { campaignId: string; version: number; eligible: number; excluded: number; total: number; senderReady: boolean; senderReason: string | null; transportReady: boolean; transportReason: string | null;
  attachmentsReady: boolean; attachmentReason: string | null; estimate: { amount: number | null; currency: "KRW"; reason: string; bytes: number }; sample: { subject: string; text: string; html?: string } | null; items: { id: string; reason: string | null }[] };
