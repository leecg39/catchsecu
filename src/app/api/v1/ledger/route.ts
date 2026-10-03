import { ledgerQuery } from "@/contracts/ledger";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { ledgerOverview } from "@/server/ledger";

export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "billing.read");
  const query = ledgerQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await ledgerOverview(ctx, query));
});
