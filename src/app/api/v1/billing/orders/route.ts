import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { requestPaymentOrder, listPaymentOrders } from "@/server/payments";

const input = z.object({ subscriptionId: z.uuid(), methodId: z.uuid().optional() }).strict();
export const GET = route(async request => json(await listPaymentOrders(await requireContext(request.headers, "billing.read"))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "billing.write");
  const parsed = await body(request, input);
  const result = await requestPaymentOrder(ctx, parsed, request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
