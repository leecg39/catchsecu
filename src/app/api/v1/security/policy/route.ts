import { policyPatch, policyReset } from "@/contracts/security";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { confirmPassword, policyDefaults, readPolicy, updatePolicy } from "@/server/security-policy";
export const GET = route(async request => json(await readPolicy(await requireContext(request.headers, "security.read"))));
export const PATCH = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "security.write");
  if (ctx.member.role !== "owner") fail(403, "FORBIDDEN", "최상위 관리자만 정책을 변경할 수 있습니다.");
  const { tenantId, version, password, ...settings } = await body(request, policyPatch);
  if (tenantId !== ctx.tenantId) fail(409, "COMPANY_CHANGED", "선택한 회사가 변경되었습니다. 정책을 다시 불러와주세요.");
  await confirmPassword(ctx, request.headers, password);
  return json(await updatePolicy(ctx, version, settings, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "security.write");
  if (ctx.member.role !== "owner") fail(403, "FORBIDDEN", "최상위 관리자만 정책을 변경할 수 있습니다.");
  const input = await body(request, policyReset);
  if (input.tenantId !== ctx.tenantId) fail(409, "COMPANY_CHANGED", "선택한 회사가 변경되었습니다. 정책을 다시 불러와주세요.");
  await confirmPassword(ctx, request.headers, input.password);
  return json(await updatePolicy(ctx, input.version, policyDefaults, requestId, true));
});
