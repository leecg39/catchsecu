import { z } from "zod";
import { shareOptionsQuery, shareUpdateInput, shareVersionInput, sharingEmptyQuery, sharingPageQuery } from "@/contracts/sharing";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { changeShare, getShare, shareEvents, shareOptions } from "@/server/sharing";
import { sharingQuery } from "@/server/share-query";
function parts(request: Request) {
  const [first, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length || !first) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { first, action };
}
export const GET = route(async request => {
  const { first, action } = parts(request), ctx = await requireContext(request.headers, "share.manage");
  const url = new URL(request.url);
  if (first === "options" && !action) return json(await shareOptions(ctx, sharingQuery(url, shareOptionsQuery).formId));
  const id = z.uuid().parse(first);
  if (action === "events") return json(await shareEvents(ctx, id, sharingQuery(url, sharingPageQuery)));
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  sharingQuery(url, sharingEmptyQuery);
  return json(await getShare(ctx, id));
});
export const PATCH = route(async (request, requestId) => {
  const { first, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  sharingQuery(new URL(request.url), sharingEmptyQuery);
  const ctx = await requireContext(request.headers, "share.manage"); await rateLimit("share:manage:" + ctx.member.id, 20);
  return json(await changeShare(ctx, z.uuid().parse(first), await body(request, shareUpdateInput), "update", requestId));
});
export const POST = route(async (request, requestId) => {
  const { first, action } = parts(request); if (action !== "resend") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  sharingQuery(new URL(request.url), sharingEmptyQuery);
  const ctx = await requireContext(request.headers, "share.manage"); await rateLimit("share:manage:" + ctx.member.id, 20);
  return json(await changeShare(ctx, z.uuid().parse(first), await body(request, shareVersionInput), "resend", requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { first, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  sharingQuery(new URL(request.url), sharingEmptyQuery);
  const ctx = await requireContext(request.headers, "share.manage");
  return json(await changeShare(ctx, z.uuid().parse(first), { version: z.coerce.number().int().positive().parse(request.headers.get("if-match")) }, "revoke", requestId));
});
