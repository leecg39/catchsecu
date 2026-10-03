import { z } from "zod";
export const approvalRole = z.enum(["owner", "admin", "security"]);
export const policySettings = z.object({
  minPassword: z.number().int().min(12).max(128),
  passwordMonths: z.number().int().min(0).max(12),
  passwordReuse: z.union([z.literal(0), z.literal(1), z.literal(10)]),
  passwordDeferral: z.enum(["never", "session", "period"]),
  sessionMinutes: z.number().int().min(30).max(120),
  requireMfa: z.boolean(),
  requireApproval: z.boolean(),
  approvalRoles: z.array(approvalRole).min(1).max(3).refine(roles => roles.includes("owner") && new Set(roles).size === roles.length, "최상위 관리자는 승인 담당자에 포함해야 합니다."),
  approvalReferenceRequired: z.boolean(),
  approvalRequestTemplate: z.string().trim().max(4000),
  automaticDestruction: z.boolean(),
  allowRetentionAdjustment: z.boolean(),
}).strict();
export const policyPatch = policySettings.extend({ tenantId: z.uuid(), version: z.number().int().positive(), password: z.string().min(1).max(128) });
export const policyReset = z.object({ tenantId: z.uuid(), version: z.number().int().positive(), password: z.string().min(1).max(128) }).strict();
export const policyDefaults: z.infer<typeof policySettings> = {
  minPassword: 12, passwordMonths: 3, passwordReuse: 1, passwordDeferral: "never",
  sessionMinutes: 30, requireMfa: false, requireApproval: false,
  approvalRoles: ["owner"], approvalReferenceRequired: false, approvalRequestTemplate: "",
  automaticDestruction: false, allowRetentionAdjustment: false,
};
export type PolicyRecord = z.infer<typeof policySettings> & { tenantId: string; version: number; passwordRevision: number; approvalRevision: number; updatedAt: string; canManage: boolean };
export const approvalRequestInput = z.object({
  version: z.number().int().positive(),
  message: z.string().trim().min(1).max(4000),
  reference: z.string().trim().max(200).default(""),
}).strict();
export const approvalDecisionInput = z.object({
  version: z.number().int().positive(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(1).max(4000),
}).strict();
export const approvalCancelInput = z.object({ version: z.number().int().positive() }).strict();
export const approvalStatuses = ["pending", "approved", "rejected", "cancelled", "superseded", "consumed"] as const;
export const approvalStatusLabels: Record<typeof approvalStatuses[number], string> = {
  pending: "승인 대기", approved: "승인 완료", rejected: "반려", cancelled: "요청 취소", superseded: "승인 무효", consumed: "게시 완료",
};

export const passwordDeferralInput = z.object({ tenantId: z.uuid(), passwordRevision: z.number().int().positive() }).strict();
export const passwordChangeInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128), revokeOtherSessions: z.boolean().optional() }).strict();
export const passwordResetInput = z.object({ newPassword: z.string().min(12).max(128), token: z.string().min(16).max(256).optional() }).strict();
export type PasswordPolicyStatus = {
  tenantId: string | null; companyName: string | null; minPassword: number; passwordReuse: number;
  passwordChangedAt: string | null; deadline: string | null; expired: boolean; required: boolean; canDefer: boolean;
  deferralMode: "never" | "session" | "period"; deferredUntil: string | null; passwordMonths: number; passwordRevision: number;
};
