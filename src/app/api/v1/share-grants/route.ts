import { shareCreateInput, shareListQuery, sharingEmptyQuery } from "@/contracts/sharing";
import { requireContext } from "@/server/context";
import { body, json, rateLimit, route } from "@/server/http";
import { createShareRequest, listShares } from "@/server/sharing";
import { sharingQuery } from "@/server/share-query";
export const GET = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "share.manage"), { formId, ...query } = sharingQuery(new URL(request.url), shareListQuery);
  return json(await listShares(ctx, formId, query, requestId));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "share.manage"), input = await body(request, shareCreateInput);
  sharingQuery(new URL(request.url), sharingEmptyQuery);
  await rateLimit("share:manage:" + ctx.member.id, 20);
  const result = await createShareRequest(ctx, input, request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
