import { z } from "zod";
import { submissionFilters } from "./submissions";

export const createExportInput = z.object({ formId: z.uuid(), filters: submissionFilters.default({ status: "all", search: "" }) }).strict();
export const exportListQuery = z.object({ formId: z.uuid(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export const exportChangeInput = z.object({ version: z.number().int().positive() }).strict();
export const exportStatuses = ["queued", "processing", "ready", "failed", "cancelled", "expired", "invalidated", "deleted"] as const;
export const exportStatusLabels: Record<string, string> = { queued: "대기", processing: "처리 중", ready: "다운로드 가능", failed: "실패", cancelled: "취소", expired: "만료", invalidated: "원천 자료 또는 권한 변경", deleted: "삭제" };
export type ExportRecord = { id: string; formId: string; status: string; version: number; totalRows: number; processedRows: number; byteLength: number; createdAt: string; expiresAt: string; completedAt: string | null; errorCode: string | null; actions: { download: boolean; cancel: boolean; delete: boolean } };
