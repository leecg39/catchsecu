import { clauseInput } from "@/contracts/documents";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createClause, listClauses, clauseQuery, lockDocumentService } from "@/server/documents";
export const GET = route(async request => json(await listClauses(await requireContext(request.headers, "document.read"), clauseQuery.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "document.write"), input = await body(request, clauseInput);
  const result = await idempotent("clause:create:" + ctx.member.id, request.headers.get("idempotency-key"), input,
    async tx => ({ status: 201, body: await createClause(tx, ctx, input, requestId) }), tx => lockDocumentService(tx, ctx, input.serviceId, "document.write"));
  return json(result.body, result.status);
});
