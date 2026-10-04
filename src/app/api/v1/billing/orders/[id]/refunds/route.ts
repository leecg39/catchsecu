import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { refundRequest } from "@/contracts/billing-settlement";
import { listRefunds, requestRefund } from "@/server/billing-settlement";

const orderId = (request: Request) => z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
export const GET = route(async request => json(await listRefunds(await requireContext(request.headers, "billing.read"), orderId(request))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "billing.write");
  const input = await body(request, refundRequest);
  const result = await requestRefund(ctx, orderId(request), input, request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
