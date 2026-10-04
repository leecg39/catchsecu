import { consentBundle, validateFormDocuments } from "./form-documents";
import { preflightConsentReceipt } from "./consent-receipts";
import { z } from "zod";
import { db, type Transaction } from "./db";
import { type Context } from "./context";
import { formScope, lockFormService } from "./form-access";
import { lockPolicy } from "./security-policy";
import { roleCan } from "./permissions";
import { fail, listQuery } from "./http";
import { audit } from "./audit";
import { encrypt, decrypt } from "./crypto";
import { contentDto, formInclude, fingerprint, lockCurrentForm } from "./forms";
import { validateFormForPublish } from "@/contracts/domains";
import { approvalStatuses, type approvalRequestInput, type approvalDecisionInput } from "@/contracts/security";
import type { Prisma } from "@/generated/prisma/client";

const approvalInclude = { requester: { select: { user: { select: { name: true } } } },
  reviewer: { select: { user: { select: { name: true } } } },
  form: { select: { title: true, serviceId: true, service: { select: { name: true } } } } };
type StoredApproval = Prisma.ApprovalRequestGetPayload<{ include: typeof approvalInclude }>;
export function approvalDto(row: StoredApproval, detail = false) {
  const request = detail ? decrypt<{ message: string; reference: string }>(row.requestCipher) : undefined;
  return { id: row.id, formId: row.formId, title: row.form.title, serviceId: row.form.serviceId, serviceName: row.form.service.name,
    formVersionId: row.formVersionId, formRevision: row.formRevision, policyRevision: row.policyRevision,
    requestedBy: row.requestedBy, requesterName: row.requester.user.name, reviewerName: row.reviewer?.user.name ?? null,
    status: row.status, version: row.version, createdAt: row.createdAt, decidedAt: row.decidedAt,
    ...(detail ? { ...request, reason: row.decisionCipher ? decrypt<string>(row.decisionCipher) : null, snapshot: row.snapshot } : {}) };
}
export async function requestApproval(tx: Transaction, ctx: Context, id: string, input: z.infer<typeof approvalRequestInput>, requestId: string) {
  const { form, policy } = await lockCurrentForm(tx, ctx, id, "form.write");
  if (!policy.requireApproval) fail(409, "APPROVAL_NOT_REQUIRED", "현재 정책에서는 게시 승인이 필요하지 않습니다.");
  if (form.version !== input.version) fail(409, "VERSION_CONFLICT", "폼이 수정되었습니다. 최신 내용을 불러와주세요.");
  if (policy.approvalReferenceRequired && !input.reference) fail(422, "REFERENCE_REQUIRED", "사내 승인번호 등 증빙 번호를 입력해주세요.");
  const draft = form.versions.find(version => version.status === "draft");
  if (!draft) fail(409, "NO_DRAFT", "승인을 요청할 초안이 없습니다.");
  const content = contentDto(draft);
  try { validateFormForPublish(content); } catch (error) { fail(422, "INVALID_FORM", error instanceof Error ? error.message : "폼 내용을 확인해주세요."); }
  await validateFormDocuments(tx, ctx, form.serviceId, draft);
  await preflightConsentReceipt(draft, policy.retentionDays);
  if (await tx.approvalRequest.count({ where: { formId: id, status: { in: ["pending", "approved"] } } })) fail(409, "APPROVAL_EXISTS", "진행 중이거나 승인된 요청이 있습니다.");
  const changed = await tx.form.update({ where: { id }, data: {
    status: form.status === "draft" ? "pendingApproval" : form.status, version: { increment: 1 },
  } });
  const row = await tx.approvalRequest.create({ data: { tenantId: ctx.tenantId, formId: id, formVersionId: draft.id,
    formRevision: changed.version, policyRevision: policy.approvalRevision, contentHash: fingerprint(draft, policy.retentionDays),
    snapshot: { title: draft.title, content, consentBundle: consentBundle(draft) } as Prisma.InputJsonValue, requestedBy: ctx.member.id,
    requestCipher: encrypt({ message: input.message, reference: input.reference }) }, include: approvalInclude });
  await audit(tx, ctx, requestId, "approval.requested", "approval", row.id, ["status"], form.serviceId);
  return approvalDto(row, true);
}
export async function approvalForForm(ctx: Context, formId: string, page: number, pageSize: number) {
  return db.$transaction(async tx => {
  const form=await readableForm(tx,ctx,formId),policy=await lockPolicy(tx,ctx.tenantId);
  const member=await tx.membership.findUniqueOrThrow({ where:{ id:ctx.member.id },include:{ grants:true } });
  const where={ tenantId:ctx.tenantId,formId },total=await tx.approvalRequest.count({ where });
  page=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const items=await tx.approvalRequest.findMany({ where,include:approvalInclude,orderBy:[{ createdAt:"desc" },{ id:"asc" }],take:pageSize,skip:(page-1)*pageSize });
  return { items: items.map(row => ({ ...approvalDto(row, true), canCancel: row.requestedBy === member.id || member.role === "owner" })), total, page, pageSize,
    policy: { requireApproval: policy.requireApproval, referenceRequired: policy.approvalReferenceRequired,
      requestTemplate: policy.approvalRequestTemplate, approvalRevision: policy.approvalRevision },
    canRequest: roleCan(member.role, "form.write") && (["owner", "admin"].includes(member.role)
      || member.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes("form.write"))),
    canReview: policy.approvalRoles.includes(member.role) && roleCan(member.role, "form.approve")
      && (["owner", "admin"].includes(member.role) || member.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes("form.approve"))),
  };
  });
}
async function readableForm(tx: Transaction,ctx: Context,id: string) {
  await formScope(tx,ctx,"form.read");
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const form=await tx.form.findFirst({ where:{ id,tenantId:ctx.tenantId },include:formInclude });
  if (!form) fail(404,"NOT_FOUND","캐치폼을 찾을 수 없습니다.");
  await lockFormService(tx,ctx,form.serviceId,"form.read",false);
  return form;
}
export async function getApproval(ctx: Context, id: string) {
  return db.$transaction(async tx => {
  await formScope(tx,ctx,"form.read");
  const row = await tx.approvalRequest.findFirst({ where: { id, tenantId: ctx.tenantId }, include: approvalInclude });
  if (!row) fail(404, "NOT_FOUND", "승인 요청을 찾을 수 없습니다.");
  await readableForm(tx,ctx,row.formId);
  return approvalDto(await tx.approvalRequest.findUniqueOrThrow({ where:{ id },include:approvalInclude }),true);
  });
}
export const approvalQuery = listQuery.extend({
  formId: z.uuid().optional(), serviceId: z.uuid().optional(), status: z.enum(["all", ...approvalStatuses]).default("all"),
}).strict();
export async function listApprovals(ctx: Context, query: z.infer<typeof approvalQuery>) {
  return db.$transaction(async tx => {
  const scope=await formScope(tx,ctx,"form.read");
  if (query.serviceId) await lockFormService(tx,ctx,query.serviceId,"form.read",false);
  const services = await tx.service.findMany({ where:scope, select: { id: true } });
  const where: Prisma.ApprovalRequestWhereInput = { tenantId: ctx.tenantId, formId: query.formId,
    status: query.status === "all" ? undefined : query.status,
    form: { serviceId: query.serviceId ?? { in: services.map(service => service.id) }, title: { contains: query.search, mode: "insensitive" } } };
  const total=await tx.approvalRequest.count({ where }),page=Math.min(query.page,Math.max(1,Math.ceil(total/query.pageSize)));
  const items=await tx.approvalRequest.findMany({ where, include: approvalInclude, orderBy: [query.sort === "name" ? { form: { title: query.direction } } : { createdAt: query.direction }, { id: "asc" }],
    take: query.pageSize,skip:(page-1)*query.pageSize });
  return { items: items.map(row => approvalDto(row)), total, page, pageSize: query.pageSize };
  });
}
export async function decideApproval(ctx: Context, id: string, input: z.infer<typeof approvalDecisionInput> | { version: number; decision: "cancelled" }, requestId: string) {
  const initial = await db.approvalRequest.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { formId: true } });
  if (!initial) fail(404, "NOT_FOUND", "승인 요청을 찾을 수 없습니다.");
  return db.$transaction(async tx => {
    const cancel = input.decision === "cancelled";
    const { form, policy, member } = await lockCurrentForm(tx, ctx, initial.formId, cancel ? "form.write" : "form.approve");
    if (!cancel && !policy.approvalRoles.includes(member.role)) fail(403, "REVIEWER_FORBIDDEN", "회사 정책에 지정된 승인 담당자만 처리할 수 있습니다.");
    const row = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
    if (cancel && row.requestedBy !== member.id && member.role !== "owner") fail(403, "FORBIDDEN", "요청자 또는 최상위 관리자만 취소할 수 있습니다.");
    if (row.version !== input.version || row.status !== "pending") fail(409, "VERSION_CONFLICT", "이미 처리되거나 수정된 승인 요청입니다.");
    const draft = form.versions.find(version => version.status === "draft");
    if (!policy.requireApproval || policy.approvalRevision !== row.policyRevision || !draft || draft.id !== row.formVersionId || fingerprint(draft, policy.retentionDays) !== row.contentHash)
      fail(409, "STALE_APPROVAL", "폼이나 회사 정책이 변경되었습니다. 승인을 다시 요청해주세요.");
    const saved = await tx.approvalRequest.update({ where: { id }, data: { status: input.decision, version: { increment: 1 },
      decidedBy: member.id, decidedAt: new Date(), decisionCipher: encrypt("reason" in input ? input.reason : "요청 취소") }, include: approvalInclude });
    if (input.decision !== "approved" && form.status === "pendingApproval")
      await tx.form.update({ where: { id: form.id }, data: { status: "draft", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "approval." + input.decision, "approval", id, ["status"], form.serviceId);
    return approvalDto(saved, true);
  }, { timeout: 15000 });
}
