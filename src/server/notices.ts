import sanitizeHtml from "sanitize-html";
import { db } from "./db";
import { fail } from "./http";
import { idempotent } from "./idempotency";
import type { Notice, NoticeAttachment, User } from "@/generated/prisma/client";
import type { NoticeListResponse, NoticeRecord } from "@/contracts/notices";
import type { z } from "zod";
import type { noticeCreate, noticeList, noticePatch } from "@/contracts/notices";
import { attachmentDto, finishNoticeAttachmentDeletion } from "./notice-attachments";

type Actor = { user: User };
const cleanBody = (value: string) => {
  const cleaned = sanitizeHtml(value, { allowedTags: ["p", "br", "strong", "em", "ul", "ol", "li", "a"],
    allowedAttributes: { a: ["href"] }, allowedSchemes: ["http", "https"], disallowedTagsMode: "discard" }).trim();
  if (!cleaned || cleaned.length > 100000) fail(422, "INVALID_NOTICE_BODY", "공지 내용을 확인해주세요.");
  return cleaned;
};
function admin(actor: Actor) { if (!actor.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다."); }
function dto(row: Notice, attachments: NoticeAttachment[] = []): NoticeRecord {
  return { id: row.id, category: row.category, title: row.title, bodyHtml: row.bodyHtml, status: row.status,
    sortOrder: row.sortOrder, authorName: row.authorName, publishedAt: row.publishedAt?.toISOString() ?? null,
    version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    attachments: attachments.filter(item => item.status === "active").map(attachmentDto) };
}
export async function listNotices(actor: Actor, input: z.infer<typeof noticeList>): Promise<NoticeListResponse> {
  if (input.scope === "admin") admin(actor);
  const where = { ...(input.scope === "published" ? { status: "published" } : {}),
    ...(input.search ? { title: { contains: input.search, mode: "insensitive" as const } } : {}) };
  const [items, total] = await db.$transaction([
    db.notice.findMany({ where, orderBy: [{ sortOrder: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    db.notice.count({ where }),
  ]);
  return { items: items.map(row => ({
    id: row.id, category: row.category, title: row.title, status: row.status, sortOrder: row.sortOrder,
    authorName: row.authorName, publishedAt: row.publishedAt?.toISOString() ?? null,
    version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  })), total, page: input.page, pageSize: input.pageSize };
}
export async function readNotice(actor: Actor, id: string, preview: boolean) {
  if (preview) admin(actor);
  const row = await db.notice.findUnique({ where: { id }, include: { attachments: {
    where: { status: "active" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!row || (!preview && row.status !== "published")) fail(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
  return dto(row, row.attachments);
}
export async function createNotice(actor: Actor, input: z.infer<typeof noticeCreate>, key: string | null, requestId: string) {
  admin(actor);
  const sanitized = { ...input, bodyHtml: cleanBody(input.bodyHtml) };
  return idempotent("notice:create:" + actor.user.id, key, sanitized, async tx => {
    const row = await tx.notice.create({ data: { ...sanitized, authorName: actor.user.name,
      publishedAt: sanitized.status === "published" ? new Date() : null } });
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "notice.created", resource: "notice",
      resourceId: row.id, requestId, detail: { changedFields: Object.keys(sanitized) } } });
    return { status: 201, body: dto(row), resource: { resourceType: "notice" as const, resourceId: row.id } };
  });
}
export async function updateNotice(actor: Actor, id: string, input: z.infer<typeof noticePatch>, requestId: string) {
  admin(actor);
  const { version, status, ...fields } = input;
  if (!status && !Object.keys(fields).length) fail(422, "EMPTY_CHANGE", "변경할 항목이 없습니다.");
  const sanitizedFields = { ...fields, ...(fields.bodyHtml === undefined ? {} : { bodyHtml: cleanBody(fields.bodyHtml) }) };
  return db.$transaction(async tx => {
    const current = await tx.notice.findUnique({ where: { id } });
    if (!current || current.status === "archived") fail(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
    const data = { ...sanitizedFields,
      ...(status ? { status, publishedAt: status === "published" ? current.publishedAt ?? new Date() : null } : {}),
      version: { increment: 1 } };
    const result = await tx.notice.updateMany({ where: { id, version, status: { not: "archived" } }, data });
    if (!result.count) fail(409, "VERSION_CONFLICT", "공지 내용이 변경되었습니다. 다시 불러와주세요.");
    const row = await tx.notice.findUniqueOrThrow({ where: { id }, include: { attachments: { where: { status: "active" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "notice.updated", resource: "notice",
      resourceId: id, requestId, detail: { changedFields: [...Object.keys(fields), ...(status ? ["status"] : [])] } } });
    return dto(row, row.attachments);
  });
}
export async function archiveNotice(actor: Actor, id: string, version: number, requestId: string) {
  admin(actor);
  const attachmentIds = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Notice" WHERE id=${id} FOR UPDATE`;
    const current = await tx.notice.findUnique({ where: { id } });
    if (!current || current.status === "archived") fail(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
    const result = await tx.notice.updateMany({ where: { id, version, status: { not: "archived" } },
      data: { status: "archived", publishedAt: null, version: { increment: 1 } } });
    if (!result.count) fail(409, "VERSION_CONFLICT", "공지 내용이 변경되었습니다. 다시 불러와주세요.");
    const attachments = await tx.noticeAttachment.findMany({ where: { noticeId: id, status: "active" }, select: { id: true } });
    await tx.noticeAttachment.updateMany({ where: { noticeId: id, status: "active" }, data: { status: "deleting" } });
    await tx.idempotencyRecord.updateMany({ where: { resourceType: "notice", resourceId: id, invalidatedAt: null },
      data: { invalidatedAt: new Date(), responseCipher: null, requestHash: null } });
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "notice.archived", resource: "notice",
      resourceId: id, requestId, detail: { changedFields: ["status", "attachments"], attachmentCount: attachments.length } } });
    return attachments.map(item => item.id);
  });
  for (const attachmentId of attachmentIds) await finishNoticeAttachmentDeletion(attachmentId).catch(() => {});
}
