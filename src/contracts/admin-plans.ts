import { z } from "zod";
import { planCapabilities } from "./feature-entitlements";

const limit = z.number().int().nonnegative().max(100000000).nullable().optional();
export const planVersionInput = z.object({
  number: z.number().int().positive().max(1000000),
  cycle: z.enum(["month", "year"]),
  priceKrw: z.number().int().nonnegative().max(2147483647).nullable().optional(),
  currency: z.literal("KRW").default("KRW"),
  serviceLimit: limit,
  memberLimit: limit,
  subjectLimit: limit,
  formLimit: limit,
  features: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  capabilities: planCapabilities,
  orderable: z.boolean().default(false),
  effectiveFrom: z.iso.datetime().optional(),
  effectiveTo: z.iso.datetime().nullable().optional(),
}).strict().refine(input => !input.orderable || input.priceKrw != null,
  { path: ["priceKrw"], message: "주문 가능한 버전에는 가격이 필요합니다." });
export const adminPlanCreate = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "소문자 영숫자와 하이픈만 사용할 수 있습니다."),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(""),
  version: planVersionInput,
}).strict();
export const adminPlanPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  version: planVersionInput.optional(),
}).strict().refine(input => input.name !== undefined || input.description !== undefined || input.version !== undefined,
  "변경할 이름·설명 또는 새 버전을 입력해주세요.");
