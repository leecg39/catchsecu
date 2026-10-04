import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { closeMonthRequest, monthQuery } from "@/contracts/billing-settlement";
import { closeMonth, readMonthClose } from "@/server/billing-settlement";

export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "billing.read");
  const query = monthQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await readMonthClose(ctx, query.month, query.currency));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "billing.write");
  const input = await body(request, closeMonthRequest);
  const result = await closeMonth(ctx, input.month, input.currency, request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
