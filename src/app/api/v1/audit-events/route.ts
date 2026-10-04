import { requireContext } from "@/server/context";
import { auditEventQuery, listAuditEvents } from "@/server/audit-events";
import { json, route } from "@/server/http";
import { requestQuery } from "@/server/request-query";

export const GET = route(async (request, requestId) => {
  const input = auditEventQuery.parse(requestQuery(request));
  const ctx = await requireContext(request.headers, input.scope === "company" ? "audit.read" : undefined);
  return json(await listAuditEvents(ctx, input, requestId));
});
