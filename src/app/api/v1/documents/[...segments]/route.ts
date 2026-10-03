import { z } from "zod";
import { clauseApply, documentAction, documentPatch, documentPublish } from "@/contracts/documents";
import { requireContext } from "@/server/context";
import { body, fail, json, listQuery, route } from "@/server/http";
import { readDocument, updateDocument, changeDocumentState, previewDocument, documentHistory, publishDocument, revokeDocumentLink, applyClause } from "@/server/documents";
function parts(request: Request) {
  const [id, action, ...extra] = new URL(request.url).pathname.split("/").slice(4);
  if (extra.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다."); return { id: z.uuid().parse(id), action };
}
export const GET = route(async request => {
  const { id, action } = parts(request), ctx = await requireContext(request.headers, "document.read");
  if (!action) return json(await readDocument(ctx, id));
  if (action === "preview") return json(await previewDocument(ctx, id));
  if (action === "versions") return json(await documentHistory(ctx, id, listQuery.parse(Object.fromEntries(new URL(request.url).searchParams))));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateDocument(await requireContext(request.headers, "document.write"), id, await body(request, documentPatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await changeDocumentState(await requireContext(request.headers, "document.write"), id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), "archive", requestId);
  return new Response(null, { status: 204 });
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request), ctx = await requireContext(request.headers, "document.write");
  if (action === "publish") return json(await publishDocument(ctx, id, await body(request, documentPublish), requestId), 201);
  if (action === "revoke") return json(await revokeDocumentLink(ctx, id, await body(request, documentAction.extend({ publicationId: z.uuid() })), requestId));
  if (action === "apply-clause") return json(await applyClause(ctx, id, await body(request, clauseApply), requestId));
  if (action === "unpublish" || action === "restore") return json(await changeDocumentState(ctx, id, (await body(request, documentAction)).version, action, requestId));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
