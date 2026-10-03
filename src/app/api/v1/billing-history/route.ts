import { billingHistoryQuery } from "@/contracts/billing-history";
import { requireContext } from "@/server/context";
import { billingHistory } from "@/server/billing-history";
import { json, route } from "@/server/http";

export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "billing.read");
  const query = billingHistoryQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await billingHistory(ctx, query));
});
