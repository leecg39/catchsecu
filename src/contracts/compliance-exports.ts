import { z } from "zod";
export const complianceExportInput = z.object({ closeId: z.uuid(), format: z.enum(["pdf", "csv"]) }).strict();
export const complianceExportList = z.object({ closeId: z.uuid(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(10) }).strict();
export const complianceExportChange = z.object({ version: z.number().int().positive() }).strict();
export type ComplianceExportRecord = { id: string; closeId: string; format: string; status: string; version: number; byteLength: number;
  pageCount: number; createdAt: string; expiresAt: string; completedAt: string | null; errorCode: string | null;
  actions: { download: boolean; cancel: boolean; delete: boolean } };
