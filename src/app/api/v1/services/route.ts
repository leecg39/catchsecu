import { z } from "zod";
import { db } from "@/server/db";
import { requireContext, serviceScope } from "@/server/context";
import { audit } from "@/server/audit";
import { body, json, listQuery, route } from "@/server/http";
import { serviceInput } from "@/server/schemas";
import { assertQuota } from "@/server/entitlements";
const query = listQuery.extend({ status: z.enum(["active", "archived", "all"]).default("active") });
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "service.read");
  const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const where = { ...serviceScope(ctx), ...(input.status !== "all" ? { status: input.status } : {}),
    OR: [{ name: { contains: input.search, mode: "insensitive" as const } }, { externalName: { contains: input.search, mode: "insensitive" as const } }] };
  const [items, total] = await db.$transaction([
    db.service.findMany({ where, take: input.pageSize, skip: (input.page - 1) * input.pageSize, orderBy: [{ [input.sort]: input.direction }, { id: "asc" }] }),
    db.service.count({ where }),
  ]);
  return json({ items, total, page: input.page, pageSize: input.pageSize });
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "service.manage");
  const input = await body(request, serviceInput);
  const service = await db.$transaction(async tx => {
    await assertQuota(tx, ctx.tenantId, "services");
    const created = await tx.service.create({ data: { ...input, tenantId: ctx.tenantId } });
    await audit(tx, ctx, requestId, "service.created", "service", created.id, Object.keys(input), created.id);
    return created;
  });
  const response = json(service, 201);
  response.headers.set("Location", "/api/v1/services/" + service.id);
  return response;
});
