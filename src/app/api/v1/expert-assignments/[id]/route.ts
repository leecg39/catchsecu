import { z } from "zod";
import { requireActor } from "@/server/context";
import { body, json, route } from "@/server/http";
import { getExpertAssignment, revokeExpertAssignment, updateExpertAssignment, updateExpertInput } from "@/server/expert-assignments";

function id(request: Request) { return z.uuid().parse(new URL(request.url).pathname.split("/").filter(Boolean).at(-1)); }
export const GET = route(async request => json(await getExpertAssignment(await requireActor(request.headers), id(request))));
export const PATCH = route(async (request, requestId) => json(await updateExpertAssignment(await requireActor(request.headers),
  id(request), await body(request, updateExpertInput), requestId)));
export const DELETE = route(async (request, requestId) => {
  await revokeExpertAssignment(await requireActor(request.headers), id(request),
    z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
