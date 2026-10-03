import { z } from "zod";
import { verificationCreate, verificationPatch, verificationQuery } from "@/contracts/verification";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { assertFileDeadlines } from "@/server/file-access";
import { createVerificationIntegration, deleteVerificationIntegration, getVerificationState, lockVerificationContext, replayVerificationIntegration, updateVerificationIntegration } from "@/server/verification";

function service(request: Request) {
  const parts = new URL(request.url).pathname.split("/");
  if (parts.length !== 6 || parts[5] !== "verification") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  verificationQuery(request); return z.uuid().parse(parts[4]);
}
export const GET = route(async request => json(await getVerificationState(await requireContext(request.headers, "form.read"), service(request))));
export const POST = route(async (request, requestId) => {
  const serviceId = service(request), ctx = await requireContext(request.headers, "integration.manage"), input = await body(request, verificationCreate);
  const result = await idempotent("verification:create:" + ctx.member.id + ":" + serviceId, request.headers.get("idempotency-key"), input,
    async tx => {
      const state = await createVerificationIntegration(ctx, serviceId, input, requestId, tx);
      return { status: 201, body: state, resource: { tenantId: ctx.tenantId, resourceType: "verificationIntegration", resourceId: state.integration!.id } };
    }, tx => lockVerificationContext(tx, ctx, serviceId, true),
    (tx, cached) => replayVerificationIntegration(tx, ctx, serviceId, cached),
    async tx => assertFileDeadlines(await lockVerificationContext(tx, ctx, serviceId, true)));
  return json(result.body, result.status);
});
export const PATCH = route(async (request, requestId) => {
  const serviceId = service(request), ctx = await requireContext(request.headers, "integration.manage");
  return json(await updateVerificationIntegration(ctx, serviceId, await body(request, verificationPatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const serviceId = service(request), ctx = await requireContext(request.headers, "integration.manage");
  const raw = request.headers.get("if-match");
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) fail(422, "VALIDATION_ERROR", "현재 설정 버전의 If-Match가 필요합니다.");
  await deleteVerificationIntegration(ctx, serviceId, z.coerce.number().int().min(1).max(2147483646).parse(raw), requestId);
  return new Response(null, { status: 204 });
});
