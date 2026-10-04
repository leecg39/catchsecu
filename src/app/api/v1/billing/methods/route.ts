import { paymentMethodCreate, paymentMethodListQuery } from "@/contracts/payment-methods";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createPaymentMethod, listPaymentMethods } from "@/server/payment-methods";

export const GET = route(async request => {
  const query = paymentMethodListQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await listPaymentMethods(await requireContext(request.headers, "billing.read"), query));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "billing.write");
  return json(await createPaymentMethod(ctx, await body(request, paymentMethodCreate), requestId), 201);
});
