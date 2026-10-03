import { z } from "zod";

export const noticeFields = z.object({
  category: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(200),
  bodyHtml: z.string().trim().min(1).max(100000),
  sortOrder: z.number().int().min(-1000000).max(1000000),
}).strict();
export const noticeCreate = noticeFields.extend({ status: z.enum(["draft", "published"]).default("draft") }).strict();
export const noticePatch = noticeFields.partial().extend({
  version: z.number().int().positive(),
  status: z.enum(["draft", "published"]).optional(),
}).strict();
export const noticeList = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  scope: z.enum(["published", "admin"]).default("published"),
}).strict();
export type NoticeRecord = {
  id: string; category: string; title: string; bodyHtml: string; status: string;
  sortOrder: number; authorName: string; publishedAt: string | null;
  version: number; createdAt: string; updatedAt: string; attachments: NoticeAttachmentRecord[];
};
export type NoticeAttachmentRecord = { id: string; fileName: string; mime: string; fileSize: number;
  fileSha256: string; createdAt: string };
export type NoticeListRecord = Omit<NoticeRecord, "bodyHtml" | "attachments">;
export type NoticeListResponse = { items: NoticeListRecord[]; total: number; page: number; pageSize: number };
