import { randomInt, timingSafeEqual } from "node:crypto";
import { db, type Transaction } from "./db";
import { decrypt, opaqueToken, tokenHash } from "./crypto";
import { fail, HttpError } from "./http";
import { enqueueMail } from "./jobs";
import { lockFileContext, fileInfo } from "./file-access";
import { findShare, grantQuestions, type Grant } from "./sharing";
import { privateFiles } from "./file-storage";
import { validateFileBytes } from "./file-validation";
import type { SharedSubmission, ViewerInfo } from "@/contracts/sharing";
import type { z } from "zod";
import type { challengeInput } from "@/contracts/sharing";

export const VIEWER_COOKIE = "cs_viewer", CHALLENGE_COOKIE = "cs_viewer_challenge";
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
export function viewerCookie(request: Request, name = VIEWER_COOKIE) {
  const found = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(name + "="))?.slice(name.length + 1);
  return found && secretPattern.test(found) ? found : null;
}
export function setViewerCookie(response: Response, name: string, token: string, seconds: number, request: Request) {
  response.headers.append("Set-Cookie", `${name}=${token}; Path=/api/v1/viewer; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(seconds))}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
}
export function viewerAudit(tx: Transaction, row: Grant, requestId: string, action: string, detail: { sessionId?: string; submissionId?: string; fileId?: string } = {}) {
  return tx.auditEvent.create({ data: { tenantId: row.tenantId, serviceId: row.serviceId, requestId, action,
    resource: "shareGrant", resourceId: row.id, detail } });
}
async function activeGrant(tx: Transaction, id: string, write = false) {
  const initial = await findShare(tx, id);
  if (!initial) fail(401, "VIEWER_SESSION_EXPIRED", "다시 이메일 인증을 완료해주세요.");
  await lockFileContext(tx, { tenantId: initial.tenantId, member: { id: initial.createdBy }, user: { id: initial.creator.userId } },
    initial.serviceId, ["share.manage", "submission.read", ...(initial.fields.some(f => f.question.type === "파일 업로드") ? ["file.read" as const] : [])]);
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${initial.formId} FOR SHARE`;
  if (write) await tx.$queryRaw`SELECT id FROM "ShareGrant" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ShareGrant" WHERE id=${id} FOR SHARE`;
  const row = (await findShare(tx, id))!, form = await tx.form.findUniqueOrThrow({ where: { id: row.formId } });
  if (row.revokedAt || row.expiresAt <= new Date() || (form.status === "archived" && form.sourceType !== "import") || !row.fields.length)
    fail(401, "VIEWER_SESSION_EXPIRED", "공유 권한이 만료되었거나 회수되었습니다. 담당자에게 문의해주세요.");
  // Fields may have changed while waiting for the grant lock. Re-evaluate file capability.
  if (row.fields.some(f => f.question.type === "파일 업로드")) await lockFileContext(tx,
    { tenantId: row.tenantId, member: { id: row.createdBy }, user: { id: row.creator.userId } }, row.serviceId, ["file.read"]);
  return row;
}
export async function startViewerChallenge(input: z.infer<typeof challengeInput>, requestId: string) {
  const id = opaqueToken(), client = opaqueToken(), expiresAt = new Date(Date.now() + 600000);
  await db.$transaction(async tx => {
    const found = await tx.shareGrant.findUnique({ where: { codeHash: tokenHash(input.invitationCode) } });
    if (!found || found.formId !== input.formCode || found.emailHash !== tokenHash(input.email)) return;
    let row: Grant;
    try { row = await activeGrant(tx, found.id, true); } catch (error) { if (error instanceof HttpError) return; throw error; }
    if (row.codeHash !== tokenHash(input.invitationCode) || row.emailHash !== tokenHash(input.email)) return;
    await tx.viewerChallenge.updateMany({ where: { grantId: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.job.updateMany({ where: { dedupeKey: { startsWith: "mail:share:" + row.id + ":challenge:" }, status: { in: ["queued", "retry"] } }, data: { status: "cancelled" } });
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    await tx.viewerChallenge.create({ data: { id, tenantId: row.tenantId, grantId: row.id, grantVersion: row.version,
      clientHash: tokenHash(client), codeHash: tokenHash(id + ":" + code), expiresAt } });
    await enqueueMail({ to: decrypt<string>(row.emailCipher), subject: "외부 개인정보 열람 이메일 인증",
      text: "이메일 인증코드: " + code + "\n\n이 코드는 10분간 유효하며 한 번만 사용할 수 있습니다. 요청한 브라우저에서 입력해주세요.\n요청하지 않았다면 이 메일을 무시해주세요." },
      "share:" + row.id + ":challenge:" + id, tx, row.tenantId);
    await viewerAudit(tx, row, requestId, "share.challenge_requested");
  });
  // Identical shape for invalid combinations; neither recipient existence nor codes are exposed.
  return { id, client, expiresAt: expiresAt.toISOString() };
}
export async function verifyViewerChallenge(id: string, code: string, client: string | null, requestId: string) {
  const result = await db.$transaction(async tx => {
    const initial = await tx.viewerChallenge.findUnique({ where: { id } });
    if (!initial || !client || initial.clientHash !== tokenHash(client)) return null;
    let row: Grant;
    try { row = await activeGrant(tx, initial.grantId, true); } catch (error) { if (error instanceof HttpError) return null; throw error; }
    await tx.$queryRaw`SELECT id FROM "ViewerChallenge" WHERE id=${id} FOR UPDATE`;
    const challenge = await tx.viewerChallenge.findUniqueOrThrow({ where: { id } });
    if (challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5 || challenge.grantVersion !== row.version) return null;
    if (!timingSafeEqual(Buffer.from(challenge.codeHash, "hex"), Buffer.from(tokenHash(id + ":" + code), "hex"))) {
      await tx.viewerChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
      return null;
    }
    const now = new Date(), expiresAt = new Date(Math.min(now.getTime() + 1800000, row.expiresAt.getTime())), token = opaqueToken();
    await tx.viewerChallenge.update({ where: { id }, data: { consumedAt: now } });
    const session = await tx.viewerSession.create({ data: { tenantId: row.tenantId, grantId: row.id, grantVersion: row.version, challengeId: id, tokenHash: tokenHash(token), expiresAt } });
    await viewerAudit(tx, row, requestId, "share.authenticated", { sessionId: session.id });
    return { token, expiresAt: expiresAt.toISOString() };
  });
  // Throw outside the transaction so failed-attempt counters persist.
  if (!result) fail(422, "VIEWER_CODE_INVALID", "인증코드가 올바르지 않거나 사용할 수 없습니다. 다시 이메일 인증을 요청해주세요.");
  return result;
}
export async function withViewer<T>(token: string | null, operation: (tx: Transaction, grant: Grant, session: { id: string; expiresAt: Date }) => Promise<T>) {
  if (!token) fail(401, "VIEWER_AUTH_REQUIRED", "외부 열람자 이메일 인증이 필요합니다.");
  return db.$transaction(async tx => {
    const initial = await tx.viewerSession.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!initial) fail(401, "VIEWER_SESSION_EXPIRED", "열람 인증이 만료되었습니다. 다시 인증해주세요.");
    let grant: Grant;
    try { grant = await activeGrant(tx, initial.grantId); } catch (error) {
      if (error instanceof HttpError) fail(401, "VIEWER_SESSION_EXPIRED", "공유 권한을 사용할 수 없습니다. 담당자에게 문의해주세요.");
      throw error;
    }
    await tx.$queryRaw`SELECT id FROM "ViewerSession" WHERE id=${initial.id} FOR SHARE`;
    const session = await tx.viewerSession.findUniqueOrThrow({ where: { id: initial.id } });
    if (session.revokedAt || session.expiresAt <= new Date() || session.grantVersion !== grant.version)
      fail(401, "VIEWER_SESSION_EXPIRED", "공유 권한이 변경되었거나 인증이 만료되었습니다. 다시 인증해주세요.");
    return operation(tx, grant, session);
  }, { timeout: 15000 });
}
export function viewerInfo(grant: Grant, session: { expiresAt: Date }): ViewerInfo {
  return { formTitle: grant.formVersion.title, formNumber: grant.formVersion.number, questions: grantQuestions(grant),
    expiresAt: session.expiresAt.toISOString(), grantExpiresAt: grant.expiresAt.toISOString() };
}
export async function logoutViewer(token: string | null, requestId: string) {
  if (!token) return;
  await db.$transaction(async tx => {
    const session = await tx.viewerSession.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!session) return;
    // Same order as grant edits and viewer reads; logout must also work after expiry.
    await tx.$queryRaw`SELECT id FROM "ShareGrant" WHERE id=${session.grantId} FOR SHARE`;
    const changed = await tx.viewerSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (changed.count) await viewerAudit(tx, (await findShare(tx, session.grantId))!, requestId, "share.logged_out", { sessionId: session.id });
  });
}
async function sharedSubmission(tx: Transaction, grant: Grant, id: string): Promise<SharedSubmission> {
  await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} AND "tenantId"=${grant.tenantId} AND "formVersionId"=${grant.formVersionId} FOR SHARE`;
  const row = await tx.submission.findFirst({ where: { id, tenantId: grant.tenantId, formVersionId: grant.formVersionId },
    include: { answers: { where: { questionId: { in: grant.fields.map(f => f.questionId) } } } } });
  if (!row) fail(404, "NOT_FOUND", "공유된 응답을 찾을 수 없습니다.");
  if (!["submitted", "corrected"].includes(row.status) || row.retentionUntil <= new Date())
    fail(410, "SHARED_RESPONSE_UNAVAILABLE", "더 이상 열람할 수 없는 응답입니다.");
  const values: SharedSubmission["values"] = {}, fileIds: string[] = [];
  for (const field of grant.fields) {
    const answer = row.answers.find(a => a.questionId === field.questionId);
    if (answer) {
      values[field.question.stableKey] = decrypt<string | string[]>(answer.valueCipher);
      if (field.question.type === "파일 업로드" && typeof values[field.question.stableKey] === "string" && values[field.question.stableKey]) fileIds.push(values[field.question.stableKey] as string);
    }
  }
  const files = await tx.fileObject.findMany({ where: { id: { in: fileIds }, tenantId: grant.tenantId, submissionId: id,
    formVersionId: grant.formVersionId, questionId: { in: grant.fields.map(f => f.questionId) }, status: "attached", scanStatus: "clean",
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { question: { select: { stableKey: true } } } });
  const attachments = files.filter(file => file.question && values[file.question.stableKey] === file.id).map(fileInfo);
  for (const field of grant.fields.filter(f => f.question.type === "파일 업로드"))
    if (!attachments.some(file => file.questionId === field.question.stableKey)) values[field.question.stableKey] = "";
  return { id: row.id, submittedAt: row.submittedAt.toISOString(), values, attachments };
}
export async function listSharedSubmissions(token: string | null, page: number, pageSize: number, requestId: string) {
  return withViewer(token, async (tx, grant, session) => {
    const now = new Date(), where = { tenantId: grant.tenantId, formVersionId: grant.formVersionId, status: { in: ["submitted", "corrected"] }, retentionUntil: { gt: now } };
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Submission"
      WHERE "tenantId"=${grant.tenantId} AND "formVersionId"=${grant.formVersionId}
        AND status IN ('submitted','corrected') AND "retentionUntil">${now}
      ORDER BY "submittedAt" DESC, id ASC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize} FOR SHARE`;
    const items: SharedSubmission[] = [];
    for (const row of rows) items.push(await sharedSubmission(tx, grant, row.id));
    await viewerAudit(tx, grant, requestId, "share.responses_viewed", { sessionId: session.id });
    return { items, total: await tx.submission.count({ where }), page, pageSize, viewer: viewerInfo(grant, session) };
  });
}
export async function getSharedSubmission(token: string | null, id: string, requestId: string) {
  return withViewer(token, async (tx, grant, session) => {
    const result = await sharedSubmission(tx, grant, id);
    await viewerAudit(tx, grant, requestId, "share.response_viewed", { sessionId: session.id, submissionId: id });
    return result;
  });
}
export async function sharedFiles(token: string | null, submissionId: string, query: { page: number; pageSize: number }, requestId: string) {
  return withViewer(token, async (tx, grant, session) => {
    const row = await sharedSubmission(tx, grant, submissionId);
    await viewerAudit(tx, grant, requestId, "share.files_viewed", { sessionId: session.id, submissionId });
    return { items: row.attachments.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: row.attachments.length, ...query };
  });
}
export async function sharedFile(token: string | null, submissionId: string, questionId: string, fileId: string, download: boolean, requestId: string) {
  return withViewer(token, async (tx, grant, session) => {
    const row = await sharedSubmission(tx, grant, submissionId);
    if (!row.attachments.some(file => file.id === fileId && file.questionId === questionId)) fail(404, "NOT_FOUND", "공유된 첨부파일을 찾을 수 없습니다.");
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${fileId} FOR SHARE`;
    const file = await tx.fileObject.findUniqueOrThrow({ where: { id: fileId }, include: { question: { select: { stableKey: true } } } });
    if (file.status !== "attached" || file.scanStatus !== "clean" || (file.expiresAt && file.expiresAt <= new Date())) fail(410, "SHARED_FILE_UNAVAILABLE", "더 이상 열람할 수 없는 파일입니다.");
    await viewerAudit(tx, grant, requestId, download ? "share.file_downloaded" : "share.file_viewed", { sessionId: session.id, submissionId, fileId });
    if (!download) return fileInfo(file);
    const bytes = await privateFiles.read(file.storageKey), name = decrypt<string>(file.nameCipher!);
    validateFileBytes(bytes, { ...file, name });
    const encoded = encodeURIComponent(name).replace(/[!'()*]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": file.mime, "Content-Length": String(bytes.length),
      "Content-Disposition": "attachment; filename=\"attachment\"; filename*=UTF-8''" + encoded,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  });
}
