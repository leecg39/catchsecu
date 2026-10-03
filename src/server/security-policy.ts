import type { z } from "zod";
import type { SecurityPolicy } from "@/generated/prisma/client";
import { policyDefaults, type policySettings } from "@/contracts/security";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail, rateLimit } from "./http";
import { auth } from "./auth";
import { audit } from "./audit";

export function policyDto(policy: SecurityPolicy, ctx: Context) {
  return { tenantId: ctx.tenantId, minPassword: policy.minPassword, passwordMonths: policy.passwordMonths,
    passwordReuse: policy.passwordReuse, passwordDeferral: policy.passwordDeferral, passwordRevision: policy.passwordRevision, sessionMinutes: policy.sessionMinutes, requireMfa: policy.requireMfa, requireApproval: policy.requireApproval,
    approvalRoles: policy.approvalRoles, approvalReferenceRequired: policy.approvalReferenceRequired,
    approvalRequestTemplate: policy.approvalRequestTemplate, approvalRevision: policy.approvalRevision,
    automaticDestruction: policy.automaticDestruction, allowRetentionAdjustment: policy.allowRetentionAdjustment,
    version: policy.version, updatedAt: policy.updatedAt, canManage: ctx.member.role === "owner" };
}
export async function readPolicy(ctx: Context) {
  const policy = await db.securityPolicy.findUnique({ where: { tenantId: ctx.tenantId } });
  if (!policy) fail(404, "NOT_FOUND", "회사 보안 정책을 찾을 수 없습니다.");
  return policyDto(policy, ctx);
}
export async function confirmPassword(ctx: Context, headers: Headers, password: string) {
  await rateLimit("policy-password:" + ctx.user.id, 5);
  try {
    const result = await auth.api.verifyPassword({ headers, body: { password } });
    if (!result.status) fail(401, "INVALID_PASSWORD", "현재 비밀번호를 확인해주세요.");
  } catch { fail(401, "INVALID_PASSWORD", "현재 비밀번호를 확인해주세요."); }
}
export async function lockPolicy(tx: Transaction, tenantId: string) {
  await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId" = ${tenantId} FOR SHARE`;
  const policy = await tx.securityPolicy.findUnique({ where: { tenantId } });
  if (!policy) fail(409, "POLICY_REQUIRED", "회사 보안 정책이 없습니다.");
  return policy;
}
export async function updatePolicy(ctx: Context, version: number, settings: z.infer<typeof policySettings>, requestId: string, reset = false) {
  if (ctx.member.role !== "owner") fail(403, "FORBIDDEN", "최상위 관리자만 회사 보안 정책을 변경할 수 있습니다.");
  return db.$transaction(async tx => {
    // Use the same company lock as member removal and ownership transfer.
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${ctx.tenantId} FOR UPDATE`;
    const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, role: "owner", status: "active" } });
    if (!member) fail(403, "FORBIDDEN", "최상위 관리자 권한이 필요합니다.");
    await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    const current = await tx.securityPolicy.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
    if (current.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 정책을 불러와주세요.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (settings.requireMfa && !user.twoFactorEnabled) fail(409, "MFA_SETUP_REQUIRED", "관리자 계정의 2단계 인증을 먼저 등록해주세요.");
    const passwordChanged = current.minPassword !== settings.minPassword || current.passwordMonths !== settings.passwordMonths
      || current.passwordReuse !== settings.passwordReuse || current.passwordDeferral !== settings.passwordDeferral;
    const approvalChanged = current.requireApproval !== settings.requireApproval
      || [...current.approvalRoles].sort().join() !== [...settings.approvalRoles].sort().join()
      || current.approvalReferenceRequired !== settings.approvalReferenceRequired
      || current.approvalRequestTemplate !== settings.approvalRequestTemplate;
    if (approvalChanged) {
      // Lock affected forms before approval rows, like decision, edit and publication.
      await tx.$queryRaw`SELECT id FROM "Form" WHERE "tenantId" = ${ctx.tenantId} ORDER BY id FOR UPDATE`;
      await tx.approvalRequest.updateMany({ where: { tenantId: ctx.tenantId, status: { in: ["pending", "approved"] } },
        data: { status: "superseded", version: { increment: 1 } } });
      await tx.form.updateMany({ where: { tenantId: ctx.tenantId, status: "pendingApproval" }, data: { status: "draft", version: { increment: 1 } } });
    }
    const saved = await tx.securityPolicy.update({ where: { tenantId: ctx.tenantId },
      data: { ...settings, version: { increment: 1 }, passwordRevision: { increment: passwordChanged ? 1 : 0 }, approvalRevision: { increment: approvalChanged ? 1 : 0 } } });
    await audit(tx, ctx, requestId, reset ? "policy.reset" : "policy.updated", "securityPolicy", ctx.tenantId, Object.keys(settings));
    return policyDto(saved, ctx);
  }, { timeout: 15000 });
}
export { policyDefaults };
