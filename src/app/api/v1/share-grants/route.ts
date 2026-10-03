import { z } from "zod";
import { shareCreateInput } from "@/contracts/sharing";
import { requireContext } from "@/server/context";
import { body, json, listQuery, rateLimit, route } from "@/server/http";
import { createShare, listShares, lockShareForm } from "@/server/sharing";
import { idempotent } from "@/server/idempotency";
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "share.manage"), params = Object.fromEntries(new URL(request.url).searchParams);
  const query = listQuery.extend({ status: z.enum(["all", "active", "expired", "revoked"]).optional() }).parse(params);
  return json(await listShares(ctx, z.uuid().parse(params.formId), query));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "share.manage"), input = await body(request, shareCreateInput);
  await rateLimit("share:manage:" + ctx.member.id, 20);
  const result = await idempotent("share:create:" + ctx.tenantId + ":" + ctx.member.id, request.headers.get("idempotency-key"), input,
    async tx => ({ status: 201, body: await createShare(ctx, input, requestId, tx) }), tx => lockShareForm(tx, ctx, input.formId));
  return json(result.body, result.status);
});
