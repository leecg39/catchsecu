import { z } from "zod";
import { shareUpdateInput, shareVersionInput } from "@/contracts/sharing";
import { requireContext } from "@/server/context";
import { body, fail, json, listQuery, rateLimit, route } from "@/server/http";
import { changeShare, getShare, shareEvents, shareOptions } from "@/server/sharing";
function parts(request: Request) {
  const [first, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length || !first) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { first, action };
}
export const GET = route(async request => {
  const { first, action } = parts(request), ctx = await requireContext(request.headers, "share.manage");
  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (first === "options" && !action) return json(await shareOptions(ctx, z.uuid().parse(params.formId)));
  const id = z.uuid().parse(first);
  if (action === "events") { const { page, pageSize } = listQuery.parse(params); return json(await shareEvents(ctx, id, { page, pageSize })); }
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await getShare(ctx, id));
});
export const PATCH = route(async (request, requestId) => {
  const { first, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "share.manage"); await rateLimit("share:manage:" + ctx.member.id, 20);
  return json(await changeShare(ctx, z.uuid().parse(first), await body(request, shareUpdateInput), "update", requestId));
});
export const POST = route(async (request, requestId) => {
  const { first, action } = parts(request); if (action !== "resend") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "share.manage"); await rateLimit("share:manage:" + ctx.member.id, 20);
  return json(await changeShare(ctx, z.uuid().parse(first), await body(request, shareVersionInput), "resend", requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { first, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "share.manage");
  return json(await changeShare(ctx, z.uuid().parse(first), { version: z.coerce.number().int().positive().parse(request.headers.get("if-match")) }, "revoke", requestId));
});
