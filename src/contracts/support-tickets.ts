import { z } from "zod";

export const supportTicketId = z.string().uuid();
export const supportTicketList = z.object({
  scope: z.enum(["mine", "admin"]).default("mine"),
  kind: z.enum(["inquiry", "suggestion"]).optional(),
  status: z.enum(["submitted", "answered", "closed", "archived"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const supportTicketCreate = z.object({
  kind: z.enum(["inquiry", "suggestion"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  serviceId: z.string().uuid().nullable().optional(),
}).strict();
export const supportTicketPatch = z.object({
  version: z.number().int().positive(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
}).strict().refine(value => value.subject !== undefined || value.body !== undefined, "변경할 내용을 입력해주세요.");
export const supportTicketReply = z.object({
  version: z.number().int().positive(),
  reply: z.string().trim().min(1).max(10000),
}).strict();
export const supportTicketVersion = z.object({ version: z.number().int().positive() }).strict();

export type SupportTicketStatus = "submitted" | "answered" | "closed" | "archived";
export type SupportTicketKind = "inquiry" | "suggestion";
export type SupportTicketSummary = {
  id: string; kind: SupportTicketKind; status: SupportTicketStatus;
  subject: string | null; tenantId: string; tenantName: string;
  serviceId: string | null; serviceName: string | null;
  authorId: string; authorName: string; authorEmail: string;
  answeredAt: string | null; closedAt: string | null;
  version: number; createdAt: string; updatedAt: string;
};
export type SupportTicketRecord = SupportTicketSummary & {
  body: string | null; reply: string | null; answeredByName: string | null;
};
export type SupportTicketListResponse = { items: SupportTicketSummary[]; total: number; page: number; pageSize: number };
