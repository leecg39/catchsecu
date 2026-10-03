export type AccessRequestRecord = {
  id: string; serviceId: string; serviceName: string; serviceStatus: string;
  requesterId: string; requesterName: string; requesterEmail: string; requesterRole: string; requesterStatus: string;
  reason: string; status: "pending" | "approved" | "rejected" | "cancelled"; version: number;
  decisionNote: string; reviewerName: string | null; createdAt: string; resolvedAt: string | null;
};
export type AccessRequestList = { items: AccessRequestRecord[]; total: number; page: number; pageSize: number;
  availableServices: { id: string; name: string }[]; pendingCount: number };
export const accessStatusLabels = { pending: "검토 대기", approved: "승인", rejected: "거절", cancelled: "취소" } as const;
