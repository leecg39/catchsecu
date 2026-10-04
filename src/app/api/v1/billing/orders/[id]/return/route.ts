import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { rejectPaymentReturn } from "@/server/payments";

const input = z.object({ result: z.enum(["success", "fail"]) }).strict();
export const POST = route(async request => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
  await body(request, input);
  return json(await rejectPaymentReturn(await requireContext(request.headers, "billing.write"), id));
});
