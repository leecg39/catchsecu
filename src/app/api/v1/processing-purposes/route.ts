import { purposeInput } from "@/contracts/processing-catalog";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { catalogQuery, createPurpose, listCatalog, lockCatalogService } from "@/server/processing-catalog";
export const GET = route(async request => json(await listCatalog(await requireContext(request.headers, "document.read"), "purposes",
  catalogQuery.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "document.write"), input = await body(request, purposeInput);
  const result = await idempotent("catalog:purposes:" + ctx.member.id, request.headers.get("idempotency-key"), input,
    async tx => ({ status: 201, body: await createPurpose(tx, ctx, input, requestId) }),
    tx => lockCatalogService(tx, ctx, input.serviceId, true));
  return json(result.body, result.status);
});
