import { trustedClientIp } from "@/server/client-ip";
import { assertCompanyIp } from "@/server/ip-enforcement";
import { z } from "zod";
import { db } from "@/server/db";
import { body, fail, json, route } from "@/server/http";
import { activeMembershipWhere, contextDto, requireActor, requireContext, requireService } from "@/server/context";
export const GET = route(async request => json(await contextDto(request.headers)));
export const POST = route(async request => {
  const actor = await requireActor(request.headers);
  const input = await body(request, z.object({ companyId: z.uuid().optional(), serviceId: z.uuid().optional() }).strict());
  if (input.companyId) {
    await db.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM "Company" WHERE id=$1 FOR SHARE', input.companyId);
      const member = await tx.membership.findFirst({ where: activeMembershipWhere(actor.user.id, input.companyId),
        include: { tenant: { include: { policy: true } }, expertAssignment: { include: { services: true } } } });
      if (!member) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
      await tx.$queryRawUnsafe('SELECT id FROM "Membership" WHERE id=$1 FOR SHARE', member.id);
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR SHARE', actor.user.id);
      if (!await tx.user.findFirst({ where: { id: actor.user.id, status: "active", emailVerified: true } })) fail(401, "ACCOUNT_UNAVAILABLE", "사용할 수 없는 계정입니다.");
      if (member.accessKind === "expert" && !(await tx.service.count({ where: { tenantId: input.companyId, status: "active", id: { in: member.expertAssignment?.services.map(item => item.serviceId) ?? [] } } })))
        fail(409, "EXPERT_SCOPE_EMPTY", "배정된 활성 서비스가 없습니다. 담당자에게 확인해주세요.");
      await assertCompanyIp(input.companyId!, trustedClientIp(request.headers), tx);
      await tx.$queryRawUnsafe('SELECT id FROM "Session" WHERE id=$1 AND "userId"=$2 FOR UPDATE', actor.session.id, actor.user.id);
      const session = await tx.session.findFirst({ where: { id: actor.session.id, userId: actor.user.id, expiresAt: { gt: new Date() } } });
      if (!session || member.tenant.policy && session.updatedAt.getTime() + member.tenant.policy.sessionMinutes * 60000 <= Date.now()) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
      await tx.session.update({ where: { id: session.id }, data: { activeCompanyId: input.companyId, activeServiceId: null } });
    });
  } else if (input.serviceId) {
    const ctx = await requireContext(request.headers);
    const service = await requireService(ctx, input.serviceId);
    if (service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스는 선택할 수 없습니다.");
    await db.session.update({ where: { id: actor.session.id }, data: { activeServiceId: input.serviceId } });
  } else fail(422, "SELECTION_REQUIRED", "회사 또는 서비스를 선택해주세요.");
  return json(await contextDto(request.headers));
});
