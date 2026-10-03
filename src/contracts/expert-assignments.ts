export type ExpertAssignmentRecord = {
  id: string; companyId: string; companyName: string; expertUserId: string; expertName: string; expertEmail: string;
  status: "active" | "expired" | "revoked" | "unavailable"; version: number; expiresAt: string;
  createdAt: string; revokedAt: string | null; canSelect: boolean;
  services: { id: string; name: string; status: string }[];
};
export type ExpertAssignmentList = { items: ExpertAssignmentRecord[]; total: number; page: number; pageSize: number };
export type ExpertOptions = { companies: { id: string; name: string }[]; services: { id: string; name: string }[] };
export const expertStatusLabels = { active: "활성", expired: "만료", revoked: "회수", unavailable: "사용 불가" } as const;
