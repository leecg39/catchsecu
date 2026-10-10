import { assertCompanyIp } from "./ip-enforcement";
import { assertCompanyMfa } from "./mfa-enforcement";
import type { FileObject } from "@/generated/prisma/client";
import type { FileInfo } from "@/contracts/files";
import type { Answers } from "@/contracts/questions";
import { isDrawingAnswer } from "@/contracts/drawing-questions";
import { db, type Transaction } from "./db";
import { activeMembershipWhere, type Context } from "./context";
import { passwordState } from "./password-policy";
import { roleCan, type Capability } from "./permissions";
import { decrypt, tokenHash } from "./crypto";
import { fail } from "./http";
import { lockCampaignForFile } from "./campaign-file-access";
import { lockSenderForFile } from "./sender-access";
import { lockPublicPublication } from "./public-publication";
import { assertSsoSession } from "./sso-policy-enforcement";

export type FilePrincipal = { ctx: Context; token?: never } | { token: string; ctx?: never };
type FileDeadlines = { session: Date; expert: Date | null; password: Date | null; mfa?: Date | null };
export function assertFileDeadlines(deadlines: FileDeadlines) {
  const now = new Date();
  if (deadlines.mfa && deadlines.mfa <= now) fail(403, "MFA_REQUIRED", "2단계 인증 임시 예외가 만료되었습니다.");
  if (deadlines.session <= now) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
  if (deadlines.expert && deadlines.expert <= now) fail(403, "EXPERT_SCOPE", "전문가 배정이 만료되었습니다.");
  if (deadlines.password && deadlines.password <= now) fail(403, "PASSWORD_CHANGE_REQUIRED", "회사 정책에 따라 비밀번호를 변경해주세요.");
}
function uploadCapabilities(file: Pick<FileObject, "ownerKind" | "submissionId">): Capability[] {
  return file.ownerKind === "campaign" ? ["message.manage"] : file.ownerKind === "sender" ? ["sender.manage"] :
    file.ownerKind === "import" ? ["import.write"] : file.submissionId ? ["submission.write", "file.read"] : ["file.write"];
}
export function fileInfo(file: FileObject & { question?: { stableKey: string } | null }): FileInfo {
  return { id: file.id, name: file.nameCipher ? decrypt<string>(file.nameCipher) : "삭제된 파일",
    mime: file.mime, size: file.size, status: file.status, scanStatus: file.scanStatus, version: file.version,
    questionId: file.question?.stableKey ?? null, submissionId: file.submissionId, expiresAt: file.expiresAt?.toISOString() ?? null };
}
export function readableAnswerValues(values: Answers, mayReadFiles: boolean): Answers {
  if (mayReadFiles) return values;
  // Match legacy FILE disclosure: only the opaque ID is visible without file.read.
  // This is a read projection, never a stored answer or a valid DRAW correction payload.
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, isDrawingAnswer(value) ? value.s3Key : value]));
}
export async function canReadFiles(tx: Transaction, ctx: Pick<Context, "tenantId"> & { member: { id: string } }, serviceId: string) {
  await tx.$queryRaw`SELECT id FROM "ServiceGrant" WHERE "memberId"=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, status: "active" }, include: { grants: true } });
  return !!member && roleCan(member.role, "file.read") && (["owner", "admin"].includes(member.role) ||
    member.grants.some(grant => grant.serviceId === serviceId && grant.capabilities.includes("file.read")));
}
// Jobs and external grants use their issuer's current authority independently of a login session.
export async function lockFileIssuer(tx: Transaction, ctx: { tenantId: string; member: { id: string }; user: { id: string } }, serviceId: string, required: Capability[], allowArchived = false, allowMfaException = false) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR SHARE`;
  const company = await tx.company.findUnique({ where: { id: ctx.tenantId } });
  if (!company || company.status !== "active") fail(403, "COMPANY_UNAVAILABLE", "사용할 수 없는 회사입니다.");
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "ServiceGrant" WHERE "memberId"=${ctx.member.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR SHARE`;
  await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${ctx.tenantId} FOR SHARE`;
  const user = await tx.user.findFirst({ where: { id: ctx.user.id, status: "active", emailVerified: true } });
  if (!user) fail(401, "ACCOUNT_UNAVAILABLE", "사용할 수 없는 계정입니다.");
  const initial = await tx.membership.findUnique({ where: { id: ctx.member.id } });
  if (initial?.expertAssignmentId) {
    await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${initial.expertAssignmentId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT "assignmentId" FROM "ExpertAssignmentService" WHERE "assignmentId"=${initial.expertAssignmentId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  }
  const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(ctx.user.id, ctx.tenantId), id: ctx.member.id },
    include: { grants: true, tenant: { include: { policy: true } }, expertAssignment: { include: { services: true } } } });
  if (!member || required.some(capability => !roleCan(member.role, capability))) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  const mfa = allowMfaException ? await assertCompanyMfa(ctx.tenantId, member.id, user.twoFactorEnabled, !!member.tenant.policy?.requireMfa, tx) : null;
  if (!allowMfaException && member.tenant.policy?.requireMfa && !user.twoFactorEnabled) fail(403, "MFA_REQUIRED", "2단계 인증 설정이 필요합니다.");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const service = await tx.service.findFirst({ where: { id: serviceId, tenantId: ctx.tenantId } });
  if (!service) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
  if (!allowArchived && service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스의 파일은 사용할 수 없습니다.");
  if (member.accessKind === "expert" && (service.status !== "active" || !member.expertAssignment!.services.some(item => item.serviceId === serviceId)))
    fail(403, "EXPERT_SCOPE", "전문가 배정 범위에 없는 서비스입니다.");
  if (!["owner", "admin"].includes(member.role)) {
    const grant = member.grants.find(item => item.serviceId === serviceId);
    if (!grant || required.some(capability => !grant.capabilities.includes(capability))) fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
  if (member.accessKind === "expert" && member.expertAssignment!.expiresAt <= new Date()) fail(403, "EXPERT_SCOPE", "전문가 배정이 만료되었습니다.");
  return { member, user, mfa };
}
export async function lockFileContext(tx: Transaction, ctx: Context, serviceId: string, required: Capability[], allowArchived = false) {
  const { member, user, mfa } = await lockFileIssuer(tx, ctx, serviceId, required, allowArchived, true);
  await assertCompanyIp(ctx.tenantId, ctx.clientIp, tx);
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${ctx.session.id} AND "userId"=${ctx.user.id} FOR SHARE`;
  const session = await tx.session.findFirst({ where: { id: ctx.session.id, userId: ctx.user.id, expiresAt: { gt: new Date() } } });
  if (!session || (member.tenant.policy && Date.now() - session.updatedAt.getTime() > member.tenant.policy.sessionMinutes * 60000))
    fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
  if (session.activeCompanyId && session.activeCompanyId !== ctx.tenantId) fail(403, "COMPANY_CHANGED", "선택한 회사가 변경되었습니다. 화면을 다시 불러와주세요.");
  await assertSsoSession(tx, ctx.tenantId, ctx.user.id, session.id);
  const password = await passwordState(user, session, member, new Date(), tx);
  if (password.required)
    fail(403, "PASSWORD_CHANGE_REQUIRED", "회사 정책에 따라 비밀번호를 변경해주세요.");
  const deadlines = { session: new Date(Math.min(session.expiresAt.getTime(), member.tenant.policy ? session.updatedAt.getTime() + member.tenant.policy.sessionMinutes * 60000 : Infinity)),
    expert: member.accessKind === "expert" ? member.expertAssignment!.expiresAt : null, password: password.deferredUntil ?? password.deadline, mfa };
  assertFileDeadlines(deadlines);
  return deadlines;
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
  const row = await lockPublicPublication(tx, id, write);
  // 본인인증 강제는 제출 경로(submitForm → consumeVerificationReceipt)에서 영수증 소비로 검사한다.
  // 업로드·열람은 인증 전에도 가능해야 하므로 여기서 차단하지 않는다.
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
      await lockFileContext(tx, principal.ctx, initial.serviceId, uploadCapabilities(initial));
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
    const result = await operation(tx, file);
    let deadlines: FileDeadlines | undefined;
    if (principal.ctx) {
      deadlines = await lockFileContext(tx, principal.ctx, file.serviceId, uploadCapabilities(file));
      if (file.submissionId) await lockFileSubmission(tx, file.tenantId, file.submissionId, true);
    }
    else await lockFilePublication(tx, file.publicationId!);
    if (file.expiresAt <= new Date()) fail(410, "UPLOAD_EXPIRED", "업로드 시간이 만료되었습니다. 파일을 다시 선택해주세요.");
    if (deadlines) assertFileDeadlines(deadlines);
    return result;
  }, { timeout: 15000 });
}
