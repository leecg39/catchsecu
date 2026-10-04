import { reviewCreate, reviewQuery } from "@/contracts/activity-reviews";
import { createActivityReview, listActivityReviews } from "@/server/activity-reviews";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
export const GET = route(async request => json(await listActivityReviews(await requireContext(request.headers, "service.read"), reviewQuery.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "security.write"), input = await body(request, reviewCreate);
  const result = await createActivityReview(ctx, input, request.headers.get("idempotency-key"), requestId);
  const response = json(result.body, result.status); response.headers.set("Location", "/api/v1/activity-reviews/" + result.body.id); return response;
});
