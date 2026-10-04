import { audit } from "./audit";
import { activeMembershipWhere, type Context, type requireActor } from "./context";
import { db, type Transaction } from "./db";
import { assertFileDeadlines } from "./file-access";
import { fail } from "./http";
import { assertCompanyIp } from "./ip-enforcement";
import { lockServiceActor } from "./service-actor";

type Actor = Awaited<ReturnType<typeof requireActor>>;
async function lockSelection(tx: Transaction, sessionId: string) {
  // Both selection paths take this lock before account/company/session locks.
  // Concurrent selections cannot both upgrade the actor's shared session lock.
  await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"context:" + sessionId}, 0))`;
}
export async function selectCompany(actor: Actor, companyId: string, clientIp: string | null, requestId: string) {
  await db.$transaction(async tx => {
    await lockSelection(tx, actor.session.id);
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR SHARE`;
    const initial = await tx.membership.findFirst({ where: { userId: actor.user.id, tenantId: companyId } });
    if (!initial) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${initial.id} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.user.id} FOR SHARE`;
    await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${companyId} FOR SHARE`;
    if (initial.expertAssignmentId) {
      await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${initial.expertAssignmentId} FOR SHARE`;
      await tx.$queryRaw`SELECT "assignmentId" FROM "ExpertAssignmentService" WHERE "assignmentId"=${initial.expertAssignmentId} FOR SHARE`;
    }
    const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(actor.user.id, companyId), id: initial.id },
      include: { tenant: { include: { policy: true } }, expertAssignment: { include: { services: true } } } });
    if (!member) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
    if (!await tx.user.findFirst({ where: { id: actor.user.id, status: "active", emailVerified: true } }))
      fail(401, "ACCOUNT_UNAVAILABLE", "사용할 수 없는 계정입니다.");
    if (member.accessKind === "expert") {
      const serviceIds = member.expertAssignment!.services.map(s => s.serviceId).sort();
      for (const id of serviceIds) await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${id} AND "tenantId"=${companyId} FOR SHARE`;
      if (!await tx.service.count({ where: { tenantId: companyId, status: "active", id: { in: serviceIds } } }))
        fail(409, "EXPERT_SCOPE_EMPTY", "배정된 활성 서비스가 없습니다. 담당자에게 확인해주세요.");
    }
    await assertCompanyIp(companyId, clientIp, tx);
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${actor.session.id} AND "userId"=${actor.user.id} FOR UPDATE`;
    const session = await tx.session.findFirst({ where: { id: actor.session.id, userId: actor.user.id } });
    if (!session) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
    const deadlines = { session: new Date(Math.min(session.expiresAt.getTime(), member.tenant.policy
      ? session.updatedAt.getTime() + member.tenant.policy.sessionMinutes * 60000 : Infinity)),
      expert: member.accessKind === "expert" ? member.expertAssignment!.expiresAt : null, password: null };
    assertFileDeadlines(deadlines);
    await tx.session.update({ where: { id: session.id }, data: { activeCompanyId: companyId, activeServiceId: null } });
    await audit(tx, { tenantId: companyId, user: actor.user }, requestId, "context.company_selected", "session", session.id,
      ["activeCompanyId", "activeServiceId"]);
    assertFileDeadlines(deadlines);
  }, { timeout: 15000 });
}

export async function selectService(ctx: Context, serviceId: string, requestId: string) {
  await db.$transaction(async tx => {
    await lockSelection(tx, ctx.session.id);
    const current = await lockServiceActor(tx, ctx, "service.read");
    const service = await tx.service.findFirst({ where: { ...current.scope, id: serviceId,
      ...(current.scope.id ? { AND: [{ id: current.scope.id }] } : {}) } });
    if (!service) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    if (service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스는 선택할 수 없습니다.");
    await tx.session.update({ where: { id: ctx.session.id }, data: { activeServiceId: serviceId } });
    await audit(tx, ctx, requestId, "context.service_selected", "session", ctx.session.id,
      ["activeServiceId"], serviceId);
    assertFileDeadlines(current.deadlines);
  }, { timeout: 15000 });
}
