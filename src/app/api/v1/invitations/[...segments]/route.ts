import { z } from "zod";
import { requireActor, requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { acceptInvitationRequest, changeInvitation, invitationToken, previewInvitation } from "@/server/members";
function parts(request: Request) {
  const parts = new URL(request.url).pathname.split("/").slice(4);
  if (!parts.length || parts.length > 2) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return parts;
}
export const POST = route(async (request, requestId) => {
  const [first, action] = parts(request);
  if (["accept", "preview"].includes(first) && !action) {
    const actor = await requireActor(request.headers), input = await body(request, invitationToken);
    await rateLimit("invitation:accept:" + actor.user.id, 30);
    if (first === "preview") return json(await previewInvitation(actor, input.token));
    const result = await acceptInvitationRequest(actor, input.token, request.headers.get("idempotency-key"), requestId);
    return json(result.body, result.status);
  }
  if (action !== "resend") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "member.manage");
  await rateLimit("invite:" + ctx.member.id, 20);
  const input = await body(request, z.object({ version: z.number().int().positive() }).strict());
  return json(await changeInvitation(ctx, z.uuid().parse(first), input.version, "resend", requestId));
});
export const DELETE = route(async (request, requestId) => {
  const [id, action] = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "member.manage");
  return json(await changeInvitation(ctx, z.uuid().parse(id), z.coerce.number().int().positive().parse(request.headers.get("if-match")), "revoke", requestId));
});
