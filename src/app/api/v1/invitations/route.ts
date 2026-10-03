import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, listQuery, rateLimit, route } from "@/server/http";
import { createInvitation, inviteInput, listInvitations } from "@/server/members";
import { idempotent } from "@/server/idempotency";
const query = listQuery.extend({ status: z.enum(["pending", "accepted", "revoked", "expired", "all"]).optional() });
export const GET = route(async request => json(await listInvitations(await requireContext(request.headers, "member.manage"),
  query.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "member.manage"), input = await body(request, inviteInput);
  await rateLimit("invite:" + ctx.member.id, 20);
  const result = await idempotent("invitation:create:" + ctx.member.id, request.headers.get("idempotency-key"), input,
    async tx => ({ status: 201, body: await createInvitation(ctx, input, requestId, tx) }));
  return json(result.body, result.status);
});
