import { assertCompanyIp } from "./ip-enforcement";
import { assertCompanyMfa } from "./mfa-enforcement";
import { activeMembershipWhere, type Context } from "./context";
import type { Transaction } from "./db";
import { assertFileDeadlines } from "./file-access";
import { passwordState } from "./password-policy";
import { roleCan, type Capability } from "./permissions";
import { fail } from "./http";
import { assertSsoSession } from "./sso-policy-enforcement";

// Lists must authenticate even when the current actor has no accessible service.
export async function lockServiceActor(tx: Transaction, ctx: Context, capability: Capability, options: { lockServices?: boolean } = {}) {
  return lockScopedActor(tx, ctx, capability, false, options.lockServices ?? true);
}
// The recovery exception is restricted to SSO account listing/linking. It grants
// no business service scope, and still requires the current direct membership.
export async function lockSsoRecoveryActor(tx: Transaction, ctx: Context) {
  return lockScopedActor(tx, ctx, "service.read", true);
}
async function lockScopedActor(tx: Transaction, ctx: Context, capability: Capability, recovery: boolean, lockServices = true) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR SHARE`;
  const company = await tx.company.findUnique({ where: { id: ctx.tenantId } });
  if (!company || company.status !== "active") fail(403, "COMPANY_UNAVAILABLE", "사용할 수 없는 회사입니다.");
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "ServiceGrant" WHERE "memberId"=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR SHARE`;
  await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${ctx.tenantId} FOR SHARE`;
  const user = await tx.user.findFirst({ where: { id: ctx.user.id, status: "active", emailVerified: true } });
  if (!user) fail(401, "ACCOUNT_UNAVAILABLE", "사용할 수 없는 계정입니다.");
  await assertCompanyIp(ctx.tenantId, ctx.clientIp, tx);
  const initial = await tx.membership.findUnique({ where: { id: ctx.member.id } });
  if (initial?.expertAssignmentId) {
    await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${initial.expertAssignmentId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT "assignmentId" FROM "ExpertAssignmentService" WHERE "assignmentId"=${initial.expertAssignmentId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  }
  const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(ctx.user.id, ctx.tenantId), id: ctx.member.id },
    include: { grants: true, tenant: { include: { policy: true } }, expertAssignment: { include: { services: true } } } });
  if (!member || !roleCan(member.role, capability)) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  if (recovery && member.accessKind !== "direct") fail(403, "FORBIDDEN", "직접 소속 구성원만 SSO 계정을 연결할 수 있습니다.");
  const mfa = await assertCompanyMfa(ctx.tenantId, member.id, user.twoFactorEnabled, !!member.tenant.policy?.requireMfa, tx);
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${ctx.session.id} AND "userId"=${ctx.user.id} FOR SHARE`;
  const session = await tx.session.findFirst({ where: { id: ctx.session.id, userId: ctx.user.id, expiresAt: { gt: new Date() } } });
  if (!session || (member.tenant.policy && Date.now() - session.updatedAt.getTime() >= member.tenant.policy.sessionMinutes * 60000))
    fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
  if (session.activeCompanyId && session.activeCompanyId !== ctx.tenantId) fail(403, "COMPANY_CHANGED", "선택한 회사가 변경되었습니다. 화면을 다시 불러와주세요.");
  if (!recovery) await assertSsoSession(tx, ctx.tenantId, ctx.user.id, session.id);
  const password = await passwordState(user, session, member, new Date(), tx);
  if (password.required) fail(403, "PASSWORD_CHANGE_REQUIRED", "회사 정책에 따라 비밀번호를 변경해주세요.");
  const deadlines = { session: new Date(Math.min(session.expiresAt.getTime(), member.tenant.policy ? session.updatedAt.getTime() + member.tenant.policy.sessionMinutes * 60000 : Infinity)),
    expert: member.accessKind === "expert" ? member.expertAssignment!.expiresAt : null, password: password.deferredUntil ?? password.deadline, mfa };
  assertFileDeadlines(deadlines);
  const assigned = member.accessKind === "expert" ? new Set(member.expertAssignment!.services.map(item => item.serviceId)) : null;
  const scope = { tenantId: ctx.tenantId, ...(assigned ? { status: "active" } : {}),
    ...(["owner", "admin"].includes(member.role) && !assigned ? {} : { id: { in: member.grants.filter(item => item.capabilities.includes(capability) && (!assigned || assigned.has(item.serviceId))).map(item => item.serviceId) } }) };
  // Also keep service status and names stable through count, paging and DTO creation.
  if (recovery) return { member, deadlines, scope: { tenantId: ctx.tenantId, id: { in: [] as string[] } } };
  // Resource modules that already lock Form/Template before Service retain that
  // order and check their selected service themselves.
  if (!lockServices) return { member, deadlines, scope };
  const services = await tx.service.findMany({ where: scope, select: { id: true }, orderBy: { id: "asc" } });
  for (const service of services) await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${service.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  return { member, deadlines, scope };
}
