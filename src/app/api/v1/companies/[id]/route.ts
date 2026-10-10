import { db } from "@/server/db";
import { requireContext } from "@/server/context";
import { audit } from "@/server/audit";
import { body, fail, json, route } from "@/server/http";
import { companyInput, versionSchema } from "@/server/schemas";
import { z } from "zod";
import { companyDto, getCompany, lockCompany, requestCompanyClosure } from "@/server/company-management";
import { assertFileDeadlines } from "@/server/file-access";
export const GET = route(async request => {
  const ctx = await requireContext(request.headers);
  if (new URL(request.url).pathname.split("/").pop() !== ctx.tenantId) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
  return json(await getCompany(ctx));
});
export const PATCH = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "company.manage");
  if (new URL(request.url).pathname.split("/").pop() !== ctx.tenantId) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
  const input = await body(request, companyInput.partial().extend({ version: versionSchema }).strict());
  const { version, ...data } = input;
  const company = await db.$transaction(async tx => {
    const { deadlines } = await lockCompany(tx, ctx, version);
    const updated = await tx.company.updateMany({ where: { id: ctx.tenantId, version }, data: { ...data, version: { increment: 1 } } });
    if (!updated.count) fail(409, "VERSION_CONFLICT", "회사 정보가 변경되었습니다. 새로 불러와주세요.");
    await audit(tx, ctx, requestId, "company.updated", "company", ctx.tenantId, Object.keys(data));
    const result = await tx.company.findUniqueOrThrow({ where: { id: ctx.tenantId }, include: { businessFiles: { where: { status: "active" } } } });
    assertFileDeadlines(deadlines);
    return companyDto(result, true, result.businessFiles[0]);
  });
  return json(company);
});
export const DELETE = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "company.manage");
  if (new URL(request.url).pathname.split("/").pop() !== ctx.tenantId) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
  const input = await body(request, z.object({ version: versionSchema, confirmation: z.string().max(100), reason: z.string().trim().min(1).max(1000) }).strict());
  await requestCompanyClosure(ctx, input, requestId);
  return new Response(null, { status: 204 });
});
