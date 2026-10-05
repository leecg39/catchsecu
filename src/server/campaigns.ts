import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { CAMPAIGN_MAIL_JOB_TYPE, campaignCreate, campaignPatch, campaignTargets, campaignList, campaignSourceList, deliveryList, MAX_CAMPAIGN_RECIPIENTS, type CampaignPreview, type CampaignContent, type DeliveryRecord } from "@/contracts/campaigns";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { encrypt, decrypt } from "./crypto";
import { audit } from "./audit";
import { fail, requireVersion, HttpError } from "./http";
import { idempotent } from "./idempotency";
import { markCampaignFilesForDeletion, readCampaignAttachments } from "./campaign-files";
import { finishFileDeletion } from "./files";
import { senderDenial } from "./sender-access";
import { env } from "./env";
import { campaignScope, locateCampaign, lockCampaign, campaignDraft, campaignLive, campaignEvent, changeCampaign, campaignDto, normalizedTarget, lockCampaignConsents, recipientBinding, evaluateRecipient, deliveryDto, preferenceInclude, type RecipientContact } from "./campaign-common";
import { normalizeMessageContent } from "./message-content";
const iso = (value: Date) => value.toISOString();
async function senderChoice(tx: Transaction, tenantId: string, serviceId: string, channel: string, id: string | null) {
  if (!id) return;
  if (channel === "kakao") fail(422, "SENDER_NOT_ALLOWED", "알림톡은 발신자 대신 승인된 템플릿을 사용합니다.");
  const sender = await tx.sender.findFirst({ where: { id, tenantId, serviceId, channel, status: { not: "deleted" } } });
  if (!sender) fail(404, "SENDER_NOT_FOUND", "현재 서비스의 발신자를 선택해주세요.");
}
/** 알림톡 캠페인의 템플릿 바인딩. 바인딩 시점의 템플릿 버전을 함께 저장해 이후 수정은 재바인딩을 요구한다. */
async function kakaoTemplateChoice(tx: Transaction, tenantId: string, serviceId: string, channel: string, id: string | null) {
  if (channel !== "kakao") {
    if (id) fail(422, "TEMPLATE_NOT_ALLOWED", "알림톡 템플릿은 알림톡 채널에서만 선택할 수 있습니다.");
    return { kakaoTemplateId: null, kakaoTemplateVersion: null };
  }
  if (!id) return { kakaoTemplateId: null, kakaoTemplateVersion: null };
  const template = await tx.kakaoTemplate.findFirst({ where: { id, tenantId, serviceId, status: { not: "archived" } } });
  if (!template) fail(404, "TEMPLATE_NOT_FOUND", "현재 서비스의 알림톡 템플릿을 선택해주세요.");
  return { kakaoTemplateId: template.id, kakaoTemplateVersion: template.version };
}
export async function createCampaign(ctx: Context, input: z.infer<typeof campaignCreate>, key: string | null, requestId: string) {
  return idempotent("campaign:create:" + ctx.member.id, key, input, async tx => {
    await campaignScope(tx, ctx, input.serviceId, ["message.manage"], true);
    await senderChoice(tx, ctx.tenantId, input.serviceId, input.channel, input.senderId);
    const kakao = await kakaoTemplateChoice(tx, ctx.tenantId, input.serviceId, input.channel, input.kakaoTemplateId);
    const row = await tx.campaign.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, creatorId: ctx.user.id, channel: input.channel, source: input.source,
      title: input.title, contentCipher: encrypt(normalizeMessageContent(input.content, input.channel)), senderId: input.channel === "kakao" ? null : input.senderId, ...kakao, expiresAt: new Date(Date.now() + 30 * 86400000) } });
    await campaignEvent(tx, row, "created", ctx.user.id); await audit(tx, ctx, requestId, "campaign.created", "campaign", row.id, [], row.serviceId);
    return { status: 201, body: { id: row.id, version: row.version } };
  }, tx => campaignScope(tx, ctx, input.serviceId, ["message.manage"], true));
}
export async function listCampaigns(ctx: Context, input: z.infer<typeof campaignList>, requestId: string) {
  if (input.from && input.to && new Date(input.from) > new Date(input.to)) fail(422, "DATE_RANGE", "시작일과 종료일을 확인해주세요.");
  return db.$transaction(async tx => {
    await campaignScope(tx, ctx, input.serviceId, ["message.read"], false);
    const where: Prisma.CampaignWhereInput = { tenantId: ctx.tenantId, serviceId: input.serviceId, channel: input.channel, archivedAt: input.archived === "true" ? { not: null } : null,
      ...(input.status === "all" ? { status: { notIn: ["deleted", "expired"] }, expiresAt: { gt: new Date() } } : input.status === "expired" ? { OR: [{ status: "expired" }, { expiresAt: { lte: new Date() } }] } : { status: input.status }),
      ...(input.search ? { title: { contains: input.search, mode: "insensitive" } } : {}), ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) } } : {}) };
    const rows = await tx.campaign.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.pageSize, skip: (input.page - 1) * input.pageSize });
    const items = []; for (const row of rows) items.push(await campaignDto(tx, row));
    await audit(tx, ctx, requestId, "campaign.list_viewed", "campaign", undefined, [], input.serviceId);
    return { items, total: await tx.campaign.count({ where }), page: input.page, pageSize: input.pageSize };
  });
}
export async function readCampaign(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => { const row = await locateCampaign(tx, ctx, id, "message.read", false);
    await audit(tx, ctx, requestId, "campaign.viewed", "campaign", row.id, [], row.serviceId); return campaignDto(tx, row, true); });
}
export async function updateCampaign(ctx: Context, id: string, input: z.infer<typeof campaignPatch>, requestId: string) {
  return db.$transaction(async tx => {
    await locateCampaign(tx, ctx, id, "message.manage"); const row = await lockCampaign(tx, id); campaignDraft(row, input.version);
    await senderChoice(tx, ctx.tenantId, row.serviceId, row.channel, input.senderId);
    const kakao = await kakaoTemplateChoice(tx, ctx.tenantId, row.serviceId, row.channel, input.kakaoTemplateId);
    const saved = await changeCampaign(tx, row, { title: input.title, senderId: row.channel === "kakao" ? null : input.senderId, ...kakao, mailProtocol: CAMPAIGN_MAIL_JOB_TYPE, messageTemplateId: null, messageTemplateVersion: null, contentCipher: encrypt(normalizeMessageContent(input.content, row.channel)) }, "updated", ctx, requestId);
    return { id, version: saved.version };
  });
}
export async function deleteCampaign(ctx: Context, id: string, version: number, requestId: string) {
  const result = await db.$transaction(async tx => {
    await locateCampaign(tx, ctx, id, "message.manage"); const row = await lockCampaign(tx, id); campaignDraft(row, version);
    const files = await markCampaignFilesForDeletion(tx, id);
    await tx.campaignDelivery.deleteMany({ where: { campaignId: id } });
    const saved = await changeCampaign(tx, row, { status: "deleted", contentCipher: null, title: "" }, "deleted", ctx, requestId);
    return { id, version: saved.version, files };
  });
  const cleanup = await Promise.allSettled(result.files.map(fileId => finishFileDeletion(fileId, requestId)));
  return { id: result.id, version: result.version, cleanupPending: cleanup.some(r => r.status === "rejected") };
}
function parseContacts(input: z.infer<typeof campaignTargets>) {
  if (input.mode === "selection") return [];
  if (input.mode === "direct") return input.contacts;
  let rows: string[][];
  try { rows = parse(input.csv, { bom: true, skip_empty_lines: true, relax_column_count: false, max_record_size: 4096, trim: true }); }
  catch { fail(422, "CSV_INVALID", "CSV 열과 인용부호를 확인해주세요. UTF-8 연락처 한 열을 사용하세요."); }
  if (rows.some(r => r.length !== 1)) fail(422, "CSV_COLUMNS", "이메일 또는 전화번호 한 열만 포함한 CSV가 필요합니다.");
  if (rows.length && ["contact", "email", "phone", "이메일", "전화번호", "연락처"].includes(rows[0][0].toLowerCase())) rows.shift();
  return z.array(z.string().trim().min(1).max(254)).max(MAX_CAMPAIGN_RECIPIENTS).parse(rows.map(r => r[0]));
}
export async function replaceCampaignRecipients(ctx: Context, id: string, input: z.infer<typeof campaignTargets>, requestId: string) {
  const contacts = parseContacts(input);
  return db.$transaction(async tx => {
    const initial = await locateCampaign(tx, ctx, id, "message.manage");
    await campaignScope(tx, ctx, initial.serviceId, ["marketing.read"], true); campaignDraft(initial, input.version);
    if ((initial.source === "form") !== (input.mode === "selection")) fail(422, "SOURCE_MODE", "캠페인의 수신자 입력 방식을 확인해주세요.");
    let values = contacts;
    if (input.mode === "selection") {
      const ids = [...new Set(input.preferenceIds)];
      const rows = await tx.marketingPreference.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId, serviceId: initial.serviceId, channel: initial.channel }, include: preferenceInclude });
      if (rows.length !== ids.length) fail(404, "TARGET_NOT_FOUND", "선택한 대상 중 현재 서비스에 없는 항목이 있습니다.");
      if (rows.some(p => !p.contactCipher || p.status === "erased" || p.sourceSubmission.retentionUntil <= new Date() || !["submitted", "corrected", "withdrawn"].includes(p.sourceSubmission.status))) fail(410, "TARGET_UNAVAILABLE", "보관 기간이 끝난 대상은 선택할 수 없습니다.");
      const byId = new Map(rows.map(p => [p.id, p])); values = ids.map(key => decrypt<RecipientContact>(byId.get(key)!.contactCipher!).contact);
    }
    const normalized = values.map(v => normalizedTarget(initial.channel as "email" | "sms", v));
    const unique = [...new Map(normalized.map(n => [n.hash, n])).values()];
    const consents = await lockCampaignConsents(tx, initial, unique.filter(n => n.valid).map(n => n.hash));
    const row = await lockCampaign(tx, id); campaignDraft(row, input.version);
    await tx.campaignDelivery.deleteMany({ where: { campaignId: id } });
    if (unique.length) await tx.campaignDelivery.createMany({ data: unique.map((value, index) => {
      const consent = consents.get(value.hash), contact = consent?.contactCipher && consent.status !== "erased" && consent.sourceSubmission.retentionUntil > new Date() && ["submitted", "corrected", "withdrawn"].includes(consent.sourceSubmission.status) ? decrypt<RecipientContact>(consent.contactCipher) : { contact: value.contact, name: "" };
      const expired = consent && (!consent.contactCipher || consent.status === "erased" || consent.sourceSubmission.retentionUntil <= new Date() || !["submitted", "corrected", "withdrawn"].includes(consent.sourceSubmission.status));
      return { id: randomUUID(), tenantId: row.tenantId, serviceId: row.serviceId, campaignId: id, position: index + 1, contactHash: value.hash,
        contactCipher: expired ? null : encrypt(contact), erasedAt: expired ? new Date() : null, ...recipientBinding(consent), reason: expired ? "DATA_ERASED" : value.valid ? consent ? null : "CONSENT_REQUIRED" : "INVALID_CONTACT" };
    }) });
    const saved = await changeCampaign(tx, row, {}, "recipients_replaced", ctx, requestId);
    return { id, version: saved.version, total: unique.length, duplicatesRemoved: normalized.length - unique.length };
  }, { timeout: 30000 });
}
export async function listCampaignDeliveries(ctx: Context, id: string, input: z.infer<typeof deliveryList>, requestId: string, exporting = false) {
  return db.$transaction(async tx => {
    const row = await locateCampaign(tx, ctx, id, "message.read", false); await campaignScope(tx, ctx, row.serviceId, ["marketing.read"], false);
    const where = { campaignId: id, ...(input.status !== "all" ? { status: input.status } : {}) }, total = await tx.campaignDelivery.count({ where });
    if (exporting && total > MAX_CAMPAIGN_RECIPIENTS) fail(422, "EXPORT_LIMIT", "다운로드 행 제한을 초과했습니다.");
    const rows = await tx.campaignDelivery.findMany({ where, orderBy: [{ position: "asc" }, { id: "asc" }], take: exporting ? MAX_CAMPAIGN_RECIPIENTS : input.pageSize, skip: exporting ? 0 : (input.page - 1) * input.pageSize });
    const items: DeliveryRecord[] = []; for (const target of rows) items.push(await deliveryDto(tx, target, row));
    await audit(tx, ctx, requestId, exporting ? "campaign.exported" : "campaign.recipients_viewed", "campaign", id, [], row.serviceId);
    return { items, total, page: input.page, pageSize: input.pageSize };
  });
}
export async function listCampaignSources(ctx: Context, input: z.infer<typeof campaignSourceList>, requestId: string) {
  return db.$transaction(async tx => {
    await campaignScope(tx, ctx, input.serviceId, ["message.read", "marketing.read"], false);
    const where: Prisma.MarketingPreferenceWhereInput = { tenantId: ctx.tenantId, serviceId: input.serviceId, channel: input.channel, status: { not: "erased" }, contactCipher: { not: null },
      sourceSubmission: { status: { in: ["submitted", "corrected", "withdrawn"] }, retentionUntil: { gt: new Date() }, formVersion: { ...(input.formId ? { formId: input.formId } : {}), ...(input.search ? { title: { contains: input.search, mode: "insensitive" } } : {}) } } };
    const rows = await tx.marketingPreference.findMany({ where, include: preferenceInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.pageSize, skip: (input.page - 1) * input.pageSize });
    const items = rows.map(p => ({ id: p.id, version: p.version, ...decrypt<RecipientContact>(p.contactCipher!), sourceTitle: p.sourceSubmission.formVersion.title, formId: p.sourceSubmission.formVersion.formId,
      status: p.status, excluded: p.excluded, retentionUntil: iso(p.sourceSubmission.retentionUntil) }));
    await audit(tx, ctx, requestId, "campaign.sources_viewed", "campaign", undefined, [], input.serviceId);
    return { items, total: await tx.marketingPreference.count({ where }), page: input.page, pageSize: input.pageSize };
  });
}
export async function prepareCampaign(tx: Transaction, ctx: Context, id: string, version: number, capability: "message.manage" | "message.send" = "message.manage") {
  const initial = await locateCampaign(tx, ctx, id, capability); await campaignScope(tx, ctx, initial.serviceId, ["marketing.read"], true);
  campaignLive(initial); requireVersion({ version }, initial);
  const recipients = await tx.campaignDelivery.findMany({ where: { campaignId: id }, orderBy: { position: "asc" } });
  const consents = await lockCampaignConsents(tx, initial, recipients.map(r => r.contactHash));
  if (initial.senderId) await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${initial.senderId} FOR SHARE`;
  const sender = initial.senderId ? await tx.sender.findUnique({ where: { id: initial.senderId } }) : null;
  const row = await lockCampaign(tx, id); campaignLive(row); requireVersion({ version }, row);
  const current = await tx.campaignDelivery.findMany({ where: { campaignId: id }, orderBy: { position: "asc" } });
  const evaluations = []; for (const recipient of current) evaluations.push({ row: recipient, ...await evaluateRecipient(tx, recipient, row, consents.get(recipient.contactHash), row.status !== "draft") });
  return { row, sender, evaluations };
}
export async function previewCampaign(ctx: Context, id: string, version: number, requestId: string): Promise<CampaignPreview> {
  return db.$transaction(async tx => {
    const { row, sender, evaluations } = await prepareCampaign(tx, ctx, id, version);
    let attachmentReason: string | null = null;
    try { await readCampaignAttachments(tx, row, row.status !== "draft"); } catch (error) { attachmentReason = error instanceof HttpError ? error.message : "첨부파일을 읽을 수 없습니다. 파일을 다시 확인해주세요."; }
    const kakaoTemplate = row.channel === "kakao" && row.kakaoTemplateId
      ? await tx.kakaoTemplate.findFirst({ where: { id: row.kakaoTemplateId, tenantId: row.tenantId }, include: { channel: true } }) : null;
    const senderReason = row.channel === "kakao"
      ? !kakaoTemplate ? "알림톡 템플릿을 선택해주세요."
        : kakaoTemplate.status !== "approved" || kakaoTemplate.channel.status !== "verified" ? "승인된 알림톡 템플릿과 확인된 채널이 필요합니다."
        : kakaoTemplate.version !== row.kakaoTemplateVersion ? "템플릿이 수정되었습니다. 내용 저장으로 다시 연결해주세요." : null
      : sender ? senderDenial(sender) : "발신자를 선택해주세요.";
    const transportReason = row.channel === "sms" ? "문자 전송·요금 공급자를 연결한 뒤 발송할 수 있습니다."
      : row.channel === "kakao" ? (env.KAKAO_PROVIDER !== "local" ? "알림톡 발송 공급자를 연결한 뒤 발송할 수 있습니다." : null)
      : env.MAIL_TRANSPORT !== "local" && !env.SMTP_HOST ? "SMTP 연결 설정이 필요합니다." : null;
    await audit(tx, ctx, requestId, "campaign.previewed", "campaign", id, [], row.serviceId);
    const sample = evaluations.find(e => !e.reason)?.content ?? null, content = decrypt<CampaignContent>(row.contentCipher!);
    return { campaignId: id, version: row.version, total: evaluations.length, eligible: evaluations.filter(e => !e.reason).length, excluded: evaluations.filter(e => e.reason).length,
      attachmentsReady: !attachmentReason, attachmentReason, senderReady: !senderReason, senderReason, transportReady: !transportReason, transportReason, sample: sample ? { subject: sample.subject, text: sample.text, ...(sample.format === "html" ? { html: sample.html } : {}) } : null,
      estimate: { amount: row.channel === "email" && env.MAIL_TRANSPORT === "local" ? 0 : null, currency: "KRW", reason: row.channel === "email" && env.MAIL_TRANSPORT === "local" ? "로컬 메일함에는 요금이 청구되지 않습니다." : "외부 공급자의 요금 계약 확인이 필요합니다.", bytes: Buffer.byteLength(content.text, "utf8") },
      items: evaluations.map(e => ({ id: e.row.id, reason: e.reason })) };
  }, { timeout: 30000 });
}
