import { requireActor } from "@/server/context";
import { auditEventQuery, exportOwnAuditEvents } from "@/server/audit-events";
import { route } from "@/server/http";
import { requestQuery } from "@/server/request-query";
export const GET = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const input = auditEventQuery.parse({ scope: "mine", ...requestQuery(request) });
  return new Response(await exportOwnAuditEvents(actor, input, requestId), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="my-activity.csv"',
  } });
});
