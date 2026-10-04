import { z } from "zod";
import { complianceExportChange } from "@/contracts/compliance-exports";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { changeComplianceExport, downloadComplianceExport, getComplianceExport } from "@/server/compliance-exports";
function path(request: Request) { const parts = new URL(request.url).pathname.split("/").slice(5); const id = z.uuid().parse(parts[0]); if (parts.length > 2) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다."); return { id, action: parts[1] }; }
export const GET = route(async (request, requestId) => {
  const { id, action } = path(request), ctx = await requireContext(request.headers, "service.read");
  if (!action) return json(await getComplianceExport(ctx, id));
  if (action !== "download") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const result = await downloadComplianceExport(ctx, id, requestId);
  return new Response(result.bytes, { headers: { "Content-Type": result.format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${result.filename}"`, "Content-Length": String(result.bytes!.length),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "X-Export-SHA256": result.hash!, "X-Source-SHA256": result.sourceHash!, "Content-Security-Policy": "sandbox; default-src 'none'" } });
});
export const POST = route(async (request, requestId) => {
  const { id, action } = path(request); if (action !== "cancel") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "service.read"), input = await body(request, complianceExportChange);
  return json(await changeComplianceExport(ctx, id, input.version, false, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = path(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "service.read"), input = await body(request, complianceExportChange);
  await changeComplianceExport(ctx, id, input.version, true, requestId); return new Response(null, { status: 204 });
});
