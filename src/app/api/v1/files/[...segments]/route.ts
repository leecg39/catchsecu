import { z } from "zod";
import { fileInput } from "@/contracts/domains";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { downloadFile, fileMetadata } from "@/server/file-download";
import { cancelUpload, renameFile } from "@/server/files";
import { fileBindingQuery } from "@/server/file-query";
function parts(request: Request) {
  const url = new URL(request.url), [id, action, ...rest] = url.pathname.split("/").slice(4);
  if (rest.length || (action && action !== "download")) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const binding = fileBindingQuery(url);
  return { id: z.uuid().parse(id), action, binding };
}
export const GET = route(async (request, requestId) => {
  const { id, action, binding } = parts(request), ctx = await requireContext(request.headers);
  if (action === "download") return downloadFile(ctx, id, binding, requestId);
  return json(await fileMetadata(ctx, id, binding, requestId));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const input = await body(request, z.object({ name: fileInput.shape.name, version: z.number().int().positive() }).strict());
  return json(await renameFile(await requireContext(request.headers), id, input, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await cancelUpload({ ctx: await requireContext(request.headers) }, id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
