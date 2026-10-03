import { z } from "zod";
export const accountClosureInput = z.object({
  version: z.number().int().positive(), confirmation: z.email(), password: z.string().min(1).max(128),
  reason: z.string().trim().max(1000).optional(),
}).strict();
export type AccountClosureStatus = {
  version: number; email: string; hasPassword: boolean; platformAdminHandoffRequired: boolean;
  ownedCompanies: { id: string; name: string }[];
};
