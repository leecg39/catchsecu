import { z } from "zod";
import { noticeCreate, noticeList, noticePatch } from "@/contracts/notices";
import { requireActor } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { archiveNotice, createNotice, listNotices, readNotice, updateNotice } from "@/server/notices";
import { deleteNoticeAttachment, downloadNoticeAttachment, uploadNoticeAttachment } from "@/server/notice-attachments";
import { readFileBody } from "@/server/file-validation";

const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4).filter(Boolean);
const noticeId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const attachmentId = z.string().uuid();
const mimeType = z.enum(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);
export const GET = route(async (request, requestId) => {
  const actor = await requireActor(request.headers), path = parts(request), url = new URL(request.url);
  if (!path.length) return json(await listNotices(actor, noticeList.parse(Object.fromEntries(url.searchParams))));
  if (path.length === 1) return json(await readNotice(actor, noticeId.parse(path[0]), url.searchParams.get("preview") === "1"));
  if (path.length === 3 && path[1] === "attachments") return downloadNoticeAttachment(actor,
    noticeId.parse(path[0]), attachmentId.parse(path[2]), url.searchParams.get("preview") === "1", requestId);
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  if (parts(request).length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  await rateLimit("notice:change:" + actor.user.id, 60);
  const result = await createNotice(actor, await body(request, noticeCreate), request.headers.get("idempotency-key"), requestId);
  const response = json(result.body, result.status);
  response.headers.set("Location", "/api/v1/notices/" + result.body.id);
  return response;
});
export const PATCH = route(async (request, requestId) => {
  const path = parts(request); if (path.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  await rateLimit("notice:change:" + actor.user.id, 60);
  return json(await updateNotice(actor, noticeId.parse(path[0]), await body(request, noticePatch), requestId));
});
export const PUT = route(async (request, requestId) => {
  const path = parts(request);
  if (path.length !== 3 || path[1] !== "attachments") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  if (!actor.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다.");
  await rateLimit("notice:file:" + actor.user.id, 30);
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  const size = z.coerce.number().int().min(1).max(10485760).parse(request.headers.get("x-file-size"));
  const hash = z.string().regex(/^[0-9a-f]{64}$/).parse(request.headers.get("x-file-sha256"));
  const encodedName = z.string().min(1).max(1000).parse(request.headers.get("x-file-name"));
  const mime = mimeType.parse(request.headers.get("content-type")?.split(";")[0].trim());
  let fileName: string;
  try { fileName = decodeURIComponent(encodedName); } catch { fail(422, "FILE_NAME", "파일 이름을 확인해주세요."); }
  const bytes = await readFileBody(request, size, mime);
  if (bytes.length !== size) fail(422, "FILE_INTEGRITY", "파일 크기가 일치하지 않습니다.");
  return json(await uploadNoticeAttachment(actor, noticeId.parse(path[0]), attachmentId.parse(path[2]),
    version, fileName, mime, bytes, hash, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const path = parts(request); if (path.length !== 1 && !(path.length === 3 && path[1] === "attachments"))
    fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  await rateLimit("notice:change:" + actor.user.id, 60);
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  if (path.length === 3) {
    await deleteNoticeAttachment(actor, noticeId.parse(path[0]), attachmentId.parse(path[2]), version, requestId);
    return new Response(null, { status: 204 });
  }
  await archiveNotice(actor, noticeId.parse(path[0]), version, requestId);
  return new Response(null, { status: 204 });
});
