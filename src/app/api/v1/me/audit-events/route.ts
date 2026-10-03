import { requireActor } from "@/server/context";
import { auditEventQuery, listOwnAuditEvents } from "@/server/audit-events";
import { json, route } from "@/server/http";
export const GET = route(async request => {
  const actor = await requireActor(request.headers);
  const input = auditEventQuery.parse({ scope: "mine", ...Object.fromEntries(new URL(request.url).searchParams) });
  return json(await listOwnAuditEvents(actor.user, input));
});
