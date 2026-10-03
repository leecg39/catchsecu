import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { memberUploadInput } from "@/contracts/files";
import { cancelUpload, completeUpload, getUpload, initMemberUpload, uploadContent } from "@/server/files";
import type { FilePrincipal } from "@/server/file-access";
function parts(request: Request) {
  const [rawId, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length || !rawId) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: rawId === "init" ? rawId : z.uuid().parse(rawId), action };
}
async function principal(request: Request): Promise<FilePrincipal> {
  const token = request.headers.get("x-upload-token");
  return token ? { token } : { ctx: await requireContext(request.headers) };
}
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (id === "init" && !action) {
    const ctx = await requireContext(request.headers);
    await rateLimit("upload:init:" + ctx.member.id, 30);
    const result = await initMemberUpload(ctx, await body(request, memberUploadInput), request.headers.get("idempotency-key"), requestId);
    return json(result.body, result.status);
  }
  if (action !== "complete") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await principal(request);
  await rateLimit("upload:scan:" + id, 15);
  return json(await completeUpload(actor, id, requestId));
});
export const PUT = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action !== "content" || id === "init") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await principal(request);
  await rateLimit("upload:content:" + id, 30);
  return json(await uploadContent(actor, id, request, requestId));
});
export const GET = route(async request => {
  const { id, action } = parts(request);
  if (action || id === "init") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await principal(request);
  await rateLimit("upload:status:" + id, 120);
  return json(await getUpload(actor, id));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action || id === "init") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await cancelUpload(await principal(request), id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
