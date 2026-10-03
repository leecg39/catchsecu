import { analyticsQuery } from "@/contracts/analytics";
import { dashboardAnalytics } from "@/server/analytics";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";

export const GET = route(async (request, requestId) => {
  const input = analyticsQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await dashboardAnalytics(await requireContext(request.headers, "service.read"), input, requestId));
});
