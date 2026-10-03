import { requireActor } from "@/server/context";
import { auditEventQuery, exportOwnAuditEvents } from "@/server/audit-events";
import { route } from "@/server/http";
export const GET = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const input = auditEventQuery.parse({ scope: "mine", ...Object.fromEntries(new URL(request.url).searchParams) });
  return new Response(await exportOwnAuditEvents(actor.user, input, requestId), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="my-activity.csv"',
  } });
});
