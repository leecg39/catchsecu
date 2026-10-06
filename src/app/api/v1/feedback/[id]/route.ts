import { z } from "zod";
import { supportTicketId, supportTicketPatch } from "@/contracts/support-tickets";
import { requireActor, requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { archiveSupportTicket, readSupportTicket, updateSupportTicket } from "@/server/support-tickets";

const id = (request: Request) => supportTicketId.parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async (request, requestId) =>
  json(await readSupportTicket(await requireActor(request.headers), id(request), false, requestId,
    await requireContext(request.headers))));
export const PATCH = route(async (request, requestId) =>
  json(await updateSupportTicket(await requireContext(request.headers), id(request),
    await body(request, supportTicketPatch), requestId)));
export const DELETE = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const ctx = await requireContext(request.headers);
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  await archiveSupportTicket(actor, id(request), version, requestId, ctx);
  return new Response(null, { status: 204 });
});
