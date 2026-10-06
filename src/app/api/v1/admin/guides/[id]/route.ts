import { z } from "zod";
import { guidePatch } from "@/contracts/guides";
import { requireActor } from "@/server/context";
import { body, json, route } from "@/server/http";
import { archiveGuide, readGuide, updateGuide } from "@/server/guides";

const guideId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const id = (request: Request) => guideId.parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async request =>
  json(await readGuide(await requireActor(request.headers), id(request), true)));
export const PATCH = route(async (request, requestId) =>
  json(await updateGuide(await requireActor(request.headers), id(request), await body(request, guidePatch), requestId)));
export const DELETE = route(async (request, requestId) => {
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  await archiveGuide(await requireActor(request.headers), id(request), version, requestId);
  return new Response(null, { status: 204 });
});
