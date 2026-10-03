export const roleLabels = { owner: "소유자", admin: "관리자", editor: "편집자", viewer: "조회자", privacy: "개인정보 담당자", sender: "발송 담당자", billing: "결제 담당자", security: "보안 담당자", auditor: "감사 담당자" } as const;
export type MemberRole = keyof typeof roleLabels;
export type MemberRecord = { id: string; version: number; role: MemberRole; status: string; accessKind: "direct" | "expert"; createdAt: string; user: { id: string; name: string; email: string; department: string | null }; grants: { serviceId: string; serviceName: string; serviceStatus: string; capabilities: string[] }[] };
export type InvitationRecord = { id: string; email: string; role: MemberRole; serviceIds: string[]; status: string; expiresAt: string; version: number; createdAt: string };
export const memberStatuses: Record<string, string> = { active: "활성", suspended: "정지", revoked: "제외" };
export const invitationStatuses: Record<string, string> = { pending: "대기", accepted: "수락", revoked: "취소", expired: "만료" };
