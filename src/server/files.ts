import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FileObject, Prisma } from "@/generated/prisma/client";
import { memberUploadInput, publicUploadInput } from "@/contracts/files";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { env } from "./env";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { fail, HttpError } from "./http";
import { idempotent } from "./idempotency";
import { audit } from "./audit";
import { fileInfo, lockFileContext, lockFilePublication, lockFileSubmission, withUpload, type FilePrincipal } from "./file-access";
import { privateFiles } from "./file-storage";
import { readFileBody, validateFileBytes, validateFileName } from "./file-validation";
import { requireFileScanner, scanFile } from "./file-scanner";

export async function reserveQuota(tx: Transaction, tenantId: string, bytes: number) {
  // All reservations for one tenant are serialized, including public uploads.
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${tenantId} FOR UPDATE`;
  const result = await tx.fileObject.aggregate({ where: { tenantId, status: { not: "deleted" } }, _sum: { size: true } });
  const business = await tx.companyBusinessFile.aggregate({ where: { tenantId, status: { not: "deleted" } }, _sum: { size: true } });
  if ((result._sum.size ?? 0) + (business._sum.size ?? 0) + bytes > env.FILE_TENANT_QUOTA_BYTES) fail(409, "FILE_QUOTA_EXCEEDED", "회사의 파일 저장 한도에 도달했습니다.");
}
async function fileAudit(tx: Transaction, file: FileObject, requestId: string, action: string, ctx?: Context) {
  await tx.auditEvent.create({ data: { tenantId: file.tenantId, actorId: ctx?.user.id, serviceId: file.serviceId,
    resource: "file", resourceId: file.id, requestId, action, detail: { status: file.status, scanStatus: file.scanStatus } } });
}
export function fileData(input: { name: string; mime: string; size: number; sha256: string }) {
  validateFileName(input.name, input.mime);
  return { nameCipher: encrypt(input.name), mime: input.mime, size: input.size, sha256: input.sha256,
    storageKey: randomUUID(), expiresAt: new Date(Date.now() + 3600000) };
}
export async function initPublicUpload(token: string, input: z.infer<typeof publicUploadInput>, key: string | null, requestId: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  const publication = await db.publication.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!publication) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  validateFileName(input.name, input.mime);
  await requireFileScanner();
  return idempotent("upload:public:" + publication.id, key, input, async tx => {
    await reserveQuota(tx, publication.tenantId, input.size);
    const live = await lockFilePublication(tx, publication.id);
    const question = live.formVersion.questions.find(item => item.stableKey === input.questionId && item.type === "파일 업로드");
    if (!question) fail(422, "INVALID_FILE_QUESTION", "첨부파일 질문을 확인해주세요.");
    const uploadToken = opaqueToken();
    const file = await tx.fileObject.create({ data: { ...fileData(input), tenantId: live.tenantId, serviceId: live.form.serviceId,
      ownerKind: "public", publicationId: live.id, formVersionId: live.formVersionId, questionId: question.id,
      uploadTokenHash: tokenHash(uploadToken) }, include: { question: { select: { stableKey: true } } } });
    await fileAudit(tx, file, requestId, "file.upload_initialized");
    return { status: 201, body: { ...fileInfo(file), uploadToken },
      resource: { tenantId: file.tenantId, resourceType: "file", resourceId: file.id } };
  }, tx => lockFilePublication(tx, publication.id));
}
export async function initMemberUpload(ctx: Context, input: z.infer<typeof memberUploadInput>, key: string | null, requestId: string) {
  validateFileName(input.name, input.mime);
  await requireFileScanner();
  return idempotent("upload:member:" + ctx.member.id, key, input, async tx => {
    await reserveQuota(tx, ctx.tenantId, input.size);
    let data: Prisma.FileObjectUncheckedCreateInput;
    if (input.purpose === "service") {
      await lockFileContext(tx, ctx, input.serviceId, ["file.write"]);
      data = { ...fileData(input), tenantId: ctx.tenantId, serviceId: input.serviceId, ownerKind: "member", ownerId: ctx.user.id };
    } else {
      const initial = await tx.submission.findFirst({ where: { id: input.submissionId, tenantId: ctx.tenantId }, include: { formVersion: { include: { form: true } } } });
      if (!initial) fail(404, "NOT_FOUND", "응답을 찾을 수 없습니다.");
      await lockFileContext(tx, ctx, initial.formVersion.form.serviceId, ["submission.write", "file.read"]);
      const submission = await lockFileSubmission(tx, ctx.tenantId, input.submissionId, true);
      const question = submission.formVersion.questions.find(item => item.stableKey === input.questionId && item.type === "파일 업로드");
      if (!question) fail(422, "INVALID_FILE_QUESTION", "첨부파일 질문을 확인해주세요.");
      data = { ...fileData(input), tenantId: ctx.tenantId, serviceId: submission.formVersion.form.serviceId, ownerKind: "member", ownerId: ctx.user.id,
        submissionId: submission.id, publicationId: submission.publicationId, formVersionId: submission.formVersionId, questionId: question.id };
    }
    const file = await tx.fileObject.create({ data, include: { question: { select: { stableKey: true } } } });
    await fileAudit(tx, file, requestId, "file.upload_initialized", ctx);
    return { status: 201, body: fileInfo(file),
      resource: { tenantId: file.tenantId, resourceType: "file", resourceId: file.id } };
  }, async tx => {
    if (input.purpose === "service") return lockFileContext(tx, ctx, input.serviceId, ["file.write"]);
    const row = await tx.submission.findFirst({ where: { id: input.submissionId, tenantId: ctx.tenantId }, include: { formVersion: { include: { form: true } } } });
    if (!row) fail(404, "NOT_FOUND", "응답을 찾을 수 없습니다.");
    await lockFileContext(tx, ctx, row.formVersion.form.serviceId, ["submission.write", "file.read"]);
    await lockFileSubmission(tx, ctx.tenantId, row.id, true);
  });
}
export async function getUpload(principal: FilePrincipal, id: string) {
  return withUpload(principal, id, async (_tx, file) => fileInfo(file));
}
export async function uploadContent(principal: FilePrincipal, id: string, request: Request, requestId: string) {
  const meta = await withUpload(principal, id, async (_tx, file) => file);
  const bytes = await readFileBody(request, meta.size, meta.mime);
  validateFileBytes(bytes, { ...meta, name: decrypt<string>(meta.nameCipher!) });
  return withUpload(principal, id, async (tx, file) => {
    if (["uploaded", "ready"].includes(file.status)) return fileInfo(file);
    if (file.status !== "pending") fail(409, "UPLOAD_FINISHED", "파일을 다시 업로드할 수 없는 상태입니다.");
    await privateFiles.write(file.storageKey, bytes);
    const saved = await tx.fileObject.update({ where: { id }, data: { status: "uploaded", version: { increment: 1 } }, include: { question: { select: { stableKey: true } } } });
    await fileAudit(tx, saved, requestId, "file.uploaded", principal.ctx);
    return fileInfo(saved);
  });
}
export async function completeUpload(principal: FilePrincipal, id: string, requestId: string) {
  const initial = await withUpload(principal, id, async (_tx, file) => {
    if (file.status === "rejected") fail(422, "FILE_UNSAFE", "검사를 통과하지 못한 파일입니다. 다른 파일을 선택해주세요.");
    if (!["uploaded", "ready"].includes(file.status)) fail(409, "FILE_NOT_UPLOADED", "파일 업로드를 먼저 완료해주세요.");
    return { file, bytes: file.status === "ready" ? null : await privateFiles.read(file.storageKey) };
  });
  if (!initial.bytes) return fileInfo(initial.file);
  validateFileBytes(initial.bytes, { ...initial.file, name: decrypt<string>(initial.file.nameCipher!) });
  let scan: Awaited<ReturnType<typeof scanFile>>;
  try { scan = await scanFile(initial.bytes); }
  catch (error) {
    if (error instanceof HttpError) await withUpload(principal, id, async (tx, file) => {
      if (file.status === "uploaded") {
        const row = await tx.fileObject.update({ where: { id }, data: { scanStatus: "error", version: { increment: 1 } } });
        await fileAudit(tx, row, requestId, "file.scan_failed", principal.ctx);
      }
    }).catch(() => {});
    throw error;
  }
  const result = await withUpload(principal, id, async (tx, file) => {
    if (file.status === "ready") return fileInfo(file);
    if (file.status !== "uploaded") fail(409, "UPLOAD_FINISHED", "파일 상태가 변경되었습니다.");
    const saved = await tx.fileObject.update({ where: { id }, data: { status: scan.clean ? "ready" : "rejected", scanStatus: scan.clean ? "clean" : "infected",
      scanEngine: scan.engine, scannedAt: new Date(), version: { increment: 1 } }, include: { question: { select: { stableKey: true } } } });
    if (!scan.clean) await privateFiles.remove(saved.storageKey);
    await fileAudit(tx, saved, requestId, scan.clean ? "file.scan_passed" : "file.scan_rejected", principal.ctx);
    return fileInfo(saved);
  });
  if (result.status === "rejected") fail(422, "FILE_UNSAFE", "악성코드 검사 또는 파일 안전성 검사를 통과하지 못했습니다. 다른 파일을 선택해주세요.");
  return result;
}
export async function finishFileDeletion(id: string, requestId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${id} FOR UPDATE`;
    const file = await tx.fileObject.findUnique({ where: { id } });
    if (!file || file.status === "deleted") return;
    if (file.status !== "deleting") fail(409, "FILE_NOT_DELETING", "삭제 요청이 필요합니다.");
    await privateFiles.remove(file.storageKey);
    const removed = await tx.fileObject.update({ where: { id }, data: { status: "deleted", nameCipher: null, sha256: null, size: 0,
      uploadTokenHash: null, expiresAt: null, version: { increment: 1 } } });
    await tx.idempotencyRecord.updateMany({ where: { tenantId: file.tenantId, resourceType: "file", resourceId: id, invalidatedAt: null },
      data: { invalidatedAt: new Date(), responseCipher: null, requestHash: null } });
    await fileAudit(tx, removed, requestId, "file.deleted");
  });
}
export async function cancelUpload(principal: FilePrincipal, id: string, version: number, requestId: string) {
  await withUpload(principal, id, async (tx, file) => {
    if (file.version !== version) fail(409, "VERSION_CONFLICT", "파일 상태가 변경되었습니다. 다시 불러와주세요.");
    const marked = await tx.fileObject.update({ where: { id }, data: { status: "deleting", uploadTokenHash: null, version: { increment: 1 } } });
    await fileAudit(tx, marked, requestId, "file.deletion_requested", principal.ctx);
  });
  try { await finishFileDeletion(id, requestId); }
  catch { fail(503, "FILE_DELETE_PENDING", "파일 접근을 차단했습니다. 저장소 삭제를 다시 처리하고 있습니다."); }
}
export async function cleanupExpiredFiles(requestId = randomUUID()) {
  const ids = await db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id,status FROM "FileObject" WHERE status='deleting'
        OR (status IN ('pending','uploaded','ready','rejected') AND "expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
      ORDER BY "createdAt" LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const row of rows) if (row.status !== "deleting") {
      const marked = await tx.fileObject.update({ where: { id: row.id }, data: { status: "deleting", uploadTokenHash: null, version: { increment: 1 } } });
      await fileAudit(tx, marked, requestId, "file.upload_expired");
    }
    return rows.map(row => row.id);
  });
  let deleted = 0, retry = 0;
  for (const id of ids) {
    try { await finishFileDeletion(id, requestId); deleted++; } catch { retry++; }
  }
  return { deleted, retry };
}
export async function renameFile(ctx: Context, id: string, input: { name: string; version: number }, requestId: string) {
  return withUpload({ ctx }, id, async (tx, file) => {
    if (file.ownerKind !== "member" || file.submissionId || file.status !== "ready") fail(409, "FILE_NAME_LOCKED", "이 파일의 이름은 변경할 수 없습니다.");
    if (file.version !== input.version) fail(409, "VERSION_CONFLICT", "파일이 변경되었습니다. 다시 불러와주세요.");
    validateFileName(input.name, file.mime);
    const saved = await tx.fileObject.update({ where: { id }, data: { nameCipher: encrypt(input.name), version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "file.renamed", "file", id, ["name"], file.serviceId);
    return fileInfo(saved);
  });
}
