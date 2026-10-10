import { activeMembershipWhere, type Context } from "./context";
import type { Transaction } from "./db";
import { fail } from "./http";
import { roleCan, type Capability } from "./permissions";
import { assertSsoSession } from "./sso-policy-enforcement";

export async function currentServiceScope(tx: Transaction, ctx: Context, capability: Capability) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "ServiceGrant" WHERE "memberId"=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const current = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, userId: ctx.user.id,
    status: "active", tenant: { status: "active" }, user: { status: "active" } }, include: { grants: true } });
  if (!current || !roleCan(current.role, capability)) fail(403, "FORBIDDEN", "이 서비스 작업을 수행할 권한이 없습니다.");
  const scope = { tenantId: ctx.tenantId, ...(["owner", "admin"].includes(current.role) ? {} :
    { id: { in: current.grants.filter(item => item.capabilities.includes(capability)).map(item => item.serviceId) } }) };
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${ctx.session.id} AND "userId"=${ctx.user.id} FOR SHARE`;
  const user = await tx.user.findFirst({ where: { id: ctx.user.id, status: "active", emailVerified: true } });
  const session = await tx.session.findFirst({ where: { id: ctx.session.id, userId: ctx.user.id, expiresAt: { gt: new Date() } } });
  if (!user || !session) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
  await assertSsoSession(tx, ctx.tenantId, ctx.user.id, session.id);
  const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(ctx.user.id, ctx.tenantId), id: ctx.member.id },
    include: { grants: true, expertAssignment: { include: { services: true } } } });
  if (!member) fail(403, "FORBIDDEN", "현재 회사의 권한을 확인해주세요.");
  if (member.accessKind === "expert") {
    const assigned = new Set(member.expertAssignment!.services.map(item => item.serviceId));
    return { tenantId: ctx.tenantId, id: { in: member.grants.filter(item => assigned.has(item.serviceId) && item.capabilities.includes(capability)).map(item => item.serviceId) } };
  }
  return scope;
}
