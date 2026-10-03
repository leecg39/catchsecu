import type { FileObject } from "@/generated/prisma/client";
import type { FileInfo } from "@/contracts/files";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { roleCan, type Capability } from "./permissions";
import { decrypt, tokenHash } from "./crypto";
import { fail } from "./http";
import { lockCampaignForFile } from "./campaign-file-access";
import { lockSenderForFile } from "./sender-access";

export type FilePrincipal = { ctx: Context; token?: never } | { token: string; ctx?: never };
export function fileInfo(file: FileObject & { question?: { stableKey: string } | null }): FileInfo {
  return { id: file.id, name: file.nameCipher ? decrypt<string>(file.nameCipher) : "삭제된 파일",
    mime: file.mime, size: file.size, status: file.status, scanStatus: file.scanStatus, version: file.version,
    questionId: file.question?.stableKey ?? null, submissionId: file.submissionId, expiresAt: file.expiresAt?.toISOString() ?? null };
}
export async function canReadFiles(tx: Transaction, ctx: Context, serviceId: string) {
  await tx.$queryRaw`SELECT id FROM "ServiceGrant" WHERE "memberId"=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, status: "active" }, include: { grants: true } });
  return !!member && roleCan(member.role, "file.read") && (["owner", "admin"].includes(member.role) ||
    member.grants.some(grant => grant.serviceId === serviceId && grant.capabilities.includes("file.read")));
}
export async function lockFileContext(tx: Transaction, ctx: { tenantId: string; member: { id: string }; user: { id: string } }, serviceId: string, required: Capability[], allowArchived = false) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR SHARE`;
  const company = await tx.company.findUnique({ where: { id: ctx.tenantId } });
  if (!company || company.status !== "active") fail(403, "COMPANY_UNAVAILABLE", "사용할 수 없는 회사입니다.");
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "ServiceGrant" WHERE "memberId"=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, userId: ctx.user.id, status: "active", user: { status: "active" } }, include: { grants: true } });
  if (!member || required.some(capability => !roleCan(member.role, capability))) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const service = await tx.service.findFirst({ where: { id: serviceId, tenantId: ctx.tenantId } });
  if (!service) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
  if (!allowArchived && service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스의 파일은 사용할 수 없습니다.");
  if (!["owner", "admin"].includes(member.role)) {
    const grant = member.grants.find(item => item.serviceId === serviceId);
    if (!grant || required.some(capability => !grant.capabilities.includes(capability))) fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
}
export async function lockFileSubmission(tx: Transaction, tenantId: string, id: string, write = false) {
  if (write) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} AND "tenantId"=${tenantId} FOR SHARE`;
  const row = await tx.submission.findFirst({ where: { id, tenantId },
    include: { formVersion: { include: { form: true, questions: true } } } });
  if (!row) fail(404, "NOT_FOUND", "응답을 찾을 수 없습니다.");
  if (["destroying", "destroyed"].includes(row.status) || (!row.legalHold && row.retentionUntil <= new Date())) fail(410, "FILE_EXPIRED", "파기 중이거나 보유 기한이 만료된 응답입니다.");
  if (write && !["submitted", "corrected"].includes(row.status)) fail(409, "SUBMISSION_UNAVAILABLE", "첨부파일을 변경할 수 없는 응답 상태입니다.");
  if (write && row.legalHold) fail(409, "LEGAL_HOLD", "보존 조치 중인 응답의 첨부파일은 변경할 수 없습니다.");
  return row;
}
export async function lockFilePublication(tx: Transaction, id: string, write = false) {
  const initial = await tx.publication.findUnique({ where: { id }, include: { form: true } });
  if (!initial) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${initial.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${initial.formId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${initial.form.serviceId} FOR SHARE`;
  if (write) await tx.$queryRaw`SELECT id FROM "Publication" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Publication" WHERE id=${id} FOR SHARE`;
  const row = await tx.publication.findUniqueOrThrow({ where: { id }, include: {
    formVersion: { include: { questions: true } }, form: { include: { service: { include: { tenant: true } } } },
  } });
  if (row.status !== "active" || row.form.status !== "published" || row.form.service.status !== "active" ||
    row.form.service.tenant.status !== "active" || (row.expiresAt && row.expiresAt <= new Date()))
    fail(410, "PUBLICATION_CLOSED", "종료되었거나 만료된 폼입니다.");
  if (row.formVersion.verify) fail(503, "IDENTITY_PROVIDER_REQUIRED", "본인인증 공급자 확인이 필요합니다.");
  if (row.responseCount >= row.maxResponses) fail(409, "RESPONSE_LIMIT_REACHED", "응답 접수가 마감되었습니다.");
  return row;
}
export async function withUpload<T>(principal: FilePrincipal, id: string, operation: (tx: Transaction, file: FileObject & { question: { stableKey: string } | null }) => Promise<T>) {
  return db.$transaction(async tx => {
    const initial = await tx.fileObject.findUnique({ where: { id } });
    if (!initial) fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
    if (principal.ctx) {
      if (initial.tenantId !== principal.ctx.tenantId || initial.ownerId !== principal.ctx.user.id || !["member", "import", "sender", "campaign"].includes(initial.ownerKind))
        fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
      await lockFileContext(tx, principal.ctx, initial.serviceId, initial.ownerKind === "campaign" ? ["message.manage"] : initial.ownerKind === "sender" ? ["sender.manage"] : initial.ownerKind === "import" ? ["import.write"] : initial.submissionId ? ["submission.write", "file.read"] : ["file.write"]);
      if (initial.campaignId) await lockCampaignForFile(tx, initial, true);
      if (initial.senderId) await lockSenderForFile(tx, initial);
      if (initial.submissionId) await lockFileSubmission(tx, initial.tenantId, initial.submissionId, true);
    } else {
      if (!/^[A-Za-z0-9_-]{43}$/.test(principal.token) || initial.ownerKind !== "public" || initial.uploadTokenHash !== tokenHash(principal.token))
        fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
      await lockFilePublication(tx, initial.publicationId!);
    }
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${id} FOR UPDATE`;
    const file = await tx.fileObject.findUniqueOrThrow({ where: { id }, include: { question: { select: { stableKey: true } } } });
    if (!principal.ctx && file.uploadTokenHash !== tokenHash(principal.token)) fail(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
    if (["attached", "deleting", "deleted"].includes(file.status)) fail(409, "UPLOAD_FINISHED", "업로드 권한이 종료되었습니다.");
    if (!file.expiresAt || file.expiresAt <= new Date()) fail(410, "UPLOAD_EXPIRED", "업로드 시간이 만료되었습니다. 파일을 다시 선택해주세요.");
    return operation(tx, file);
  }, { timeout: 15000 });
}
