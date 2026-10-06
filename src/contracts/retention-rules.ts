import { z } from "zod";

const days = z.number().int().min(1).max(36500);
export const retentionRuleCreate = z.object({
  serviceId: z.uuid(),
  retentionDays: days,
  reason: z.string().trim().min(1).max(1000),
}).strict();
export const retentionRulePatch = z.object({
  version: z.number().int().positive(),
  retentionDays: days.optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().refine(input => input.retentionDays !== undefined || input.reason !== undefined,
  "변경할 보유 기간 또는 사유를 입력해주세요.");
export const retentionRuleList = z.object({
  serviceId: z.uuid().optional(),
  status: z.enum(["active", "archived"]).default("active"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
