import { analyticsQuery } from "@/contracts/analytics";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { complianceOverview } from "@/server/scoped-analytics";

export const GET = route(async (request, requestId) => {
  const input = analyticsQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await complianceOverview(await requireContext(request.headers, "security.read"), input, requestId));
});
