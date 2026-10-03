import { z } from "zod";
import { guideCreate, guideList, guidePatch } from "@/contracts/guides";
import { requireActor, requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { archiveGuide, createGuide, downloadGuide, listGuides, readGuide, replaceGuideFile, updateGuide } from "@/server/guides";
import { readFileBody } from "@/server/file-validation";

const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4).filter(Boolean);
const guideId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
async function reader(request: Request) {
  const actor = await requireActor(request.headers);
  if (!actor.user.platformAdmin) await requireContext(request.headers);
  return actor;
}
export const GET = route(async (request, requestId) => {
  const actor = await reader(request), path = parts(request), url = new URL(request.url);
  if (!path.length) return json(await listGuides(actor, guideList.parse(Object.fromEntries(url.searchParams))));
  if (path.length === 1) return json(await readGuide(actor, guideId.parse(path[0]), url.searchParams.get("preview") === "1"));
  if (path.length === 2 && path[1] === "download") return downloadGuide(actor, guideId.parse(path[0]), url.searchParams.get("preview") === "1", requestId);
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  if (parts(request).length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  await rateLimit("guide:change:" + actor.user.id, 60);
  const result = await createGuide(actor, await body(request, guideCreate), request.headers.get("idempotency-key"), requestId);
  const response = json(result.body, result.status);
  response.headers.set("Location", "/api/v1/guides/" + result.body.id);
  return response;
});
export const PATCH = route(async (request, requestId) => {
  const path = parts(request); if (path.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  await rateLimit("guide:change:" + actor.user.id, 60);
  return json(await updateGuide(actor, guideId.parse(path[0]), await body(request, guidePatch), requestId));
});
export const PUT = route(async (request, requestId) => {
  const path = parts(request); if (path.length !== 2 || path[1] !== "file") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  if (!actor.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다.");
  await rateLimit("guide:file:" + actor.user.id, 20);
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  const size = z.coerce.number().int().min(1).max(10485760).parse(request.headers.get("x-file-size"));
  const hash = z.string().regex(/^[0-9a-f]{64}$/).parse(request.headers.get("x-file-sha256"));
  const encodedName = z.string().min(1).max(1000).parse(request.headers.get("x-file-name"));
  let fileName: string; try { fileName = decodeURIComponent(encodedName); } catch { fail(422, "FILE_NAME", "파일 이름을 확인해주세요."); }
  const bytes = await readFileBody(request, size, "application/pdf");
  if (bytes.length !== size) fail(422, "FILE_INTEGRITY", "PDF 크기가 일치하지 않습니다.");
  return json(await replaceGuideFile(actor, guideId.parse(path[0]), version, fileName, bytes, hash, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const path = parts(request); if (path.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  await rateLimit("guide:change:" + actor.user.id, 60);
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  await archiveGuide(actor, guideId.parse(path[0]), version, requestId);
  return new Response(null, { status: 204 });
});
