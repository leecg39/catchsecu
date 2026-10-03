import { Prisma } from "@/generated/prisma/client";
import type { SubmissionFilters } from "@/contracts/submissions";
import type { Context } from "./context";
import type { Transaction } from "./db";
import { lockFormService } from "./form-access";
import { fail } from "./http";

export async function lockResponseForm(tx: Transaction, ctx: Context, id: string) {
  const first = await tx.form.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, serviceId: true } });
  if (!first) fail(404, "NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  await lockFormService(tx, ctx, first.serviceId, "submission.read", false);
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const form = await tx.form.findFirst({ where: { id, tenantId: ctx.tenantId, serviceId: first.serviceId }, select: { id: true, serviceId: true } });
  if (!form) fail(409, "FORM_CHANGED", "캐치폼이 변경되었습니다. 다시 조회해주세요.");
  return form;
}
export function responseWhere(ctx: Pick<Context, "tenantId">, formId: string, input: SubmissionFilters): Prisma.SubmissionWhereInput {
  return { tenantId: ctx.tenantId, formVersion: { formId },
    ...(input.status === "all" ? {} : { status: input.status }),
    ...(input.search ? { id: { contains: input.search, mode: "insensitive" } } : {}),
    ...(input.from || input.to ? { submittedAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lt: new Date(input.to) } : {}) } } : {}) };
}
export async function lockResponseRows(tx: Transaction, tenantId: string, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  for (let offset = 0; offset < sorted.length; offset += 1000) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Submission" WHERE "tenantId"=${tenantId} AND id IN (${Prisma.join(sorted.slice(offset, offset + 1000))}) ORDER BY id FOR SHARE`);
}
