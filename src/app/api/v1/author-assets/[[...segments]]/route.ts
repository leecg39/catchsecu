import { authorAssetReadQuery, memberAuthorAssets } from "@/server/author-asset-reads";
import { sharingQuery } from "@/server/share-query";
import { z } from "zod";
import { authorAssetUploadInput } from "@/contracts/author-assets";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { authorAssetUsage, completeAuthorAssetUpload, discardAuthorAssetUpload, downloadAuthorAssetUpload,
  getAuthorAssetUpload, initAuthorAssetUpload, putAuthorAssetContent } from "@/server/author-asset-uploads";

function parts(request: Request) {
  const path = new URL(request.url).pathname.split("/").slice(4);
  if (path.at(-1) === "") path.pop();
  if (path.length > 3) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return path;
}
export const POST = route(async (request, requestId) => {
  const [kind, rawId, action] = parts(request);
  const ctx = await requireContext(request.headers, "form.write");
  if (kind === "uploads" && !rawId) {
    await rateLimit("author-asset:init:" + ctx.member.id, 30);
    const result = await initAuthorAssetUpload(ctx, await body(request, authorAssetUploadInput), request.headers.get("idempotency-key"), requestId);
    return json(result.body, result.status);
  }
  if (kind !== "uploads" || !rawId || action !== "complete") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const id = z.uuid().parse(rawId);
  await rateLimit("author-asset:scan:" + id, 15);
  return json(await completeAuthorAssetUpload(ctx, id, requestId));
});
export const PUT = route(async (request, requestId) => {
  const [kind, rawId, action] = parts(request);
  if (kind !== "uploads" || !rawId || action !== "content") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.write"), id = z.uuid().parse(rawId);
  await rateLimit("author-asset:content:" + id, 30);
  return json(await putAuthorAssetContent(ctx, id, request, requestId));
});
export const GET = route(async (request, requestId) => {
  const [kind, rawId, action] = parts(request);
  if (!kind || (rawId === "download" && !action)) {
    const scope = authorAssetReadQuery(new URL(request.url));
    const ctx = await requireContext(request.headers, scope.kind === "submission" ? "submission.read" : "form.read");
    const result = await memberAuthorAssets(ctx, scope, requestId, kind ? z.uuid().parse(kind) : undefined);
    return result instanceof Response ? result : json(result);
  }
  const ctx = await requireContext(request.headers, "form.write");
  if (kind === "usage" && !rawId) {
    const input = sharingQuery(new URL(request.url), z.object({ serviceId: z.uuid() }).strict());
    return json(await authorAssetUsage(ctx, input.serviceId));
  }
  if (kind !== "uploads" || !rawId || (action && action !== "download")) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const id = z.uuid().parse(rawId);
  await rateLimit("author-asset:read:" + ctx.member.id, 120);
  if (action === "download") return downloadAuthorAssetUpload(ctx, id, requestId);
  return json(await getAuthorAssetUpload(ctx, id));
});
export const DELETE = route(async (request, requestId) => {
  const [kind, rawId, action] = parts(request);
  if (kind !== "uploads" || !rawId || action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.write"), id = z.uuid().parse(rawId);
  const input = sharingQuery(new URL(request.url), z.object({ version: z.coerce.number().int().positive() }).strict());
  await discardAuthorAssetUpload(ctx, id, input.version, requestId);
  return new Response(null, { status: 204 });
});
