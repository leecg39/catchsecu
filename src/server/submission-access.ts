import type { Context } from "./context";
import type { Transaction } from "./db";
import type { Capability } from "./permissions";
import { lockFileContext } from "./file-access";
import { fail } from "./http";
import { versionInclude } from "./forms";
import { submissionDataAvailable } from "@/contracts/destruction";

export async function lockSubmission(tx: Transaction, ctx: Context, id: string, capability: Capability, write = false) {
  const first = await tx.submission.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { formVersion: { select: { form: { select: { serviceId: true } } } } } });
  if (!first) fail(404, "NOT_FOUND", "응답을 찾을 수 없습니다.");
  await lockFileContext(tx, ctx, first.formVersion.form.serviceId, [capability], true);
  if (write) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  return tx.submission.findUniqueOrThrow({ where: { id }, include: {
    formVersion: { include: { ...versionInclude, form: { select: { id: true, title: true, serviceId: true } } } }, answers: true,
  } });
}
export function requireSubmissionContent(row: Parameters<typeof submissionDataAvailable>[0]) {
  if (!submissionDataAvailable(row)) fail(410, "SUBMISSION_EXPIRED", "파기 중이거나 보유 기한이 끝난 응답입니다.");
}
