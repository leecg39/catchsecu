import { z } from "zod";
import { submissionFilters } from "@/contracts/submissions";
import { requireContext } from "@/server/context";
import { route } from "@/server/http";
import { exportSubmissions } from "@/server/submission-export";

export const GET = route(async (request, requestId) => {
  const url = new URL(request.url), id = z.uuid().parse(url.pathname.split("/")[4]);
  const ctx = await requireContext(request.headers, "submission.read"), input = submissionFilters.parse(Object.fromEntries(url.searchParams));
  const result = await exportSubmissions(ctx, id, input, requestId);
  return new Response(result.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="responses-' + id + '.csv"',
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Export-Row-Count": String(result.rowCount) } });
});
