import { z } from "zod";
import { reviewNotify } from "@/contracts/activity-reviews";
import { notifyActivityReview } from "@/server/activity-reviews";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "service.read"), input = await body(request, reviewNotify);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[4]);
  const result = await notifyActivityReview(ctx, id, input, request.headers.get("idempotency-key"), requestId); return json(result.body, result.status);
});
