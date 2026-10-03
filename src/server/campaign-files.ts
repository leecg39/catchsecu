import { z } from "zod";
import type { Campaign } from "@/generated/prisma/client";
import { campaignFileInput, attachmentSnapshot, MAX_CAMPAIGN_FILES, MAX_CAMPAIGN_FILE_BYTES } from "@/contracts/campaign-files";
import { fileInput } from "@/contracts/domains";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { audit } from "./audit";
import { fail } from "./http";
import { idempotent } from "./idempotency";
import { fileInfo } from "./file-access";
import { fileData, finishFileDeletion, reserveQuota } from "./files";
import { requireFileScanner } from "./file-scanner";
import { privateFiles } from "./file-storage";
import { decrypt } from "./crypto";
import { validateFileBytes } from "./file-validation";
import { campaignDraft, locateCampaign, lockCampaign, changeCampaign } from "./campaign-common";
import type { MailAttachment } from "./jobs";

export async function initCampaignFile(ctx: Context, id: string, input: z.infer<typeof campaignFileInput>, key: string | null, requestId: string) {
  await requireFileScanner();
  return idempotent("campaign:file:" + ctx.member.id + ":" + id, key, input, async tx => {
    await reserveQuota(tx, ctx.tenantId, input.size);
    await locateCampaign(tx, ctx, id, "message.manage"); const row = await lockCampaign(tx, id); campaignDraft(row, input.version);
    if (row.channel !== "email") fail(422, "EMAIL_CONTENT_ONLY", "이메일에만 파일을 첨부할 수 있습니다.");
    const existing = await tx.fileObject.aggregate({ where: { campaignId: id, status: { notIn: ["deleting", "deleted"] } }, _count: true, _sum: { size: true } });
    if (existing._count >= MAX_CAMPAIGN_FILES || (existing._sum.size ?? 0) + input.size > MAX_CAMPAIGN_FILE_BYTES) fail(409, "ATTACHMENT_LIMIT", "첨부는 최대 5개, 합계 20MB입니다.");
    const file = await tx.fileObject.create({ data: { ...fileData(input), tenantId: row.tenantId, serviceId: row.serviceId, campaignId: id, ownerKind: "campaign", ownerId: ctx.user.id } });
    await audit(tx, ctx, requestId, "campaign.file_initialized", "campaign", id, [], row.serviceId);
    return { status: 201, body: fileInfo(file), resource: { tenantId: ctx.tenantId, resourceType: "file", resourceId: file.id } };
  }, async tx => { const row = await locateCampaign(tx, ctx, id, "message.manage"); campaignDraft(row, row.version); });
}
export async function changeCampaignFile(ctx: Context, id: string, fileId: string, version: number, remove: boolean, requestId: string) {
  const saved = await db.$transaction(async tx => {
    await locateCampaign(tx, ctx, id, "message.manage"); const row = await lockCampaign(tx, id); campaignDraft(row, version);
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${fileId} FOR UPDATE`;
    const file = await tx.fileObject.findFirst({ where: { id: fileId, campaignId: id, tenantId: ctx.tenantId, serviceId: row.serviceId, ownerKind: "campaign" } });
    if (!file) fail(404, "NOT_FOUND", "캠페인 첨부파일을 찾을 수 없습니다.");
    if (remove) {
      if (["deleted", "deleting"].includes(file.status)) fail(409, "FILE_DELETED", "이미 삭제를 요청한 첨부파일입니다.");
      await tx.fileObject.update({ where: { id: fileId }, data: { status: "deleting", version: { increment: 1 } } });
    } else {
      if (file.ownerId !== ctx.user.id || file.status !== "ready" || file.scanStatus !== "clean" || !file.expiresAt || file.expiresAt <= new Date()) fail(409, "FILE_NOT_READY", "본인이 업로드하고 검사를 마친 파일을 선택해주세요.");
      await tx.fileObject.update({ where: { id: fileId }, data: { status: "attached", expiresAt: null, version: { increment: 1 } } });
    }
    return changeCampaign(tx, row, {}, remove ? "file_removed" : "file_attached", ctx, requestId);
  });
  let cleanupPending = false;
  if (remove) try { await finishFileDeletion(fileId, requestId); } catch { cleanupPending = true; }
  return { id, version: saved.version, cleanupPending };
}
/** Parent campaign is locked by the caller. No network paths are passed to the mailer. */
export async function readCampaignAttachments(tx: Transaction, campaign: Campaign, snapshot = true): Promise<{ snapshot: z.infer<typeof attachmentSnapshot>; attachments: MailAttachment[] }> {
  const files = await tx.fileObject.findMany({ where: { campaignId: campaign.id, status: { notIn: ["deleting", "deleted"] } }, orderBy: { id: "asc" } });
  const current = [];
  for (const file of files) {
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${file.id} FOR SHARE`;
    const live = await tx.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    if (live.status !== "attached" || live.scanStatus !== "clean" || !live.nameCipher || !live.sha256) fail(409, "ATTACHMENT_NOT_READY", "모든 첨부파일의 검사·연결을 마치거나 불필요한 파일을 삭제해주세요.");
    current.push(live);
  }
  if (current.length > MAX_CAMPAIGN_FILES || current.reduce((n, f) => n + f.size, 0) > MAX_CAMPAIGN_FILE_BYTES) fail(409, "ATTACHMENT_LIMIT", "첨부 제한을 초과했습니다.");
  const ids = attachmentSnapshot.parse(current.map(f => ({ id: f.id, sha256: f.sha256!, size: f.size, mime: f.mime })));
  if (snapshot && JSON.stringify(ids) !== JSON.stringify(attachmentSnapshot.parse(campaign.attachmentSnapshot))) fail(409, "ATTACHMENT_CHANGED", "요청한 첨부파일 상태가 변경되었습니다.");
  const attachments: MailAttachment[] = [];
  for (const f of current) {
    const meta = fileInput.parse({ name: decrypt<string>(f.nameCipher!), mime: f.mime, size: f.size, sha256: f.sha256 }), bytes = await privateFiles.read(f.storageKey);
    validateFileBytes(bytes, meta); attachments.push({ filename: meta.name, contentType: meta.mime, content: bytes });
  }
  return { snapshot: ids, attachments };
}
export async function markCampaignFilesForDeletion(tx: Transaction, campaignId: string) {
  const files = await tx.fileObject.findMany({ where: { campaignId, status: { not: "deleted" } }, orderBy: { id: "asc" } });
  for (const file of files) if (file.status !== "deleting") await tx.fileObject.update({ where: { id: file.id }, data: { status: "deleting", version: { increment: 1 } } });
  return files.map(f => f.id);
}
