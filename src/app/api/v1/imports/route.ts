import { importCreate } from "@/contracts/imports";
import { requireContext } from "@/server/context";
import { body, json, rateLimit, route } from "@/server/http";
import { createImport, importQuery, listImports } from "@/server/imports";
export const GET = route(async (request, requestId) => json(await listImports(await requireContext(request.headers, "import.read"),
  importQuery.parse(Object.fromEntries(new URL(request.url).searchParams)), requestId)));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "import.write"); await rateLimit("import:create:" + ctx.member.id, 30);
  const result = await createImport(ctx, await body(request, importCreate), request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
