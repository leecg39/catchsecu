import { z } from "zod";
import { requireContext } from "@/server/context";
import { route } from "@/server/http";
import { complianceCloseCsv } from "@/server/compliance-close";

export const GET = route(async (request, requestId) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
  const csv = await complianceCloseCsv(await requireContext(request.headers, "service.read"), id, requestId);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="compliance-close.csv"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
