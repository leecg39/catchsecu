import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { fixedUrlDto, requireFixedUrl, revokeFixedUrl, updateFixedUrl } from "@/server/fixed-urls";
const idOf = (request: Request) => z.uuid().parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async request => json(fixedUrlDto(await requireFixedUrl(await requireContext(request.headers, "form.read"), idOf(request)))));
export const PATCH = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.publish"), id = idOf(request);
  const input = await body(request, z.object({ version: z.number().int().positive(), name: z.string().trim().min(1).max(200).optional(), formId: z.uuid().optional() }).strict());
  return json(await updateFixedUrl(ctx, id, input, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.publish");
  await revokeFixedUrl(ctx, idOf(request), z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
