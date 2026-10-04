import { randomUUID } from "node:crypto";
import type { NoticeAttachment, User } from "@/generated/prisma/client";
import type { NoticeAttachmentRecord } from "@/contracts/notices";
import { db } from "./db";
import { fail } from "./http";
import { privateFiles } from "./file-storage";
import { scanFile } from "./file-scanner";
import { sha256, validateFileBytes } from "./file-validation";
import { lockDownloadActor, type DownloadActor } from "./download-actor";
import { assertFileDeadlines } from "./file-access";

type Actor = { user: User };
const extensions: Record<string, string> = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "text/plain": "txt", "text/csv": "csv",
};
function admin(actor: Actor) { if (!actor.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다."); }
export function attachmentDto(row: NoticeAttachment): NoticeAttachmentRecord {
  if (!row.fileName || !row.mime || !row.fileSha256) throw new Error("Attachment metadata unavailable");
  return { id: row.id, fileName: row.fileName, mime: row.mime, fileSize: row.fileSize,
    fileSha256: row.fileSha256, createdAt: row.createdAt.toISOString() };
}
function safeName(value: string) {
  const name = value.normalize("NFC").trim();
  if (!name || name.length > 200 || /[/\\\x00-\x1f\x7f]/.test(name)) fail(422, "FILE_NAME", "파일 이름을 확인해주세요.");
  return name;
}
export async function uploadNoticeAttachment(actor: Actor, noticeId: string, attachmentId: string,
  version: number, fileName: string, mime: string, bytes: Buffer, hash: string, requestId: string) {
  admin(actor);
  fileName = safeName(fileName);
  if (!extensions[mime]) fail(415, "FILE_CONTENT_TYPE", "지원하지 않는 첨부 형식입니다.");
  validateFileBytes(bytes, { name: fileName, size: bytes.length, mime, sha256: hash });
  const current = await db.notice.findUnique({ where: { id: noticeId } });
  if (!current || current.status === "archived") fail(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
  const existing = await db.noticeAttachment.findUnique({ where: { id: attachmentId } });
  if (existing) {
    if (existing.noticeId !== noticeId || existing.status !== "active" || existing.fileName !== fileName ||
      existing.mime !== mime || existing.fileSize !== bytes.length || existing.fileSha256 !== hash)
      fail(409, "ATTACHMENT_CONFLICT", "같은 첨부 ID에 다른 파일이 등록되었습니다.");
    return { attachment: attachmentDto(existing), noticeVersion: current.version };
  }
  const scan = await scanFile(bytes);
  if (!scan.clean) fail(422, "FILE_INFECTED", "안전하지 않은 파일입니다.");
  const storageKey = randomUUID();
  await privateFiles.write(storageKey, bytes);
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Notice" WHERE id=${noticeId} FOR UPDATE`;
      const notice = await tx.notice.findUnique({ where: { id: noticeId } });
      if (!notice || notice.status === "archived") fail(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
      if (notice.version !== version) fail(409, "VERSION_CONFLICT", "공지가 변경되었습니다. 다시 불러와주세요.");
      if (await tx.noticeAttachment.count({ where: { noticeId, status: "active" } }) >= 10)
        fail(409, "ATTACHMENT_LIMIT", "공지는 최대 10개 파일을 첨부할 수 있습니다.");
      const row = await tx.noticeAttachment.create({ data: { id: attachmentId, noticeId, fileName, mime,
        fileSize: bytes.length, fileSha256: hash, storageKey } });
      await tx.notice.update({ where: { id: noticeId }, data: { version: { increment: 1 } } });
      await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "notice.attachment_added", resource: "notice",
        resourceId: noticeId, requestId, detail: { attachmentId, fileSha256: hash, fileSize: bytes.length } } });
      return { attachment: attachmentDto(row), noticeVersion: version + 1 };
    });
  } catch (error) { await privateFiles.remove(storageKey); throw error; }
}
export async function downloadNoticeAttachment(actor: DownloadActor, noticeId: string, attachmentId: string, preview: boolean, requestId: string) {
  return db.$transaction(async tx => {
    const current = await lockDownloadActor(tx, actor);
    if (preview) admin(current);
    await tx.$queryRaw`SELECT id FROM "Notice" WHERE id=${noticeId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "NoticeAttachment" WHERE id=${attachmentId} AND "noticeId"=${noticeId} FOR SHARE`;
    const row = await tx.noticeAttachment.findFirst({ where: { id: attachmentId, noticeId, status: "active" }, include: { notice: true } });
    if (!row || (preview ? row.notice.status === "archived" : row.notice.status !== "published") ||
      !row.storageKey || !row.fileName || !row.fileSha256 || !row.mime)
      fail(404, "NOT_FOUND", "첨부파일을 찾을 수 없습니다.");
    let bytes: Buffer;
    try { bytes = await privateFiles.read(row.storageKey); }
    catch { fail(503, "FILE_UNAVAILABLE", "첨부파일을 읽을 수 없습니다."); }
    if (bytes.length !== row.fileSize || sha256(bytes) !== row.fileSha256)
      fail(503, "FILE_INTEGRITY", "첨부파일 내용을 확인할 수 없습니다.");
    await tx.auditEvent.create({ data: { actorId: current.user.id, action: "notice.attachment_downloaded",
      resource: "notice", resourceId: noticeId, requestId, detail: { attachmentId } } });
    const encoded = encodeURIComponent(row.fileName).replaceAll("'", "%27");
    const response = new Response(new Uint8Array(bytes), { status: 200, headers: {
      "Content-Type": row.mime, "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="attachment.${extensions[row.mime]}"; filename*=UTF-8''${encoded}`,
      "X-Content-SHA256": row.fileSha256, "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store",
    } });
    assertFileDeadlines(current.deadlines);
    return response;
  }, { timeout: 15000 });
}
export async function finishNoticeAttachmentDeletion(id: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "NoticeAttachment" WHERE id=${id} FOR UPDATE`;
    const row = await tx.noticeAttachment.findUnique({ where: { id } });
    if (!row || row.status === "deleted") return;
    if (row.status !== "deleting" || !row.storageKey) fail(409, "FILE_NOT_DELETING", "첨부파일 삭제 요청이 필요합니다.");
    await privateFiles.remove(row.storageKey);
    await tx.noticeAttachment.update({ where: { id }, data: { status: "deleted", fileName: null, mime: null,
      fileSize: 0, fileSha256: null, storageKey: null } });
  });
}
export async function deleteNoticeAttachment(actor: Actor, noticeId: string, attachmentId: string, version: number, requestId: string) {
  admin(actor);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Notice" WHERE id=${noticeId} FOR UPDATE`;
    const notice = await tx.notice.findUnique({ where: { id: noticeId } });
    if (!notice || notice.status === "archived") fail(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
    if (notice.version !== version) fail(409, "VERSION_CONFLICT", "공지가 변경되었습니다. 다시 불러와주세요.");
    const file = await tx.noticeAttachment.findFirst({ where: { id: attachmentId, noticeId, status: "active" } });
    if (!file) fail(404, "NOT_FOUND", "첨부파일을 찾을 수 없습니다.");
    await tx.noticeAttachment.update({ where: { id: attachmentId }, data: { status: "deleting" } });
    await tx.notice.update({ where: { id: noticeId }, data: { version: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "notice.attachment_removed", resource: "notice",
      resourceId: noticeId, requestId, detail: { attachmentId } } });
  });
  try { await finishNoticeAttachmentDeletion(attachmentId); }
  catch { fail(503, "FILE_DELETE_PENDING", "첨부파일 접근을 차단했습니다. 저장소 삭제를 다시 처리하고 있습니다."); }
}
export async function cleanupNoticeAttachments() {
  const rows = await db.noticeAttachment.findMany({ where: { status: "deleting" }, select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 });
  let deleted = 0, retry = 0;
  for (const row of rows) {
    try { await finishNoticeAttachmentDeletion(row.id); deleted++; } catch { retry++; }
  }
  return { deleted, retry };
}
