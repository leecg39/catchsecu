import { guideCreate, guideList } from "@/contracts/guides";
import { requireActor } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createGuide, listGuides } from "@/server/guides";

// 운영자 전용 별칭: /guides와 동일 저장소이며 목록은 항상 admin 범위다.
export const GET = route(async request =>
  json(await listGuides(await requireActor(request.headers),
    guideList.parse({ ...Object.fromEntries(new URL(request.url).searchParams), scope: "admin" }))));
export const POST = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const result = await createGuide(actor, await body(request, guideCreate), request.headers.get("idempotency-key"), requestId);
  const response = json(result.body, result.status);
  response.headers.set("Location", "/api/v1/admin/guides/" + result.body.id);
  return response;
});
