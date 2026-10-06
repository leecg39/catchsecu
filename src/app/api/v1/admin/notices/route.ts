import { noticeCreate, noticeList } from "@/contracts/notices";
import { requireActor } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createNotice, listNotices } from "@/server/notices";

// 운영자 전용 별칭: /notices와 동일 저장소이며 목록은 항상 admin 범위다.
export const GET = route(async request =>
  json(await listNotices(await requireActor(request.headers),
    noticeList.parse({ ...Object.fromEntries(new URL(request.url).searchParams), scope: "admin" }))));
export const POST = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const result = await createNotice(actor, await body(request, noticeCreate), request.headers.get("idempotency-key"), requestId);
  const response = json(result.body, result.status);
  response.headers.set("Location", "/api/v1/admin/notices/" + result.body.id);
  return response;
});
