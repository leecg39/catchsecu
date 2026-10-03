import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { accessDecisionInput, cancelAccessRequest, decideAccessRequest } from "@/server/access-requests";

export const PATCH = route(async (request, requestId) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-1));
  return json(await decideAccessRequest(await requireContext(request.headers, "member.manage"), id,
    await body(request, accessDecisionInput), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-1));
  await cancelAccessRequest(await requireContext(request.headers), id,
    z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
