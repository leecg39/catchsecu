import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Guide, User } from "@/generated/prisma/client";
import type { z } from "zod";
import type { guideCreate, guideList, guidePatch, GuideRecord, GuideListResponse } from "@/contracts/guides";
import { db } from "./db";
import { fail } from "./http";
import { idempotent } from "./idempotency";
import { privateFiles } from "./file-storage";
import { scanFile } from "./file-scanner";
import { sha256, validateFileBytes } from "./file-validation";
import { lockDownloadActor, type DownloadActor } from "./download-actor";
import { assertFileDeadlines } from "./file-access";

type Actor = { user: User };
const admin = (actor: Actor) => { if (!actor.user.platformAdmin) fail(403, "FORBIDDEN", "운영자 권한이 필요합니다."); };
const dto = (row: Guide): GuideRecord => ({
  id: row.id, category: row.category, categoryOrder: row.categoryOrder, title: row.title, sortOrder: row.sortOrder,
  status: row.status, fileName: row.fileName, fileSize: row.fileSize, fileSha256: row.fileSha256,
  publishedAt: row.publishedAt?.toISOString() ?? null, version: row.version,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
export async function listGuides(actor: Actor, input: z.infer<typeof guideList>): Promise<GuideListResponse> {
  if (input.scope === "admin") admin(actor);
  const where = { ...(input.scope === "published" ? { status: "published" } : {}),
    ...(input.search ? { OR: [ { title: { contains: input.search, mode: "insensitive" as const } },
      { category: { contains: input.search, mode: "insensitive" as const } } ] } : {}) };
  const [items, total] = await db.$transaction([
    db.guide.findMany({ where, orderBy: [{ categoryOrder: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    db.guide.count({ where }),
  ]);
  return { items: items.map(dto), total, page: input.page, pageSize: input.pageSize };
}
export async function readGuide(actor: Actor, id: string, preview: boolean) {
  if (preview) admin(actor);
  const row = await db.guide.findUnique({ where: { id } });
  if (!row || (!preview && row.status !== "published")) fail(404, "NOT_FOUND", "가이드를 찾을 수 없습니다.");
  return dto(row);
}
export async function createGuide(actor: Actor, input: z.infer<typeof guideCreate>, key: string | null, requestId: string) {
  admin(actor);
  return idempotent("guide:create:" + actor.user.id, key, input, async tx => {
    const row = await tx.guide.create({ data: input });
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "guide.created", resource: "guide",
      resourceId: row.id, requestId, detail: { changedFields: Object.keys(input) } } });
    return { status: 201, body: dto(row), resource: { resourceType: "guide" as const, resourceId: row.id } };
  });
}
export async function updateGuide(actor: Actor, id: string, input: z.infer<typeof guidePatch>, requestId: string) {
  admin(actor);
  const { version, status, ...fields } = input;
  if (!status && !Object.keys(fields).length) fail(422, "EMPTY_CHANGE", "변경할 항목이 없습니다.");
  return db.$transaction(async tx => {
    const current = await tx.guide.findUnique({ where: { id } });
    if (!current || current.status === "archived") fail(404, "NOT_FOUND", "가이드를 찾을 수 없습니다.");
    if (status === "published" && !current.fileName) fail(409, "FILE_REQUIRED", "PDF를 먼저 등록해주세요.");
    const updated = await tx.guide.updateMany({ where: { id, version, status: { not: "archived" } }, data: {
      ...fields, ...(status ? { status, publishedAt: status === "published" ? current.publishedAt ?? new Date() : null } : {}),
      version: { increment: 1 },
    } });
    if (!updated.count) fail(409, "VERSION_CONFLICT", "가이드가 변경되었습니다. 다시 불러와주세요.");
    const row = await tx.guide.findUniqueOrThrow({ where: { id } });
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "guide.updated", resource: "guide",
      resourceId: id, requestId, detail: { changedFields: [...Object.keys(fields), ...(status ? ["status"] : [])] } } });
    return dto(row);
  });
}
export async function replaceGuideFile(actor: Actor, id: string, version: number, fileName: string,
  bytes: Buffer, declaredHash: string, requestId: string) {
  admin(actor);
  if (bytes.length > 10485760) fail(413, "FILE_TOO_LARGE", "PDF는 10MB 이하로 등록해주세요.");
  fileName = fileName.normalize("NFC").trim();
  if (!fileName || fileName.length > 200 || /[/\\\x00-\x1f\x7f]/.test(fileName))
    fail(422, "FILE_NAME", "파일 이름을 확인해주세요.");
  validateFileBytes(bytes, { name: fileName, size: bytes.length, mime: "application/pdf", sha256: declaredHash });
  const scan = await scanFile(bytes);
  if (!scan.clean) fail(422, "FILE_INFECTED", "안전하지 않은 파일입니다.");
  const current = await db.guide.findUnique({ where: { id } });
  if (!current || current.status === "archived") fail(404, "NOT_FOUND", "가이드를 찾을 수 없습니다.");
  if (current.version !== version) fail(409, "VERSION_CONFLICT", "가이드가 변경되었습니다. 다시 불러와주세요.");
  const storageKey = randomUUID();
  await privateFiles.write(storageKey, bytes);
  let row: Guide;
  try {
    row = await db.$transaction(async tx => {
      const changed = await tx.guide.updateMany({ where: { id, version, status: { not: "archived" } }, data: {
        storageKey, assetKey: null, fileName, fileSize: bytes.length, fileSha256: sha256(bytes), version: { increment: 1 },
      } });
      if (!changed.count) fail(409, "VERSION_CONFLICT", "가이드가 변경되었습니다. 다시 불러와주세요.");
      const result = await tx.guide.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "guide.file_replaced", resource: "guide",
        resourceId: id, requestId, detail: { fileSha256: result.fileSha256, fileSize: result.fileSize } } });
      return result;
    });
  } catch (error) { await privateFiles.remove(storageKey); throw error; }
  if (current.storageKey) await privateFiles.remove(current.storageKey);
  return dto(row);
}
export async function archiveGuide(actor: Actor, id: string, version: number, requestId: string) {
  admin(actor);
  const oldKey = await db.$transaction(async tx => {
    const current = await tx.guide.findUnique({ where: { id } });
    if (!current || current.status === "archived") fail(404, "NOT_FOUND", "가이드를 찾을 수 없습니다.");
    const changed = await tx.guide.updateMany({ where: { id, version, status: { not: "archived" } }, data: {
      status: "archived", publishedAt: null, fileName: null, fileSize: null, fileSha256: null,
      storageKey: null, assetKey: null, version: { increment: 1 },
    } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "가이드가 변경되었습니다. 다시 불러와주세요.");
    await tx.idempotencyRecord.updateMany({ where: { resourceType: "guide", resourceId: id, invalidatedAt: null },
      data: { invalidatedAt: new Date(), responseCipher: null, requestHash: null } });
    await tx.auditEvent.create({ data: { actorId: actor.user.id, action: "guide.archived", resource: "guide",
      resourceId: id, requestId, detail: { changedFields: ["status", "file"] } } });
    return current.storageKey;
  });
  if (oldKey) await privateFiles.remove(oldKey);
}
export async function downloadGuide(actor: DownloadActor, id: string, preview: boolean, requestId: string) {
  return db.$transaction(async tx => {
    const current = await lockDownloadActor(tx, actor, true);
    if (preview) admin(current);
    await tx.$queryRaw`SELECT id FROM "Guide" WHERE id=${id} FOR SHARE`;
    const row = await tx.guide.findUnique({ where: { id } });
    if (!row || (preview ? row.status === "archived" : row.status !== "published") || !row.fileName || !row.fileSha256 || !row.fileSize)
      fail(404, "NOT_FOUND", "가이드 PDF를 찾을 수 없습니다.");
    let bytes: Buffer;
    try {
      if (row.assetKey) {
        if (!/^[0-9]+-[0-9]+$/.test(row.assetKey)) fail(404, "FILE_UNAVAILABLE", "PDF를 찾을 수 없습니다.");
        bytes = await readFile(join(process.cwd(), "assets", "help-pdfs", row.assetKey + ".pdf"));
      } else if (row.storageKey) bytes = await privateFiles.read(row.storageKey);
      else fail(404, "FILE_UNAVAILABLE", "PDF를 찾을 수 없습니다.");
    } catch { fail(404, "FILE_UNAVAILABLE", "PDF를 찾을 수 없습니다."); }
    if (bytes.length !== row.fileSize || sha256(bytes) !== row.fileSha256) fail(503, "FILE_INTEGRITY", "PDF 내용을 확인할 수 없습니다.");
    await tx.auditEvent.create({ data: { actorId: current.user.id, action: "guide.downloaded", resource: "guide",
      resourceId: id, requestId, detail: { fileSha256: row.fileSha256 } } });
    const encoded = encodeURIComponent(row.fileName).replaceAll("'", "%27");
    const response = new Response(new Uint8Array(bytes), { status: 200, headers: {
      "Content-Type": "application/pdf", "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="guide.pdf"; filename*=UTF-8''${encoded}`,
      "X-Content-SHA256": row.fileSha256, "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store",
    } });
    assertFileDeadlines(current.deadlines);
    return response;
  }, { timeout: 15000 });
}
