import { z } from "zod";
import type { Prisma, DestructionCertificate } from "@/generated/prisma/client";
import { destructionStatuses, type destructionAction, type destructionSchedule, type retentionInput } from "@/contracts/destruction";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { roleCan } from "./permissions";
import { lockSubmission } from "./submission-access";
import { lockFileContext } from "./file-access";
import { audit } from "./audit";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { fail, listQuery } from "./http";

export const activeDestruction = ["pending", "scheduled", "running", "retry", "failed"];
const includeRequest = { submission: { include: { formVersion: { include: { form: true } } } }, certificate: { select: { id: true } } };
export function requestDto(row: Prisma.DestructionRequestGetPayload<{ include: typeof includeRequest }>) {
  return { id: row.id, tenantId: row.tenantId, serviceId: row.serviceId, submissionId: row.submissionId,
    formId: row.submission.formVersion.formId, formTitle: row.submission.formVersion.title,
    source: row.source, status: row.status, dueAt: row.dueAt, version: row.version, createdAt: row.createdAt,
    legalHold: row.submission.legalHold, requesterId: row.requesterId, approverId: row.approverId,
    reason: row.reasonCipher ? decrypt<string>(row.reasonCipher) : null, decision: row.decisionCipher ? decrypt<string>(row.decisionCipher) : null,
    approvedAt: row.approvedAt, startedAt: row.startedAt, completedAt: row.completedAt,
    attempts: row.attempts, nextAttemptAt: row.nextAttemptAt, lastError: row.lastError, certificateId: row.certificate?.id ?? null };
}
export function certificateDigest(row: Pick<DestructionCertificate, "id" | "tenantId" | "serviceId" | "submissionId" | "requestId" | "scope" | "method" | "counts" | "version" | "completedAt">) {
  const counts = row.counts as Record<string, number>;
  return tokenHash(JSON.stringify([row.id, row.tenantId, row.serviceId, row.submissionId, row.requestId, row.scope, row.method,
    Object.keys(counts).sort().map(key => [key, counts[key]]), row.version, row.completedAt.toISOString()]));
}
export function certificateDto(row: DestructionCertificate) { return { ...row, integrityVerified: certificateDigest(row) === row.digest }; }
export const destructionQuery = listQuery.extend({
  serviceId: z.uuid().optional(), submissionId: z.uuid().optional(), status: z.enum(destructionStatuses).optional(),
});
export async function listDestructions(ctx: Context, query: z.infer<typeof destructionQuery>, certificates = false) {
  return db.$transaction(async tx => {
    // Membership and grant mutations take the company lock before writing.
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR SHARE`;
    const company = await tx.company.findUnique({ where: { id: ctx.tenantId } });
    if (!company || company.status !== "active") fail(403, "COMPANY_UNAVAILABLE", "사용할 수 없는 회사입니다.");
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, userId: ctx.user.id,
      status: "active", user: { status: "active" } }, include: { grants: true } });
    const capability = certificates ? "audit.read" : "submission.destroy";
    if (!member || !roleCan(member.role, capability)) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
    const service = { tenantId: ctx.tenantId, ...(["owner", "admin"].includes(member.role) ? {} :
      { id: { in: member.grants.filter(grant => grant.capabilities.includes(capability)).map(grant => grant.serviceId) } }) };
    const where = { tenantId: ctx.tenantId, service, ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.submissionId ? { submissionId: query.submissionId } : {}) };
    if (certificates) {
      const items = await tx.destructionCertificate.findMany({ where, include: { service: { select: { name: true } } },
        orderBy: [{ completedAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
      const total = await tx.destructionCertificate.count({ where });
      return { items: items.map(row => ({ ...certificateDto(row), serviceName: row.service.name, service: undefined })), total, page: query.page, pageSize: query.pageSize };
    }
    const filter = { ...where, ...(query.status ? { status: query.status } : {}) };
    const items = await tx.destructionRequest.findMany({ where: filter, include: includeRequest,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
    const total = await tx.destructionRequest.count({ where: filter });
    return { items: items.map(requestDto), total, page: query.page, pageSize: query.pageSize };
  });
}
export async function createDestruction(tx: Transaction, ctx: Context, row: { id: string; status: string; legalHold: boolean; retentionUntil: Date },
  serviceId: string, reason: string, dueAt = new Date()) {
  if (row.legalHold) fail(409, "LEGAL_HOLD", "보존 조치 중인 응답은 파기 요청을 할 수 없습니다.");
  if (!["submitted", "corrected", "withdrawn"].includes(row.status)) fail(409, "INVALID_TRANSITION", "파기 요청을 할 수 없는 상태입니다.");
  validateSchedule(dueAt, row.retentionUntil);
  return tx.destructionRequest.create({ data: { tenantId: ctx.tenantId, serviceId, submissionId: row.id, source: "manual",
    previousStatus: row.status, requesterId: ctx.user.id, reasonCipher: encrypt(reason), dueAt } });
}
function validateSchedule(dueAt: Date, retentionUntil: Date) {
  const now = Date.now();
  if (dueAt.getTime() < now - 60000 || dueAt.getTime() > Math.max(now, retentionUntil.getTime()) + 1000)
    fail(422, "INVALID_DESTRUCTION_DATE", "현재 시각부터 보유 기한 이내의 파기 일정을 선택해주세요. 기한이 지났으면 즉시 처리를 요청할 수 있습니다.");
}
export async function decideDestruction(ctx: Context, id: string, action: "approve" | "reject" | "cancel" | "retry" | "reschedule",
  input: z.infer<typeof destructionAction> | z.infer<typeof destructionSchedule>, requestId: string) {
  return db.$transaction(async tx => {
    const first = await tx.destructionRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!first) fail(404, "NOT_FOUND", "파기 요청을 찾을 수 없습니다.");
    const submission = await lockSubmission(tx, ctx, first.submissionId, "submission.destroy", true);
    await tx.$queryRaw`SELECT id FROM "DestructionRequest" WHERE id=${id} FOR UPDATE`;
    const row = await tx.destructionRequest.findUniqueOrThrow({ where: { id } });
    if (row.version !== input.version) fail(409, "VERSION_CONFLICT", "파기 요청이 변경되었습니다. 다시 불러와주세요.");
    const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id } });
    if (["approve", "reject"].includes(action) && !["owner", "admin"].includes(member.role))
      fail(403, "DESTRUCTION_APPROVER_REQUIRED", "회사 관리자만 파기를 승인하거나 반려할 수 있습니다.");
    if (action === "retry") {
      if (row.status !== "failed") fail(409, "INVALID_TRANSITION", "실패한 파기만 다시 처리할 수 있습니다.");
      await tx.destructionRequest.update({ where: { id }, data: { status: "retry", maxAttempts: { increment: 5 }, nextAttemptAt: new Date(),
        lastError: null, version: { increment: 1 } } });
    } else {
      if (row.startedAt || !["pending", "scheduled"].includes(row.status))
        fail(409, "DESTRUCTION_STARTED", "실행이 시작되었거나 종료된 파기 요청은 변경할 수 없습니다.");
      if (action === "approve") {
        if (submission.legalHold) fail(409, "LEGAL_HOLD", "보존 조치를 먼저 해제해주세요.");
        if (row.status !== "pending") fail(409, "INVALID_TRANSITION", "승인 대기 중인 요청만 승인할 수 있습니다.");
        await tx.destructionRequest.update({ where: { id }, data: { status: "scheduled", approverId: ctx.user.id, approvedAt: new Date(),
          decisionCipher: encrypt(input.reason), version: { increment: 1 } } });
      } else if (action === "reschedule") {
        const dueAt = new Date((input as z.infer<typeof destructionSchedule>).dueAt);
        validateSchedule(dueAt, submission.retentionUntil);
        await tx.destructionRequest.update({ where: { id }, data: { dueAt, status: "pending", approverId: null, approvedAt: null,
          decisionCipher: null, reasonCipher: encrypt(input.reason), version: { increment: 1 } } });
      } else {
        await tx.destructionRequest.update({ where: { id }, data: { status: action === "cancel" ? "cancelled" : "rejected",
          decisionCipher: encrypt(input.reason), version: { increment: 1 } } });
        await tx.submission.update({ where: { id: submission.id }, data: { status: row.previousStatus, version: { increment: 1 } } });
      }
    }
    await audit(tx, ctx, requestId, "destruction." + action, "destructionRequest", id, ["status"], row.serviceId);
    return requestDto(await tx.destructionRequest.findUniqueOrThrow({ where: { id }, include: includeRequest }));
  }, { timeout: 15000 });
}
export async function changeRetention(ctx: Context, id: string, input: z.infer<typeof retentionInput>, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockSubmission(tx, ctx, id, "submission.destroy", true);
    const policy = await tx.securityPolicy.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
    if (!policy.allowRetentionAdjustment) fail(403, "RETENTION_ADJUSTMENT_DISABLED", "회사의 파기일자 변경 정책이 꺼져 있습니다.");
    if (row.version !== input.version) fail(409, "VERSION_CONFLICT", "응답이 변경되었습니다.");
    if (row.legalHold || !["submitted", "corrected", "withdrawn"].includes(row.status))
      fail(409, "RETENTION_LOCKED", "보존 조치나 파기 요청이 없는 응답의 일정만 변경할 수 있습니다.");
    const date = new Date(input.retentionUntil);
    if (row.retentionUntil <= new Date() || date <= new Date() || date > row.originalRetentionUntil)
      fail(422, "RETENTION_BOUNDARY", "보유 기한이 지나기 전에 동의받은 원래 기한 이내로 변경해주세요.");
    if (+date === +row.retentionUntil) fail(422, "NO_CHANGES", "보유 기한이 변경되지 않았습니다.");
    await tx.submission.update({ where: { id }, data: { retentionUntil: date, retentionVersion: { increment: 1 }, version: { increment: 1 } } });
    const change = await tx.correction.create({ data: { tenantId: ctx.tenantId, submissionId: id, actorId: ctx.user.id, reason: "retention_changed",
      changedFields: ["retentionUntil"], beforeHash: tokenHash(row.retentionUntil.toISOString()) } });
    await tx.correctionPayload.create({ data: { tenantId: ctx.tenantId, correctionId: change.id,
      beforeCipher: encrypt({ answers: { retentionUntil: row.retentionUntil.toISOString() }, reason: input.reason }),
      afterCipher: encrypt({ retentionUntil: date.toISOString() }) } });
    await audit(tx, ctx, requestId, "submission.retention_changed", "submission", id, ["retentionUntil"], row.formVersion.form.serviceId);
    return { id, version: row.version + 1, retentionUntil: date };
  });
}
export async function readCertificate(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => {
    const row = await tx.destructionCertificate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "파기 증명서를 찾을 수 없습니다.");
    await lockFileContext(tx, ctx, row.serviceId, ["audit.read"], true);
    await audit(tx, ctx, requestId, "destruction.certificate_viewed", "destructionCertificate", id, [], row.serviceId);
    return certificateDto(row);
  });
}
