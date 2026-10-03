import { z } from "zod";
import { catalogAction, recipientPatch } from "@/contracts/processing-catalog";
import { requireContext } from "@/server/context";
import { body, fail, json, listQuery, route } from "@/server/http";
import { catalogHistory, changeCatalogStatus, readCatalog, updateRecipient } from "@/server/processing-catalog";
function parts(request: Request) {
  const [id, action, ...extra] = new URL(request.url).pathname.split("/").slice(4);
  if (extra.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: z.uuid().parse(id), action };
}
export const GET = route(async request => {
  const { id, action } = parts(request), ctx = await requireContext(request.headers, "document.read");
  if (action && action !== "history") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(action ? await catalogHistory(ctx, "recipients", id, listQuery.parse(Object.fromEntries(new URL(request.url).searchParams))) : await readCatalog(ctx, "recipients", id));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateRecipient(await requireContext(request.headers, "document.write"), id, await body(request, recipientPatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await changeCatalogStatus(await requireContext(request.headers, "document.write"), "recipients", id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), false, requestId);
  return new Response(null, { status: 204 });
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action !== "restore") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const input = await body(request, catalogAction);
  return json(await changeCatalogStatus(await requireContext(request.headers, "document.write"), "recipients", id, input.version, true, requestId));
});
