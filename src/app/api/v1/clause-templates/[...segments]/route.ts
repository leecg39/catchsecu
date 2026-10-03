import { z } from "zod";
import { documentAction, clausePatch } from "@/contracts/documents";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { readClause, updateClause, changeClauseState } from "@/server/documents";
function parts(request: Request) {
  const [id, action, ...extra] = new URL(request.url).pathname.split("/").slice(4);
  if (extra.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다."); return { id: z.uuid().parse(id), action };
}
export const GET = route(async request => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await readClause(await requireContext(request.headers, "document.read"), id));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateClause(await requireContext(request.headers, "document.write"), id, await body(request, clausePatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await changeClauseState(await requireContext(request.headers, "document.write"), id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), false, requestId); return new Response(null, { status: 204 });
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action !== "restore") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await changeClauseState(await requireContext(request.headers, "document.write"), id, (await body(request, documentAction)).version, true, requestId));
});
