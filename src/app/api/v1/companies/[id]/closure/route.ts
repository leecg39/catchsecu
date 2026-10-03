import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, fail, route } from "@/server/http";
import { versionSchema } from "@/server/schemas";
import { cancelCompanyClosure } from "@/server/company-management";
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "company.manage");
  if (new URL(request.url).pathname.split("/").at(-2) !== ctx.tenantId) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
  const input = await body(request, z.object({ action: z.literal("cancel"), version: versionSchema }).strict());
  await cancelCompanyClosure(ctx, input.version, requestId);
  return new Response(null, { status: 204 });
});
