import { analyticsQuery } from "@/contracts/analytics";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { privacyAnalytics } from "@/server/scoped-analytics";
import { requestQuery } from "@/server/request-query";

export const GET = route(async (request, requestId) => {
  const input = analyticsQuery.parse(requestQuery(request));
  return json(await privacyAnalytics(await requireContext(request.headers, "submission.read"), input, requestId));
});
