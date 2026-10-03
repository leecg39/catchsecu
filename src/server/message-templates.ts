import { createHash } from "node:crypto";
import { z } from "zod";
import type { MessageTemplate, Prisma } from "@/generated/prisma/client";
import { CAMPAIGN_MAIL_JOB_TYPE } from "@/contracts/campaigns";
import { messageTemplateCreate, messageTemplatePatch, messageTemplateList, messageTemplateApply, type MessageTemplateRecord } from "@/contracts/message-templates";
import type { MessageContent } from "@/contracts/message-content";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { encrypt, decrypt } from "./crypto";
import { audit } from "./audit";
import { fail, requireVersion } from "./http";
import { idempotent } from "./idempotency";
import { normalizeMessageContent } from "./message-content";
import { campaignScope, campaignDraft, locateCampaign, lockCampaign, changeCampaign } from "./campaign-common";

function contentFields(content: MessageContent, channel: string) {
  const normalized = normalizeMessageContent(content, channel);
  return { contentCipher: encrypt(normalized), contentHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
}
function dto(row: MessageTemplate, detail = false): MessageTemplateRecord {
  return { id: row.id, serviceId: row.serviceId, channel: row.channel as "email" | "sms", name: row.name, status: row.status as MessageTemplateRecord["status"], version: row.version,
    content: detail && row.contentCipher && row.status !== "deleted" ? decrypt<MessageContent>(row.contentCipher) : null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function snapshot(tx: Transaction, row: MessageTemplate, kind: string, ctx: Context, requestId: string) {
  await tx.messageTemplateRevision.create({ data: { templateId: row.id, tenantId: row.tenantId, serviceId: row.serviceId, version: row.version, name: row.name,
    contentCipher: row.contentCipher, contentHash: row.contentHash, kind, actorId: ctx.user.id } });
  await audit(tx, ctx, requestId, "message_template." + kind, "message_template", row.id, [], row.serviceId);
}
async function locate(tx: Transaction, ctx: Context, id: string, write: boolean, serviceId?: string) {
  const initial = await tx.messageTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!initial || serviceId && initial.serviceId !== serviceId) fail(404, "NOT_FOUND", "메시지 템플릿을 찾을 수 없습니다.");
  await campaignScope(tx, ctx, initial.serviceId, [write ? "message.manage" : "message.read"], write);
  if (write) await tx.$queryRaw`SELECT id FROM "MessageTemplate" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "MessageTemplate" WHERE id=${id} FOR SHARE`;
  return tx.messageTemplate.findUniqueOrThrow({ where: { id } });
}
function active(row: MessageTemplate) {
  if (row.status === "deleted") fail(410, "TEMPLATE_DELETED", "삭제한 템플릿입니다.");
  if (row.status !== "active") fail(409, "TEMPLATE_ARCHIVED", "보관한 템플릿을 먼저 복원해주세요.");
}
export async function createMessageTemplate(ctx: Context, input: z.infer<typeof messageTemplateCreate>, key: string | null, requestId: string) {
  return idempotent("message-template:create:" + ctx.member.id, key, input, async tx => {
    await campaignScope(tx, ctx, input.serviceId, ["message.manage"], true);
    if (await tx.messageTemplate.count({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, status: { not: "deleted" } } }) >= 500) fail(409, "TEMPLATE_LIMIT", "서비스별 템플릿은 최대 500개입니다.");
    const row = await tx.messageTemplate.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, creatorId: ctx.user.id, name: input.name, channel: input.channel, ...contentFields(input.content, input.channel) } });
    await snapshot(tx, row, "created", ctx, requestId); return { status: 201, body: { id: row.id, version: row.version } };
  }, tx => campaignScope(tx, ctx, input.serviceId, ["message.manage"], true));
}
export async function listMessageTemplates(ctx: Context, input: z.infer<typeof messageTemplateList>, requestId: string) {
  return db.$transaction(async tx => {
    await campaignScope(tx, ctx, input.serviceId, ["message.read"], false);
    const where: Prisma.MessageTemplateWhereInput = { tenantId: ctx.tenantId, serviceId: input.serviceId, channel: input.channel, status: input.status, ...(input.search ? { name: { contains: input.search, mode: "insensitive" } } : {}) };
    const rows = await tx.messageTemplate.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.pageSize, skip: (input.page - 1) * input.pageSize });
    await audit(tx, ctx, requestId, "message_template.list_viewed", "message_template", undefined, [], input.serviceId);
    return { items: rows.map(r => dto(r)), total: await tx.messageTemplate.count({ where }), page: input.page, pageSize: input.pageSize };
  });
}
export async function readMessageTemplate(ctx: Context, id: string, requestId: string, version?: number) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, false);
    await audit(tx, ctx, requestId, "message_template.viewed", "message_template", id, [], row.serviceId);
    if (version !== undefined) {
      if (row.status === "deleted") fail(410, "TEMPLATE_DELETED", "삭제한 템플릿의 원문은 보관하지 않습니다.");
      const revision = await tx.messageTemplateRevision.findUnique({ where: { templateId_version: { templateId: id, version } } });
      if (!revision) fail(404, "NOT_FOUND", "템플릿 버전을 찾을 수 없습니다.");
      return { id, version, name: revision.name, kind: revision.kind, content: revision.contentCipher ? decrypt<MessageContent>(revision.contentCipher) : null, contentHash: revision.contentHash, createdAt: revision.createdAt.toISOString() };
    }
    return { ...dto(row, true), revisions: (await tx.messageTemplateRevision.findMany({ where: { templateId: id }, orderBy: { version: "desc" }, take: 100 })).map(r => ({ version: r.version, kind: r.kind, createdAt: r.createdAt.toISOString() })) };
  });
}
export async function updateMessageTemplate(ctx: Context, id: string, input: z.infer<typeof messageTemplatePatch>, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); active(row); requireVersion(input, row);
    const saved = await tx.messageTemplate.update({ where: { id }, data: { name: input.name, ...contentFields(input.content, row.channel), version: { increment: 1 } } });
    await snapshot(tx, saved, "updated", ctx, requestId); return { id, version: saved.version };
  });
}
export async function changeMessageTemplate(ctx: Context, id: string, version: number, action: "archive" | "restore" | "delete", requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); requireVersion({ version }, row);
    if (row.status === "deleted") fail(410, "TEMPLATE_DELETED", "이미 삭제한 템플릿입니다.");
    if (action === "archive") active(row);
    if (action === "restore" && row.status !== "archived") fail(409, "TEMPLATE_NOT_ARCHIVED", "보관된 템플릿만 복원할 수 있습니다.");
    const saved = await tx.messageTemplate.update({ where: { id }, data: { version: { increment: 1 }, status: action === "archive" ? "archived" : action === "restore" ? "active" : "deleted",
      ...(action === "delete" ? { name: "", contentCipher: null, contentHash: null } : {}) } });
    if (action === "delete") await tx.messageTemplateRevision.updateMany({ where: { templateId: id }, data: { name: "", contentCipher: null } });
    await snapshot(tx, saved, action === "archive" ? "archived" : action === "restore" ? "restored" : "deleted", ctx, requestId);
    return { id, version: saved.version };
  });
}
export async function applyMessageTemplate(ctx: Context, id: string, input: z.infer<typeof messageTemplateApply>, requestId: string) {
  return db.$transaction(async tx => {
    const initial = await locateCampaign(tx, ctx, id, "message.manage");
    const template = await locate(tx, ctx, input.templateId, true, initial.serviceId);
    if (template.serviceId !== initial.serviceId || template.channel !== initial.channel) fail(404, "NOT_FOUND", "현재 서비스·채널의 템플릿을 선택해주세요.");
    active(template); requireVersion({ version: input.templateVersion }, template);
    const row = await lockCampaign(tx, id); campaignDraft(row, input.version);
    const saved = await changeCampaign(tx, row, { contentCipher: encrypt(normalizeMessageContent(decrypt<MessageContent>(template.contentCipher!), row.channel)), messageTemplateId: template.id, messageTemplateVersion: template.version, mailProtocol: CAMPAIGN_MAIL_JOB_TYPE }, "template_applied", ctx, requestId);
    return { id, version: saved.version };
  });
}
