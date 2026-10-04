import { z } from "zod";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { readPaymentOrder } from "@/server/payments";

export const GET = route(async request => {
  const url = new URL(request.url);
  const id = z.uuid().parse(url.pathname.split("/")[5]);
  const order = await readPaymentOrder(await requireContext(request.headers, "billing.read"), id);
  return json({ ...order, returnResultIgnored: url.searchParams.get("result") });
});
