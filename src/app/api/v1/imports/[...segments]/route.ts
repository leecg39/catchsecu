import { z } from "zod";
import { importAction, importPatch } from "@/contracts/imports";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { commitImport, getImport, importErrorsCsv, importOptions, importRowsQuery, inspectImport, previewImport, removeImport, updateImport, validateImport } from "@/server/imports";
function parts(request: Request) {
  const url = new URL(request.url), [id, action, ...rest] = url.pathname.split("/").slice(4);
  if (rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: id === "options" ? id : z.uuid().parse(id), action, query: Object.fromEntries(url.searchParams) };
}
export const GET = route(async (request, requestId) => {
  const { id, action, query } = parts(request), ctx = await requireContext(request.headers, "import.read");
  if (id === "options" && !action) return json(await importOptions(ctx, z.uuid().parse(query.serviceId)));
  if (!action && id !== "options") return json(await getImport(ctx, id, requestId));
  if (action === "rows") return json(await previewImport(ctx, id, importRowsQuery.parse(query), requestId));
  if (action === "errors.csv") return new Response(await importErrorsCsv(ctx, id, requestId), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="import-errors.csv"', "X-Content-Type-Options": "nosniff" } });
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action || id === "options") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "import.write"), input = await body(request, importPatch);
  return json(await updateImport(ctx, id, input.version, input.mapping, requestId));
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request), ctx = await requireContext(request.headers, "import.write"), input = await body(request, importAction);
  await rateLimit("import:process:" + ctx.member.id, 30);
  if (action === "inspect") return json(await inspectImport(ctx, id, input.version, requestId));
  if (action === "validate") return json(await validateImport(ctx, id, input.version, requestId));
  if (action === "commit" || action === "retry") return json(await commitImport(ctx, id, input.version, requestId, action === "retry"), 202);
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action || id === "options") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await removeImport(await requireContext(request.headers, "import.write"), id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId));
});
