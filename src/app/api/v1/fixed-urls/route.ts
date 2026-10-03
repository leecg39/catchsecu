import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { createFixedUrl, fixedUrlInput, listFixedUrls } from "@/server/fixed-urls";
import { idempotent } from "@/server/idempotency";
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "form.read");
  const query = listQuery.extend({ serviceId: z.uuid().optional(), status: z.enum(["active", "revoked"]).optional() }).parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await listFixedUrls(ctx, query));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.publish");
  const input = await body(request, fixedUrlInput);
  const result = await idempotent("fixed-url:create:" + ctx.member.id, request.headers.get("idempotency-key"), input, async tx => ({
    status: 201, body: await createFixedUrl(ctx, input, requestId, tx),
  }));
  return json(result.body, result.status);
});
