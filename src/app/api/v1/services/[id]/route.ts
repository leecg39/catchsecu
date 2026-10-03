import { z } from "zod";
import { db } from "@/server/db";
import { requireContext, requireService } from "@/server/context";
import { audit } from "@/server/audit";
import { body, fail, json, requireVersion, route } from "@/server/http";
import { servicePatch } from "@/server/schemas";
import { assertQuota } from "@/server/entitlements";
import { assertServiceArchivable } from "@/server/service-management";
function idOf(request: Request) { return z.uuid().parse(new URL(request.url).pathname.split("/").pop()); }
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "service.read");
  return json(await requireService(ctx, idOf(request)));
});
export const PATCH = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "service.manage");
  const id = idOf(request);
  const current = await requireService(ctx, id, "service.manage");
  const input = await body(request, servicePatch);
  requireVersion(input, current);
  const { version, ...data } = input;
  const updated = await db.$transaction(async tx => {
    if (data.status === "archived") await assertServiceArchivable(tx, ctx.tenantId, id);
    if (data.status === "active" && current.status !== "active") await assertQuota(tx, ctx.tenantId, "services");
    const result = await tx.service.updateMany({ where: { id, tenantId: ctx.tenantId, version }, data: { ...data, version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "최신 내용을 불러온 후 다시 저장해주세요.");
    if (data.status === "archived") await tx.session.updateMany({ where: { activeCompanyId: ctx.tenantId, activeServiceId: id }, data: { activeServiceId: null } });
    await audit(tx, ctx, requestId, "service.updated", "service", id, Object.keys(data), id);
    return tx.service.findUniqueOrThrow({ where: { id } });
  });
  return json(updated);
});
export const DELETE = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "service.manage");
  const id = idOf(request);
  await requireService(ctx, id, "service.manage");
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  await db.$transaction(async tx => {
    await assertServiceArchivable(tx, ctx.tenantId, id);
    const result = await tx.service.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: "active" },
      data: { status: "archived", version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "서비스가 이미 변경되었거나 보관되었습니다.");
    await tx.session.updateMany({ where: { activeCompanyId: ctx.tenantId, activeServiceId: id }, data: { activeServiceId: null } });
    await audit(tx, ctx, requestId, "service.archived", "service", id, ["status"], id);
  });
  return new Response(null, { status: 204 });
});
