import { z } from "zod";
import { supportTicketCreate, supportTicketId, supportTicketList, supportTicketPatch,
  supportTicketReply, supportTicketVersion } from "@/contracts/support-tickets";
import { requireActor, requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { archiveSupportTicket, changeSupportTicketState, createSupportTicket, listSupportTickets,
  readSupportTicket, replySupportTicket, updateSupportTicket } from "@/server/support-tickets";

const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4).filter(Boolean);
const adminScope = (request: Request) => new URL(request.url).searchParams.get("scope") === "admin";
const versionHeader = (request: Request) => z.coerce.number().int().positive().parse(request.headers.get("if-match"));

export const GET = route(async (request, requestId) => {
  const path = parts(request), url = new URL(request.url);
  const actor = await requireActor(request.headers);
  if (!path.length) {
    const input = supportTicketList.parse(Object.fromEntries(url.searchParams));
    const ctx = input.scope === "mine" ? await requireContext(request.headers) : undefined;
    return json(await listSupportTickets(actor, input, requestId, ctx));
  }
  if (path.length === 1) {
    const admin = adminScope(request), ctx = admin ? undefined : await requireContext(request.headers);
    return json(await readSupportTicket(actor, supportTicketId.parse(path[0]), admin, requestId, ctx));
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});

export const POST = route(async (request, requestId) => {
  const path = parts(request);
  if (!path.length) {
    const ctx = await requireContext(request.headers);
    await rateLimit("support-ticket:create:" + ctx.user.id, 20, 3600);
    const result = await createSupportTicket(ctx, await body(request, supportTicketCreate),
      request.headers.get("idempotency-key"), requestId);
    const response = json(result.body, result.status);
    response.headers.set("Location", `/api/v1/support-tickets/${result.body.id}`);
    return response;
  }
  if (path.length !== 2) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const id = supportTicketId.parse(path[0]), action = path[1], actor = await requireActor(request.headers);
  await rateLimit("support-ticket:change:" + actor.user.id, 120);
  if (action === "reply") return json(await replySupportTicket(actor, id, await body(request, supportTicketReply), requestId));
  if (action === "close" || action === "reopen") {
    const { version } = await body(request, supportTicketVersion);
    const ctx = adminScope(request) ? undefined : await requireContext(request.headers);
    return json(await changeSupportTicketState(actor, id, version, action, requestId, ctx));
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});

export const PATCH = route(async (request, requestId) => {
  const path = parts(request);
  if (path.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers);
  await rateLimit("support-ticket:change:" + ctx.user.id, 120);
  return json(await updateSupportTicket(ctx, supportTicketId.parse(path[0]),
    await body(request, supportTicketPatch), requestId));
});

export const DELETE = route(async (request, requestId) => {
  const path = parts(request);
  if (path.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const actor = await requireActor(request.headers);
  await rateLimit("support-ticket:change:" + actor.user.id, 120);
  const ctx = adminScope(request) ? undefined : await requireContext(request.headers);
  await archiveSupportTicket(actor, supportTicketId.parse(path[0]), versionHeader(request), requestId, ctx);
  return new Response(null, { status: 204 });
});
