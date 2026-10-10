import { z } from "zod";
import { db } from "@/server/db";
import { requireContext } from "@/server/context";
import { audit } from "@/server/audit";
import { body, fail, json, requireVersion, route } from "@/server/http";
import { servicePatch } from "@/server/schemas";
import { assertQuota } from "@/server/entitlements";
import { assertServiceArchivable, lockManagementActor } from "@/server/service-management";
import { lockServiceActor } from "@/server/service-actor";
import { assertFileDeadlines } from "@/server/file-access";
function idOf(request: Request) { return z.uuid().parse(new URL(request.url).pathname.split("/").pop()); }
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "service.read");
  return json(await db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "service.read");
    const service = await tx.service.findFirst({ where: { AND: [actor.scope, { id: idOf(request) }] } });
    if (!service) {
      const existing = await tx.service.findFirst({ where: { id: idOf(request), tenantId: ctx.tenantId }, select: { status: true } });
      if (!existing || (actor.member.accessKind === "expert" && existing.status !== "active")) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
      if (actor.member.accessKind === "expert") fail(403, "EXPERT_SCOPE", "전문가 배정 범위에 없는 서비스입니다.");
      fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
    }
    assertFileDeadlines(actor.deadlines);
    return service;
  }));
});
export const PATCH = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "service.manage");
  const id = idOf(request);
  const input = await body(request, servicePatch);
  const { version, ...data } = input;
  const updated = await db.$transaction(async tx => {
    const actor = await lockManagementActor(tx, ctx, "service.manage");
    const current = await tx.service.findFirst({ where: { AND: [actor.scope, { id }] } });
    if (!current) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    requireVersion(input, current);
    if (data.status === "archived") await assertServiceArchivable(tx, ctx.tenantId, id);
    if (data.status === "active" && current.status !== "active") await assertQuota(tx, ctx.tenantId, "services");
    const result = await tx.service.updateMany({ where: { id, tenantId: ctx.tenantId, version }, data: { ...data, version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "최신 내용을 불러온 후 다시 저장해주세요.");
    if (data.status === "archived") await tx.session.updateMany({ where: { activeCompanyId: ctx.tenantId, activeServiceId: id }, data: { activeServiceId: null } });
    await audit(tx, ctx, requestId, "service.updated", "service", id, Object.keys(data), id);
    const resultRow = await tx.service.findUniqueOrThrow({ where: { id } });
    assertFileDeadlines(actor.deadlines);
    return resultRow;
  });
  return json(updated);
});
export const DELETE = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "service.manage");
  const id = idOf(request);
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  await db.$transaction(async tx => {
    const actor = await lockManagementActor(tx, ctx, "service.manage");
    if (!await tx.service.findFirst({ where: { AND: [actor.scope, { id }] } })) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    await assertServiceArchivable(tx, ctx.tenantId, id);
    const result = await tx.service.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: "active" },
      data: { status: "archived", version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "서비스가 이미 변경되었거나 보관되었습니다.");
    await tx.session.updateMany({ where: { activeCompanyId: ctx.tenantId, activeServiceId: id }, data: { activeServiceId: null } });
    await audit(tx, ctx, requestId, "service.archived", "service", id, ["status"], id);
    assertFileDeadlines(actor.deadlines);
  });
  return new Response(null, { status: 204 });
});
