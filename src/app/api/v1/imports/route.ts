import { importCreate } from "@/contracts/imports";
import { requireContext } from "@/server/context";
import { body, json, rateLimit, route } from "@/server/http";
import { createImport, emptyImportQuery, importRequestQuery, importQuery, listImports } from "@/server/imports";
export const GET = route(async (request, requestId) => json(await listImports(await requireContext(request.headers, "import.read"),
  importQuery.parse(importRequestQuery(request)), requestId)));
export const POST = route(async (request, requestId) => {
  emptyImportQuery(request);
  const ctx = await requireContext(request.headers, "import.write"); await rateLimit("import:create:" + ctx.member.id, 30);
  const result = await createImport(ctx, await body(request, importCreate), request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
