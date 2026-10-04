import { collectDestructionQuery } from "@/contracts/analytics";
import { collectDestructionCsv } from "@/server/collect-destruction";
import { requireContext } from "@/server/context";
import { route } from "@/server/http";
import { requestQuery } from "@/server/request-query";

export const GET = route(async (request, requestId) => {
  const input = collectDestructionQuery.parse(requestQuery(request));
  const csv = await collectDestructionCsv(await requireContext(request.headers, "service.read"), input, requestId);
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="collect-destruction.csv"',
    "Cache-Control": "no-store",
  } });
});
