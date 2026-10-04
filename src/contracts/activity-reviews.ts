import { z } from "zod";
export const reviewStatuses = ["requested", "responded", "resolved", "cancelled"] as const;
export const reviewCreate = z.object({ auditEventId: z.uuid(), title: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(4000) }).strict();
export const reviewAction = z.object({ version: z.number().int().positive(), action: z.enum(["response", "resolve", "cancel"]), message: z.string().trim().min(1).max(4000) }).strict();
export const reviewNotify = z.object({ version: z.number().int().positive() }).strict();
export const reviewQuery = z.object({ scope: z.enum(["received", "sent", "company"]).default("received"), status: z.enum(["all", ...reviewStatuses]).default("all"),
  serviceId: z.uuid().optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  search: z.string().trim().max(100).default(""), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(v => !v.from || !v.to || new Date(v.from) <= new Date(v.to), { path: ["to"], message: "종료일시는 시작일시 이후여야 합니다." });
export type ReviewRecord = { id: string; serviceId: string; serviceName: string; auditEventId: string; action: string; title: string; status: typeof reviewStatuses[number]; version: number;
  requesterName: string; recipientName: string; createdAt: string; respondedAt: string | null; closedAt: string | null };
export type ReviewDetail = ReviewRecord & { canRespond: boolean; canClose: boolean; canNotify: boolean; notification: { status: string; createdAt: string; completedAt: string | null } | null; messages: { id: string; kind: string; authorName: string; body: string; createdAt: string }[] };
export type ReviewList = { items: ReviewRecord[]; total: number; page: number; pageSize: number };
