import { z } from "zod";

export const guideFields = z.object({
  category: z.string().trim().min(1).max(100),
  categoryOrder: z.number().int().min(-1000000).max(1000000),
  title: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(-1000000).max(1000000),
}).strict();
export const guideCreate = guideFields;
export const guidePatch = guideFields.partial().extend({
  version: z.number().int().positive(),
  status: z.enum(["draft", "published"]).optional(),
}).strict();
export const guideList = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  search: z.string().trim().max(100).default(""),
  scope: z.enum(["published", "admin"]).default("published"),
}).strict();
export type GuideRecord = {
  id: string; category: string; categoryOrder: number; title: string; sortOrder: number;
  status: string; fileName: string | null; fileSize: number | null; fileSha256: string | null;
  publishedAt: string | null; version: number; createdAt: string; updatedAt: string;
};
export type GuideListResponse = { items: GuideRecord[]; total: number; page: number; pageSize: number };
