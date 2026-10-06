import { supportTicketCreate, supportTicketList } from "@/contracts/support-tickets";
import { requireActor, requireContext } from "@/server/context";
import { body, json, rateLimit, route } from "@/server/http";
import { createSupportTicket, listSupportTickets } from "@/server/support-tickets";

// /feedback는 본인 지원 요청 저장소의 별칭이다(관리자 scope·답변 경로 제외).
export const GET = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const ctx = await requireContext(request.headers);
  const input = supportTicketList.parse({ ...Object.fromEntries(new URL(request.url).searchParams), scope: "mine" });
  return json(await listSupportTickets(actor, input, requestId, ctx));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers);
  await rateLimit("feedback:create:" + ctx.user.id, 20, 3600);
  const result = await createSupportTicket(ctx, await body(request, supportTicketCreate),
    request.headers.get("idempotency-key"), requestId);
  const response = json(result.body, result.status);
  response.headers.set("Location", "/api/v1/feedback/" + result.body.id);
  return response;
});
