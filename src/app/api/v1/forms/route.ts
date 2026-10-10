import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createForm, formDto, formListQuery, listForms } from "@/server/forms";
import { formInput } from "@/contracts/domains";
import { idempotent } from "@/server/idempotency";
import { lockFormService, recheckFormAccess } from "@/server/form-access";
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "form.read");
  return json(await listForms(ctx, formListQuery.parse(Object.fromEntries(new URL(request.url).searchParams))));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.write"), input = await body(request, formInput);
  const result = await idempotent("form:create:" + ctx.member.id, request.headers.get("idempotency-key"), input, async tx => {
    const form = await createForm(ctx, input, requestId, tx);
    return { status: 201, body: formDto(form, ctx), resource: { tenantId: ctx.tenantId, resourceType: "form", resourceId: form.id } };
  }, tx => lockFormService(tx, ctx, input.serviceId, "form.write"), undefined, tx => recheckFormAccess(tx, ctx, "form.write"));
  return json(result.body, result.status);
});
