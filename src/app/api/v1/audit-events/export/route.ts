import { requireContext } from "@/server/context";
import { auditEventQuery, exportAuditEvents } from "@/server/audit-events";
import { rateLimit, route } from "@/server/http";
import { requestQuery } from "@/server/request-query";

export const GET = route(async (request, requestId) => {
  const input = auditEventQuery.parse(requestQuery(request));
  const ctx = await requireContext(request.headers, input.scope === "company" ? "audit.read" : undefined);
  await rateLimit("audit-export:" + ctx.user.id, 10);
  return new Response(await exportAuditEvents(ctx, input, requestId), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="audit-events.csv"',
    "X-Content-Type-Options": "nosniff",
  } });
});
