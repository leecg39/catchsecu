import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { deleteTemplate, getTemplate, templatePatch, updateTemplate, useTemplate } from "@/server/templates";
function parts(request: Request) {
  const [rawId, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: z.uuid().parse(rawId), action };
}
export const GET = route(async request => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await getTemplate(await requireContext(request.headers, "form.read"), id));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateTemplate(await requireContext(request.headers, "form.write"), id, await body(request, templatePatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await deleteTemplate(await requireContext(request.headers, "form.write"), id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action !== "use") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.write");
  const input = await body(request, z.object({ version: z.number().int().positive(), serviceId: z.uuid(), title: z.string().trim().min(1).max(200).optional() }).strict());
  const result = await idempotent("template:use:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input,
    async tx => ({ status: 201, body: await useTemplate(ctx, id, input, requestId, tx) }));
  return json(result.body, result.status);
});
