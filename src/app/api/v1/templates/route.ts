import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createTemplate, listTemplates, templateInput, templateListQuery } from "@/server/templates";
import { lockFormService, recheckFormAccess } from "@/server/form-access";
export const GET = route(async request => json(await listTemplates(await requireContext(request.headers, "form.read"), templateListQuery.parse(Object.fromEntries(new URL(request.url).searchParams)))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.write"), input = await body(request, templateInput);
  const result = await idempotent("template:create:" + ctx.member.id, request.headers.get("idempotency-key"), input,
    async tx => {
      const template = await createTemplate(ctx, input, requestId, tx);
      return { status: 201, body: template, resource: { tenantId: ctx.tenantId, resourceType: "template", resourceId: template.id } };
    },
    tx => lockFormService(tx, ctx, input.serviceId, "form.write"), undefined, tx => recheckFormAccess(tx, ctx, "form.write"));
  return json(result.body, result.status);
});
