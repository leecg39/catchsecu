import { z } from "zod";
import { exportChangeInput } from "@/contracts/exports";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { changeExport, downloadExport, getExport } from "@/server/exports";

function path(request: Request) { const parts = new URL(request.url).pathname.split("/").slice(4); const id = z.uuid().parse(parts[0]); if (parts.length > 2) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다."); return { id, action: parts[1] }; }
export const GET = route(async (request, requestId) => {
  const { id, action } = path(request), ctx = await requireContext(request.headers, "submission.read");
  if (!action) return json(await getExport(ctx, id));
  if (action !== "download") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const result = await downloadExport(ctx, id, requestId);
  return new Response(result.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="responses-' + id + '.csv"', "X-Content-Type-Options": "nosniff", "X-Export-Row-Count": String(result.rowCount) } });
});
export const POST = route(async (request, requestId) => {
  const { id, action } = path(request); if (action !== "cancel") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "submission.read"), input = await body(request, exportChangeInput);
  return json(await changeExport(ctx, id, input.version, false, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = path(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "submission.read"), input = await body(request, exportChangeInput);
  await changeExport(ctx, id, input.version, true, requestId); return new Response(null, { status: 204 });
});
