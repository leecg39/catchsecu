import type { z } from "zod";
import type { SecurityPolicy } from "@/generated/prisma/client";
import { policyDefaults, type policySettings } from "@/contracts/security";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail, rateLimit } from "./http";
import { auth } from "./auth";
import { audit } from "./audit";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { lockSecurityEntitlements } from "./feature-entitlements";
import type { SecurityEntitlements } from "@/contracts/feature-entitlements";

export function policyDto(policy: SecurityPolicy, ctx: Context, entitlements: SecurityEntitlements) {
  return { tenantId: ctx.tenantId, minPassword: policy.minPassword, passwordMonths: policy.passwordMonths,
    passwordReuse: policy.passwordReuse, passwordDeferral: policy.passwordDeferral, passwordRevision: policy.passwordRevision, sessionMinutes: policy.sessionMinutes, requireMfa: policy.requireMfa, requireApproval: policy.requireApproval,
    approvalRoles: policy.approvalRoles, approvalReferenceRequired: policy.approvalReferenceRequired,
    approvalRequestTemplate: policy.approvalRequestTemplate, approvalRevision: policy.approvalRevision,
    automaticDestruction: policy.automaticDestruction, allowRetentionAdjustment: policy.allowRetentionAdjustment,
    allowRetentionDesignation: policy.allowRetentionDesignation, retentionDays: policy.retentionDays,
    activityReviewRetentionDays: policy.activityReviewRetentionDays,
    version: policy.version, updatedAt: policy.updatedAt, entitlements, canManage: ctx.member.role === "owner" && ctx.member.accessKind === "direct" && entitlements["security.company_policy"].available };
}
export async function readPolicy(ctx: Context) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "security.read");
    const policy = await tx.securityPolicy.findUnique({ where: { tenantId: ctx.tenantId } });
    if (!policy) fail(404, "NOT_FOUND", "회사 보안 정책을 찾을 수 없습니다.");
    const access = await lockSecurityEntitlements(tx, ctx.tenantId);
    const result = policyDto(policy, { ...ctx, member: actor.member }, access.snapshot());
    assertFileDeadlines(actor.deadlines);
    return result;
  }, { timeout: 15000 });
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
// 보유 기간을 지정하지 않은 폼은 제출·게시 시점의 기본 보유 기간으로 해석한다.
// 서비스 규칙(RetentionRule)이 있으면 회사 기본값보다 우선 적용한다.
export async function companyRetentionDays(tx: Transaction, tenantId: string, serviceId?: string) {
  if (serviceId) {
    const rule = await tx.retentionRule.findUnique({ where: { tenantId_serviceId: { tenantId, serviceId }, status: "active" },
      select: { retentionDays: true } });
    if (rule) return rule.retentionDays;
  }
  const policy = await tx.securityPolicy.findUnique({ where: { tenantId }, select: { retentionDays: true } });
  if (!policy) fail(409, "POLICY_REQUIRED", "회사 보안 정책이 없습니다.");
  return policy.retentionDays;
}
export async function updatePolicy(ctx: Context, version: number, settings: z.infer<typeof policySettings>, requestId: string, reset = false) {
  if (ctx.member.role !== "owner") fail(403, "FORBIDDEN", "최상위 관리자만 회사 보안 정책을 변경할 수 있습니다.");
  return db.$transaction(async tx => {
    // Use the same company lock as member removal and ownership transfer.
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${ctx.tenantId} FOR UPDATE`;
    const actor = await lockServiceActor(tx, ctx, "security.write");
    if (actor.member.role !== "owner" || actor.member.accessKind !== "direct") fail(403, "FORBIDDEN", "최상위 관리자 권한이 필요합니다.");
    await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    const current = await tx.securityPolicy.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
    if (current.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 정책을 불러와주세요.");
    const access = await lockSecurityEntitlements(tx, ctx.tenantId);
    access.assert("security.company_policy");
    if (settings.requireMfa !== current.requireMfa) access.assert("security.mfa_management");
    const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (settings.requireMfa && !user.twoFactorEnabled) fail(409, "MFA_SETUP_REQUIRED", "관리자 계정의 2단계 인증을 먼저 등록해주세요.");
    const passwordChanged = current.minPassword !== settings.minPassword || current.passwordMonths !== settings.passwordMonths
      || current.passwordReuse !== settings.passwordReuse || current.passwordDeferral !== settings.passwordDeferral;
    const retentionChanged = current.retentionDays !== settings.retentionDays;
    const approvalChanged = current.requireApproval !== settings.requireApproval
      || [...current.approvalRoles].sort().join() !== [...settings.approvalRoles].sort().join()
      || current.approvalReferenceRequired !== settings.approvalReferenceRequired
      || current.approvalRequestTemplate !== settings.approvalRequestTemplate;
    if (approvalChanged || retentionChanged) {
      // Lock affected forms before approval rows, like decision, edit and publication.
      await tx.$queryRaw`SELECT id FROM "Form" WHERE "tenantId" = ${ctx.tenantId} ORDER BY id FOR UPDATE`;
      await tx.approvalRequest.updateMany({ where: { tenantId: ctx.tenantId, status: { in: ["pending", "approved"] } },
        data: { status: "superseded", version: { increment: 1 } } });
      await tx.form.updateMany({ where: { tenantId: ctx.tenantId, status: "pendingApproval" }, data: { status: "draft", version: { increment: 1 } } });
    }
    if (settings.activityReviewRetentionDays !== current.activityReviewRetentionDays) {
      // 종결된 검토의 남은 기한은 새 정책으로 다시 계산한다. 보존·파기 확정 행과 진행 중 검토는 건드리지 않는다.
      await tx.$queryRaw`SELECT id FROM "ActivityReview" WHERE "tenantId" = ${ctx.tenantId} ORDER BY id FOR UPDATE`;
      if (settings.activityReviewRetentionDays === null) {
        await tx.$executeRaw`UPDATE "ActivityReview" SET "retentionUntil"=NULL,"destructionStatus"='none',"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "tenantId"=${ctx.tenantId} AND "destructionStatus" IN ('none','awaiting') AND ("retentionUntil" IS NOT NULL OR "destructionStatus"='awaiting')`;
      } else {
        await tx.$executeRaw`UPDATE "ActivityReview" SET
            "destructionStatus"=CASE WHEN "destructionStatus"='awaiting' AND "closedAt"+(${settings.activityReviewRetentionDays} * INTERVAL '1 day')>CURRENT_TIMESTAMP THEN 'none' ELSE "destructionStatus" END,
            "retentionUntil"="closedAt"+(${settings.activityReviewRetentionDays} * INTERVAL '1 day'),
            "version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "tenantId"=${ctx.tenantId} AND "closedAt" IS NOT NULL AND "destructionStatus" IN ('none','awaiting')
            AND "retentionUntil" IS DISTINCT FROM "closedAt"+(${settings.activityReviewRetentionDays} * INTERVAL '1 day')`;
      }
    }
    const saved = await tx.securityPolicy.update({ where: { tenantId: ctx.tenantId },
      data: { ...settings, version: { increment: 1 }, passwordRevision: { increment: passwordChanged ? 1 : 0 }, approvalRevision: { increment: approvalChanged || retentionChanged ? 1 : 0 } } });
    await audit(tx, ctx, requestId, reset ? "policy.reset" : "policy.updated", "securityPolicy", ctx.tenantId, Object.keys(settings));
    assertFileDeadlines(actor.deadlines);
    access.assert("security.company_policy");
    if (settings.requireMfa !== current.requireMfa) access.assert("security.mfa_management");
    return policyDto(saved, { ...ctx, member: actor.member }, access.snapshot());
  }, { timeout: 15000 });
}
export { policyDefaults };
