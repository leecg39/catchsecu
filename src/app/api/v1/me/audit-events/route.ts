import { requireActor } from "@/server/context";
import { auditEventQuery, listOwnAuditEvents } from "@/server/audit-events";
import { json, route } from "@/server/http";
import { requestQuery } from "@/server/request-query";
export const GET = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const input = auditEventQuery.parse({ scope: "mine", ...requestQuery(request) });
  return json(await listOwnAuditEvents(actor, input, requestId));
});
