import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { accessRequestInput, createAccessRequest, listAccessRequests } from "@/server/access-requests";

const query = listQuery.pick({ page: true, pageSize: true }).extend({
  scope: z.enum(["mine", "review"]).default("mine"),
  status: z.enum(["all", "pending", "approved", "rejected", "cancelled"]).default("all"),
});
export const GET = route(async request => json(await listAccessRequests(await requireContext(request.headers),
  query.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers);
  const result = await createAccessRequest(ctx, await body(request, accessRequestInput), requestId);
  return json(result.body, result.status);
});
