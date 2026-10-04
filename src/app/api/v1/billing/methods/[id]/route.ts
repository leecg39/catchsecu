import { z } from "zod";
import { paymentMethodRemove, paymentMethodUpdate } from "@/contracts/payment-methods";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { removePaymentMethod, updatePaymentMethod } from "@/server/payment-methods";

export const PATCH = route(async (request, requestId) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
  const ctx = await requireContext(request.headers, "billing.write");
  return json(await updatePaymentMethod(ctx, id, await body(request, paymentMethodUpdate), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
  const ctx = await requireContext(request.headers, "billing.write");
  return json(await removePaymentMethod(ctx, id, (await body(request, paymentMethodRemove)).version, requestId));
});
