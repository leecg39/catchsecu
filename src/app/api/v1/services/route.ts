import { z } from "zod";
import { db } from "@/server/db";
import { requireContext } from "@/server/context";
import { audit } from "@/server/audit";
import { body, json, listQuery, route } from "@/server/http";
import { serviceInput } from "@/server/schemas";
import { assertQuota } from "@/server/entitlements";
import { lockManagementActor } from "@/server/service-management";
import { lockServiceActor } from "@/server/service-actor";
import { assertFileDeadlines } from "@/server/file-access";
const query = listQuery.extend({ status: z.enum(["active", "archived", "all"]).default("active") });
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "service.read");
  const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "service.read");
    const where = { ...actor.scope, ...(input.status !== "all" ? { status: input.status } : {}),
      OR: [{ name: { contains: input.search, mode: "insensitive" as const } }, { externalName: { contains: input.search, mode: "insensitive" as const } }] };
    const total = await tx.service.count({ where }), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const items = await tx.service.findMany({ where, take: input.pageSize, skip: (page - 1) * input.pageSize, orderBy: [{ [input.sort]: input.direction }, { id: "asc" }] });
    assertFileDeadlines(actor.deadlines);
    return { items, total, page, pageSize: input.pageSize };
  }));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "service.manage");
  const input = await body(request, serviceInput);
  const service = await db.$transaction(async tx => {
    const actor = await lockManagementActor(tx, ctx, "service.manage");
    await assertQuota(tx, ctx.tenantId, "services");
    const created = await tx.service.create({ data: { ...input, tenantId: ctx.tenantId } });
    await audit(tx, ctx, requestId, "service.created", "service", created.id, Object.keys(input), created.id);
    assertFileDeadlines(actor.deadlines);
    return created;
  });
  const response = json(service, 201);
  response.headers.set("Location", "/api/v1/services/" + service.id);
  return response;
});
