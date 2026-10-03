import { db } from "@/server/db";
import { requireContext } from "@/server/context";
import { audit } from "@/server/audit";
import { body, fail, json, route } from "@/server/http";
import { companyInput, versionSchema } from "@/server/schemas";
export const GET = route(async request => {
  const ctx = await requireContext(request.headers);
  if (new URL(request.url).pathname.split("/").pop() !== ctx.tenantId) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
  return json(await db.company.findUniqueOrThrow({ where: { id: ctx.tenantId } }));
});
export const PATCH = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "company.manage");
  if (new URL(request.url).pathname.split("/").pop() !== ctx.tenantId) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
  const input = await body(request, companyInput.partial().extend({ version: versionSchema }).strict());
  const { version, ...data } = input;
  const company = await db.$transaction(async tx => {
    const updated = await tx.company.updateMany({ where: { id: ctx.tenantId, version }, data: { ...data, version: { increment: 1 } } });
    if (!updated.count) fail(409, "VERSION_CONFLICT", "회사 정보가 변경되었습니다. 새로 불러와주세요.");
    await audit(tx, ctx, requestId, "company.updated", "company", ctx.tenantId, Object.keys(data));
    return tx.company.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  });
  return json(company);
});
