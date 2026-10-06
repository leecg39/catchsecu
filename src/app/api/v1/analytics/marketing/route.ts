import { marketingSummaryQuery } from "@/contracts/marketing";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { marketingSummary } from "@/server/marketing";

// /marketing/summary와 동일 집계의 분석 별칭. 권한은 marketing.read로 동일하게 검사한다.
export const GET = route(async (request, requestId) => {
  const input = marketingSummaryQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await marketingSummary(await requireContext(request.headers, "marketing.read"), input, requestId));
});
