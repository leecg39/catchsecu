import { z } from "zod";
import type { FeatureAccess } from "./feature-entitlements";
const description = z.string().trim().max(500).refine(v => !/[\u0000-\u001f\u007f]/.test(v), "제어 문자는 사용할 수 없습니다.");
export const ipRuleInput = z.object({ tenantId: z.uuid(), cidr: z.string().trim().min(1).max(80), description: description.default(""), enabled: z.boolean().default(true) }).strict();
export const ipRulePatch = ipRuleInput.extend({ version: z.number().int().positive() });
export const ipRuleDelete = z.object({ tenantId: z.uuid(), version: z.number().int().positive() }).strict();
export const ipAccessChange = z.object({ tenantId: z.uuid(), version: z.number().int().min(0), enabled: z.boolean(), password: z.string().min(1).max(128) }).strict();
export const ipRuleQuery = z.object({ search: z.string().trim().max(100).default(""), status: z.enum(["all","enabled","disabled"]).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["cidr","createdAt"]).default("createdAt"), direction: z.enum(["asc","desc"]).default("desc") }).strict();
export type IpRuleRecord = { id: string; tenantId: string; cidr: string; description: string; enabled: boolean; version: number; createdAt: string; updatedAt: string };
export type IpAccessRecord = { tenantId: string; enabled: boolean; version: number; currentIp: string | null; canManage: boolean; entitlement: FeatureAccess };
export type IpRulePage = { items: IpRuleRecord[]; total: number; page: number; pageSize: number; policy: IpAccessRecord };
