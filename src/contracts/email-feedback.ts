import { z } from "zod";
export const feedbackKinds = ["delivered", "soft_bounce", "hard_bounce", "complaint", "unsubscribed"] as const;
export type FeedbackKind = typeof feedbackKinds[number];
export const feedbackLabels: Record<FeedbackKind, string> = { delivered: "전달 확인", soft_bounce: "일시 반송", hard_bounce: "영구 반송", complaint: "스팸 신고", unsubscribed: "수신 거부" };
export const relayFeedback = z.object({ eventId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/), jobId: z.uuid(),
  type: z.enum(["delivered", "soft_bounce", "hard_bounce", "complaint"]), occurredAt: z.iso.datetime({ offset: true }) }).strict();
export const suppressionQuery = z.object({ serviceId: z.uuid(), search: z.string().trim().max(254).default(""),
  reason: z.enum(["all", "soft_bounce", "hard_bounce", "complaint", "unsubscribed"]).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export type FeedbackSummary = { outcome: FeedbackKind; occurredAt: string; source: "relay" | "recipient"; count: number };
export type SuppressionRecord = { id: string; contact: string | null; name: string | null; reason: Exclude<FeedbackKind, "delivered">; createdAt: string };
export type UnsubscribeInfo = { company: string; service: string; unsubscribed: boolean };
