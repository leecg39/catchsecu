import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createTemplate, listTemplates, templateInput } from "@/server/templates";
const query = listQuery.extend({ scope: z.enum(["all", "company", "public"]).default("all"), serviceId: z.uuid().optional() });
export const GET = route(async request => json(await listTemplates(await requireContext(request.headers, "form.read"), query.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.write"), input = await body(request, templateInput);
  const result = await idempotent("template:create:" + ctx.member.id, request.headers.get("idempotency-key"), input,
    async tx => ({ status: 201, body: await createTemplate(ctx, input, requestId, tx) }));
  return json(result.body, result.status);
});
