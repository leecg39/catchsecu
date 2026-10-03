import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { createForm, formDto, listForms } from "@/server/forms";
import { formInput } from "@/contracts/domains";
import { idempotent } from "@/server/idempotency";
const query = listQuery.extend({
  status: z.enum(["draft","pendingApproval","published","paused","archived","all"]).optional(), serviceId: z.uuid().optional(),
  favorite: z.enum(["true", "false"]).transform(value => value === "true").optional(),
  start: z.iso.date().optional(), end: z.iso.date().optional(),
}).refine(value => !value.start || !value.end || value.start <= value.end, "시작일은 종료일 이전이어야 합니다.");
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "form.read");
  return json(await listForms(ctx, query.parse(Object.fromEntries(new URL(request.url).searchParams))));
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "form.write"), input = await body(request, formInput);
  const result = await idempotent("form:create:" + ctx.member.id, request.headers.get("idempotency-key"), input, async tx => {
    return { status: 201, body: formDto(await createForm(ctx, input, requestId, tx), ctx) };
  });
  return json(result.body, result.status);
});
