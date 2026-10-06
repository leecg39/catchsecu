import { z } from "zod";
import { noticePatch } from "@/contracts/notices";
import { requireActor } from "@/server/context";
import { body, json, route } from "@/server/http";
import { archiveNotice, readNotice, updateNotice } from "@/server/notices";

const noticeId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const id = (request: Request) => noticeId.parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async request =>
  json(await readNotice(await requireActor(request.headers), id(request), true)));
export const PATCH = route(async (request, requestId) =>
  json(await updateNotice(await requireActor(request.headers), id(request), await body(request, noticePatch), requestId)));
export const DELETE = route(async (request, requestId) => {
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  await archiveNotice(await requireActor(request.headers), id(request), version, requestId);
  return new Response(null, { status: 204 });
});
