import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { virtualPaymentCheckout } from "@/server/payments";

const checkoutBody = z.object({ outcome: z.enum(["paid", "failed"]) }).strict();
export const POST = route(async (request, requestId) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
  return json(await virtualPaymentCheckout(await requireContext(request.headers, "billing.write"),
    id, (await body(request, checkoutBody)).outcome, requestId));
});
