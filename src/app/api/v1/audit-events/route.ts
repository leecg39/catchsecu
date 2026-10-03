import { requireContext } from "@/server/context";
import { auditEventQuery, listAuditEvents } from "@/server/audit-events";
import { json, route } from "@/server/http";

export const GET = route(async request => {
  const input = auditEventQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  const ctx = await requireContext(request.headers, input.scope === "company" ? "audit.read" : undefined);
  return json(await listAuditEvents(ctx, input));
});
