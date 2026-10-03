import { z } from "zod";
export const destructionStatuses = ["pending", "scheduled", "running", "retry", "failed", "completed", "cancelled", "rejected"] as const;
export const destructionLabels: Record<typeof destructionStatuses[number], string> = {
  pending: "승인 대기", scheduled: "파기 예약", running: "파기 처리 중", retry: "재시도 대기",
  failed: "처리 실패", completed: "파기 완료", cancelled: "예약 취소", rejected: "반려",
};
export const destructionAction = z.object({ version: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) }).strict();
export const destructionSchedule = destructionAction.extend({ dueAt: z.iso.datetime() });
export const retentionInput = destructionAction.extend({ retentionUntil: z.iso.datetime() });
export type DestructionRecord = {
  id: string; tenantId: string; serviceId: string; submissionId: string; formId: string; formTitle: string;
  source: string; status: typeof destructionStatuses[number]; dueAt: string; createdAt: string; version: number;
  legalHold: boolean; reason: string | null; decision: string | null; requesterId: string | null; approverId: string | null;
  approvedAt: string | null; startedAt: string | null; completedAt: string | null;
  attempts: number; nextAttemptAt: string | null; lastError: string | null; certificateId: string | null;
  permissions: { canApprove: boolean; canReject: boolean; canCancel: boolean; canReschedule: boolean; canRetry: boolean };
};
export type CertificateRecord = {
  id: string; tenantId: string; serviceId: string; submissionId: string; requestId: string;
  scope: string; method: string; counts: Record<string, number>; digest: string; version: number; completedAt: string;
  integrityVerified: boolean; serviceName?: string;
};
export function submissionDataAvailable(row: { status: string; retentionUntil: Date | string; legalHold: boolean }, now = new Date()) {
  return !["destroying", "destroyed"].includes(row.status) && (row.legalHold || new Date(row.retentionUntil) > now);
}
