import { documentInput } from "@/contracts/documents";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createDocument, listDocuments, documentQuery, lockDocumentService } from "@/server/documents";
export const GET = route(async request => json(await listDocuments(await requireContext(request.headers, "document.read"), documentQuery.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "document.write"), input = await body(request, documentInput);
  const result = await idempotent("document:create:" + ctx.member.id, request.headers.get("idempotency-key"), input,
    async tx => ({ status: 201, body: await createDocument(tx, ctx, input, requestId) }), tx => lockDocumentService(tx, ctx, input.serviceId, "document.write"));
  return json(result.body, result.status);
});
