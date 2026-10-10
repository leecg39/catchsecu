import { db } from "./db";
import { requireActor } from "./context";
import { addPolicyMonths, effectivePasswordRules, passwordState } from "./password-policy";
import { fail, rateLimit } from "./http";
import { audit } from "./audit";
import type { z } from "zod";
import type { passwordDeferralInput } from "@/contracts/security";
import { assertSsoSession } from "./sso-policy-enforcement";

async function currentMember(userId: string, companyId?: string | null) {
  return db.membership.findFirst({ where: { userId, status: "active", tenant: { status: "active" }, ...(companyId ? { tenantId: companyId } : {}) },
    include: { tenant: { include: { policy: true } } }, orderBy: { createdAt: "asc" } });
}
export async function myPasswordPolicy(headers: Headers) {
  const actor = await requireActor(headers), member = await currentMember(actor.user.id, actor.session.activeCompanyId);
  const rules = await effectivePasswordRules(actor.user.id);
  if (!member) return { ...rules, tenantId: null, companyName: null, passwordChangedAt: actor.user.passwordChangedAt,
    deadline: null, expired: false, required: false, canDefer: false, deferralMode: "never", deferredUntil: null, passwordMonths: 0, passwordRevision: 1 };
  return { ...rules, ...await passwordState(actor.user, actor.session, member) };
}
export async function deferPassword(headers: Headers, input: z.infer<typeof passwordDeferralInput>, requestId: string) {
  const actor = await requireActor(headers);
  await rateLimit("password-deferral:" + actor.user.id, 10);
  const initial = await currentMember(actor.user.id, actor.session.activeCompanyId);
  if (!initial || initial.tenantId !== input.tenantId) fail(409, "COMPANY_CHANGED", "현재 회사의 정책을 다시 불러와주세요.");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${initial.tenantId} AND status = 'active' FOR SHARE`;
    await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId" = ${initial.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.user.id} FOR UPDATE`;
    const member = await tx.membership.findFirst({ where: { id: initial.id, userId: actor.user.id, status: "active", tenant: { status: "active" } },
      include: { tenant: { include: { policy: true } } } });
    if (!member?.tenant.policy) fail(403, "FORBIDDEN", "활성 회사 소속이 필요합니다.");
    const policy = member.tenant.policy;
    if (policy.passwordRevision !== input.passwordRevision) fail(409, "VERSION_CONFLICT", "비밀번호 정책이 변경되었습니다. 다시 불러와주세요.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.user.id } });
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${actor.session.id} FOR UPDATE`;
    const session = await tx.session.findUnique({ where: { id: actor.session.id } });
    if (!session || session.expiresAt <= new Date() || Date.now() - session.updatedAt.getTime() > policy.sessionMinutes * 60000 || user.status !== "active")
      fail(401, "SESSION_EXPIRED", "다시 로그인해주세요.");
    if (session.activeCompanyId !== actor.session.activeCompanyId) fail(409, "COMPANY_CHANGED", "현재 회사의 정책을 다시 불러와주세요.");
    await assertSsoSession(tx, member.tenantId, user.id, session.id);
    const status = await passwordState(user, session, member, new Date(), tx);
    if (!status.expired || !user.passwordChangedAt || !policy.passwordMonths) fail(409, "PASSWORD_NOT_DUE", "지금은 변경을 미룰 필요가 없습니다.");
    if (policy.passwordDeferral === "never") fail(403, "DEFERRAL_FORBIDDEN", "회사 정책에 따라 비밀번호를 바로 변경해야 합니다.");
    if (!status.required) return { ...await effectivePasswordRules(user.id, tx), ...status };
    const expiresAt = policy.passwordDeferral === "session" ? session.expiresAt : addPolicyMonths(new Date(), policy.passwordMonths);
    const data = { tenantId: member.tenantId, memberId: member.id, userId: user.id, passwordChangedAt: user.passwordChangedAt,
      passwordRevision: policy.passwordRevision, mode: policy.passwordDeferral, sessionId: policy.passwordDeferral === "session" ? session.id : null, expiresAt };
    await tx.passwordDeferral.upsert({ where: { tenantId_memberId: { tenantId: member.tenantId, memberId: member.id } },
      create: data, update: { ...data, version: { increment: 1 } } });
    await audit(tx, { tenantId: member.tenantId, user }, requestId, "password.deferred", "user", user.id, ["passwordDeferral"]);
    return { ...await effectivePasswordRules(user.id, tx), ...await passwordState(user, session, member, new Date(), tx) };
  });
}
