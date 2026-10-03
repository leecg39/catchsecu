import { passwordState } from "./password-policy";
import { auth } from "./auth";
import { APIError } from "better-auth/api";
import { db } from "./db";
import { fail, rateLimit } from "./http";
import { type Capability, roleCan, roleCapabilities } from "./permissions";

export function activeMembershipWhere(userId: string, tenantId?: string) {
  return { userId, status: "active" as const, ...(tenantId ? { tenantId } : {}), tenant: { status: "active" as const },
    OR: [{ accessKind: "direct" }, { accessKind: "expert", expertAssignment: { is: {
      expertUserId: userId, status: "active", expiresAt: { gt: new Date() },
    } } }] };
}

export async function requireActor(headers: Headers) {
  const session = await auth.api.getSession({ headers, query: { disableRefresh: true } }).catch(error => {
    if (error instanceof APIError && error.statusCode === 401) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
    throw error;
  });
  if (!session) fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.status !== "active" || !user.emailVerified) fail(401, "ACCOUNT_UNAVAILABLE", "사용할 수 없는 계정입니다.");
  return { user, session: session.session };
}
export async function requireContext(headers: Headers, capability?: Capability, allowMfaSetup = false, allowPasswordSetup = false) {
  const actor = await requireActor(headers);
  const member = await db.membership.findFirst({
    where: { ...activeMembershipWhere(actor.user.id, actor.session.activeCompanyId ?? undefined),
      ...(!actor.session.activeCompanyId ? { accessKind: "direct" } : {}) },
    include: { tenant: { include: { policy: true } }, grants: true,
      expertAssignment: { include: { services: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!member) fail(403, "COMPANY_REQUIRED", "소속된 회사가 없습니다. 회사를 등록하거나 초대를 수락해주세요.");
  const policy = member.tenant.policy;
  if (policy && Date.now() - new Date(actor.session.updatedAt).getTime() > policy.sessionMinutes * 60000) {
    await db.session.deleteMany({ where: { id: actor.session.id } });
    fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
  }
  if (policy?.requireMfa && !actor.user.twoFactorEnabled && !allowMfaSetup) fail(403, "MFA_REQUIRED", "2단계 인증 설정이 필요합니다.");
  if (policy && !allowPasswordSetup && (await passwordState(actor.user, actor.session, member)).required)
    fail(403, "PASSWORD_CHANGE_REQUIRED", "회사 정책에 따라 비밀번호를 변경해주세요.");
  if (Date.now() - new Date(actor.session.updatedAt).getTime() > 60000) {
    await db.session.updateMany({ where: { id: actor.session.id, expiresAt: { gt: new Date() } }, data: { updatedAt: new Date() } });
  }
  if (capability && !roleCan(member.role, capability)) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  await rateLimit("member:" + member.id, 300);
  return { ...actor, member, tenantId: member.tenantId, capabilities: roleCapabilities(member.role) };
}
export type Context = Awaited<ReturnType<typeof requireContext>>;
export async function requireService(ctx: Context, serviceId: string, capability: Capability = "service.read") {
  if (!roleCan(ctx.member.role, capability)) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  const service = await db.service.findFirst({ where: { id: serviceId, tenantId: ctx.tenantId } });
  if (!service) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
  if (ctx.member.accessKind === "expert" && service.status !== "active") fail(404, "NOT_FOUND", "활성 서비스를 찾을 수 없습니다.");
  if (ctx.member.accessKind === "expert" && !ctx.member.expertAssignment?.services.some(item => item.serviceId === serviceId))
    fail(403, "EXPERT_SCOPE", "전문가 배정 범위에 없는 서비스입니다.");
  if (!["owner", "admin"].includes(ctx.member.role)) {
    const grant = ctx.member.grants.find(item => item.serviceId === serviceId);
    if (!grant || !grant.capabilities.includes(capability)) fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
  return service;
}
export function serviceScope(ctx: Context, capability: Capability = "service.read") {
  const assignmentScope = ctx.member.accessKind === "expert" ? new Set(ctx.member.expertAssignment?.services.map(item => item.serviceId) ?? []) : null;
  return {
    tenantId: ctx.tenantId,
    ...(!["owner", "admin"].includes(ctx.member.role)
      ? { id: { in: ctx.member.grants.filter(grant => grant.capabilities.includes(capability) &&
        (!assignmentScope || assignmentScope.has(grant.serviceId))).map(grant => grant.serviceId) } }
      : {}),
  };
}
export async function contextDto(headers: Headers) {
  const actor = await requireActor(headers);
  const memberships = await db.membership.findMany({
    where: activeMembershipWhere(actor.user.id),
    select: { tenantId: true, role: true, accessKind: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const expertCompanyCount = await db.expertAssignment.count({ where: { expertUserId: actor.user.id,
    status: "active", expiresAt: { gt: new Date() }, tenant: { status: "active" } } });
  const expertAssignmentCount = await db.expertAssignment.count({ where: { expertUserId: actor.user.id } });
  const base = { user: { id: actor.user.id, name: actor.user.name, email: actor.user.email,
    twoFactorEnabled: actor.user.twoFactorEnabled, platformAdmin: actor.user.platformAdmin }, memberships,
    expertCompanyCount, expertAssignmentCount };
  if (!memberships.length || (actor.session.activeCompanyId && !memberships.some(item => item.tenantId === actor.session.activeCompanyId)) ||
    (!actor.session.activeCompanyId && !memberships.some(item => item.accessKind === "direct")))
    return { ...base, company: null, services: [], serviceId: null, capabilities: [] };
  const ctx = await requireContext(headers, undefined, true, true);
  const services = await db.service.findMany({ where: { ...serviceScope(ctx), status: "active" },
    select: { id: true, name: true, externalName: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  return { ...base, company: { id: ctx.tenantId, name: ctx.member.tenant.name, role: ctx.member.role },
    services, serviceId: services.find(item => item.id === actor.session.activeServiceId)?.id ?? services[0]?.id ?? null,
    capabilities: ctx.capabilities, requirePasswordChange: (await passwordState(ctx.user, ctx.session, ctx.member)).required, requireMfa: !!ctx.member.tenant.policy?.requireMfa && !actor.user.twoFactorEnabled };
}
