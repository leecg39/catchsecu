import { z } from "zod";
import { db } from "@/server/db";
import { body, fail, json, route } from "@/server/http";
import { activeMembershipWhere, contextDto, requireActor, requireContext, requireService } from "@/server/context";
export const GET = route(async request => json(await contextDto(request.headers)));
export const POST = route(async request => {
  const actor = await requireActor(request.headers);
  const input = await body(request, z.object({ companyId: z.uuid().optional(), serviceId: z.uuid().optional() }).strict());
  if (input.companyId) {
    const member = await db.membership.findFirst({ where: activeMembershipWhere(actor.user.id, input.companyId),
      include: { expertAssignment: { include: { services: true } } } });
    if (!member) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
    if (member.accessKind === "expert" && !(await db.service.count({ where: { tenantId: input.companyId, status: "active",
      id: { in: member.expertAssignment?.services.map(item => item.serviceId) ?? [] } } })))
      fail(409, "EXPERT_SCOPE_EMPTY", "배정된 활성 서비스가 없습니다. 담당자에게 확인해주세요.");
    await db.session.update({ where: { id: actor.session.id }, data: { activeCompanyId: input.companyId, activeServiceId: null } });
  } else if (input.serviceId) {
    const ctx = await requireContext(request.headers);
    await requireService(ctx, input.serviceId);
    await db.session.update({ where: { id: actor.session.id }, data: { activeServiceId: input.serviceId } });
  } else fail(422, "SELECTION_REQUIRED", "회사 또는 서비스를 선택해주세요.");
  return json(await contextDto(request.headers));
});
