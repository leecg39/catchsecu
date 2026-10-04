import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createPaymentOrder } from "@/server/payments";

const input = z.object({ subscriptionId: z.uuid() }).strict();
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "billing.write");
  const parsed = await body(request, input);
  const result = await idempotent("billing-order:" + ctx.tenantId, request.headers.get("idempotency-key"), parsed, async tx => {
    const row = await createPaymentOrder(tx, ctx, parsed.subscriptionId, requestId);
    return { status: 201, body: row, resource: { tenantId: ctx.tenantId, resourceType: "payment-order" as const, resourceId: row.id } };
  });
  return json(result.body, result.status);
});
