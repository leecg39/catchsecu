import { z } from "zod";
export const versionSchema = z.number().int().positive();
export const serviceInput = z.object({
  name: z.string().trim().min(1).max(100),
  externalName: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  type: z.enum(["website", "app", "offline", "other"]).optional(),
}).strict();
export const servicePatch = serviceInput.partial().extend({
  version: versionSchema, status: z.enum(["active", "archived"]).optional(),
}).strict();
export const companyInput = z.object({
  name: z.string().trim().min(1).max(100),
  publicName: z.string().trim().min(1).max(100),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(30).optional(),
  website: z.union([z.url().refine(url => { try { return ["https:", "http:"].includes(new URL(url).protocol); } catch { return false; } }), z.literal("")]).optional(),
  businessNo: z.string().regex(/^(\d{3}-\d{2}-\d{5})?$/).optional(),
  billingEmail: z.union([z.email(), z.literal("")]).optional(),
  billingContactName: z.string().trim().max(100).optional(),
  billingContactPhone: z.string().trim().max(30).optional(),
}).strict();
export const profilePatch = z.object({
  version: versionSchema,
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
  department: z.string().trim().max(100).optional(),
  jobTitle: z.string().trim().max(100).optional(),
  locale: z.enum(["ko", "en", "ja"]).optional(),
}).strict();
