import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { virtualRefundSettle } from "@/server/payments";

const settleBody = z.object({ outcome: z.enum(["refunded", "refund_rejected"]) }).strict();
export const POST = route(async (request, requestId) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
  return json(await virtualRefundSettle(await requireContext(request.headers, "billing.write"),
    id, (await body(request, settleBody)).outcome, requestId));
});
