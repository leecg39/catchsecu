import { Prisma, type Campaign, type CampaignDelivery } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { type CampaignContent, type CampaignRecord, type DeliveryRecord } from "@/contracts/campaigns";
import { normalizeMarketingContact } from "@/contracts/marketing";
import type { Context } from "./context";
import type { Transaction } from "./db";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { fail, requireVersion } from "./http";
import { renderMessageContent } from "./message-content";
import { audit } from "./audit";
import { feedbackSummary } from "./email-feedback";
import { fileInfo, lockFileContext } from "./file-access";
import type { Capability } from "./permissions";
import { lockMarketingContact, marketingContactHash, marketingDenial } from "./marketing";
export const preferenceInclude = { sourceSubmission: { include: { formVersion: { include: { form: { include: { service: true } } } } } } };
export type Consent = Prisma.MarketingPreferenceGetPayload<{ include: typeof preferenceInclude }>;
export type RecipientContact = { contact: string; name: string };
export async function campaignScope(tx: Transaction, ctx: Context, serviceId: string, required: Capability[], write: boolean) {
  await lockFileContext(tx, ctx, serviceId, required, !write);
  if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"campaign:" + ctx.tenantId + ":" + serviceId},0))`;
}
export async function locateCampaign(tx: Transaction, ctx: Context, id: string, capability: Capability, write = true) {
  const row = await tx.campaign.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "캠페인을 찾을 수 없습니다.");
  await campaignScope(tx, ctx, row.serviceId, [capability], write);
  return row;
}
export async function lockCampaign(tx: Transaction, id: string) {
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${id} FOR UPDATE`;
  return tx.campaign.findUniqueOrThrow({ where: { id } });
}
export function campaignLive(row: Campaign) {
  if (["deleted", "expired"].includes(row.status) || row.expiresAt <= new Date() || !row.contentCipher) fail(410, "CAMPAIGN_UNAVAILABLE", "삭제되었거나 보관 기간이 끝난 캠페인입니다.");
}
export function campaignDraft(row: Campaign, version: number) {
  campaignLive(row); requireVersion({ version }, row);
  if (row.status !== "draft" || row.archivedAt) fail(409, "DRAFT_REQUIRED", "초안만 변경할 수 있습니다.");
}
export async function campaignEvent(tx: Transaction, row: Campaign, kind: string, actorId?: string) {
  await tx.campaignEvent.create({ data: { tenantId: row.tenantId, campaignId: row.id, version: row.version, kind, actorId } });
}
export async function changeCampaign(tx: Transaction, row: Campaign, data: Prisma.CampaignUncheckedUpdateInput, kind: string, ctx?: Context, requestId?: string) {
  const saved = await tx.campaign.update({ where: { id: row.id }, data: { ...data, version: { increment: 1 } } });
  await campaignEvent(tx, saved, kind, ctx?.user.id);
  await audit(tx, ctx ?? { tenantId: row.tenantId, user: { id: null } }, requestId ?? randomUUID(), "campaign." + kind, "campaign", row.id, Object.keys(data).filter(k => !/Cipher|Hash/.test(k)), row.serviceId);
  return saved;
}
export async function campaignDto(tx: Transaction, row: Campaign, detail = false): Promise<CampaignRecord> {
  const grouped = await tx.campaignDelivery.groupBy({ by: ["status"], where: { campaignId: row.id }, _count: true });
  const counts = Object.fromEntries(grouped.map(g => [g.status, g._count]));
  const creator = await tx.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: row.tenantId, userId: row.creatorId } }, select: { user: { select: { name: true } } } });
  return { id: row.id, serviceId: row.serviceId, channel: row.channel as "email" | "sms", source: row.source as "direct" | "form", title: row.title, content: detail && row.contentCipher && row.expiresAt > new Date() ? decrypt<CampaignContent>(row.contentCipher) : null,
    files: detail && row.expiresAt > new Date() && row.status !== "deleted" ? (await tx.fileObject.findMany({ where: { campaignId: row.id, status: { not: "deleted" } }, orderBy: { createdAt: "asc" } })).map(fileInfo) : [],
    status: row.expiresAt <= new Date() ? "expired" : row.status, senderId: row.senderId, senderVersion: row.senderVersion, messageTemplateId: row.messageTemplateId, messageTemplateVersion: row.messageTemplateVersion, version: row.version,
    scheduledAt: row.scheduledAt?.toISOString() ?? null, requestedAt: row.requestedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), creator: creator.user.name, total: grouped.reduce((n, g) => n + g._count, 0), counts,
    ...(detail ? { events: (await tx.campaignEvent.findMany({ where: { campaignId: row.id }, orderBy: { version: "desc" }, take: 100 })).map(e => ({ version: e.version, kind: e.kind, createdAt: e.createdAt.toISOString() })) } : {}) };
}
export function normalizedTarget(channel: "email" | "sms", input: string) {
  try { const contact = normalizeMarketingContact(channel, input); return { contact, hash: marketingContactHash(channel, contact), valid: true }; }
  catch { return { contact: input.trim(), hash: tokenHash("campaign-invalid:" + channel + ":" + input.trim()), valid: false }; }
}
/** Keep the established source → contact → sender → campaign → delivery → job order. */
export async function lockCampaignConsents(tx: Transaction, row: Pick<Campaign, "tenantId" | "serviceId" | "channel">, hashes: string[]) {
  const keys = [...new Set(hashes)].sort(), where = { tenantId: row.tenantId, serviceId: row.serviceId, channel: row.channel, contactHash: { in: keys } };
  const initial = await tx.marketingPreference.findMany({ where, select: { contactHash: true, sourceSubmissionId: true } });
  const sources = [...new Set(initial.map(p => p.sourceSubmissionId))].sort();
  for (const id of sources) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} FOR SHARE`;
  for (const hash of keys) await lockMarketingContact(tx, { ...row, contactHash: hash });
  const current = await tx.marketingPreference.findMany({ where, include: preferenceInclude });
  if (current.some(p => !sources.includes(p.sourceSubmissionId))) fail(409, "CONSENT_CHANGED", "대상 근거가 변경되었습니다. 다시 확인해주세요.");
  return new Map(current.map(p => [p.contactHash, p]));
}
export const renderCampaign = renderMessageContent;
export async function evaluateRecipient(tx: Transaction, row: CampaignDelivery, campaign: Campaign, consent?: Consent, snapshot = false) {
  if (row.erasedAt || !row.contactCipher) return { reason: "DATA_ERASED", contact: null, consent: null, content: null };
  const stored = decrypt<RecipientContact>(row.contactCipher), target = normalizedTarget(campaign.channel as "email" | "sms", stored.contact);
  if (!target.valid) return { reason: "INVALID_CONTACT", contact: stored, consent: null, content: null };
  if (!consent?.contactCipher) return { reason: "CONSENT_REQUIRED", contact: stored, consent: null, content: null };
  if (snapshot && (row.preferenceId !== consent.id || row.preferenceVersion !== consent.version || row.sourceSubmissionId !== consent.sourceSubmissionId))
    return { reason: "CONSENT_CHANGED", contact: stored, consent, content: null };
  const contact = snapshot ? stored : decrypt<RecipientContact>(consent.contactCipher);
  const denied = await marketingDenial(tx, consent), content = campaign.contentCipher ? renderCampaign(decrypt<CampaignContent>(campaign.contentCipher), contact) : null;
  return { reason: denied === "이메일 반송·신고·수신거부에 따른 발송 차단" ? "EMAIL_SUPPRESSED" : denied ? (["submitted", "corrected"].includes(consent.sourceSubmission.status) && consent.sourceSubmission.retentionUntil > new Date() ? "WITHDRAWN" : "SOURCE_UNAVAILABLE") : !content ? "VARIABLE_MISSING" : null, contact, consent, content };
}
export function recipientBinding(consent: Consent | null | undefined) {
  return { preferenceId: consent?.id ?? null, sourceSubmissionId: consent?.sourceSubmissionId ?? null, preferenceVersion: consent?.version ?? null };
}
export async function deliveryDto(tx: Transaction, row: CampaignDelivery, campaign: Campaign): Promise<DeliveryRecord> {
  let contact: RecipientContact | null = null;
  if (!row.erasedAt && row.contactCipher && campaign.expiresAt > new Date()) {
    const source = row.sourceSubmissionId ? await tx.submission.findUnique({ where: { id: row.sourceSubmissionId } }) : null;
    const preference = row.preferenceId ? await tx.marketingPreference.findUnique({ where: { id: row.preferenceId } }) : null;
    if ((!row.sourceSubmissionId || source && ["submitted", "corrected", "withdrawn"].includes(source.status) && source.retentionUntil > new Date()) && preference?.status !== "erased") contact = decrypt<RecipientContact>(row.contactCipher);
  }
  return { id: row.id, position: row.position, name: contact?.name ?? null, contact: contact?.contact ?? null, preferenceId: row.preferenceId, sourceSubmissionId: row.sourceSubmissionId,
    status: row.status, reason: row.reason, attempt: row.attempt, acceptedAt: row.acceptedAt?.toISOString() ?? null, erasedAt: row.erasedAt?.toISOString() ?? null, feedback: campaign.channel === "email" ? await feedbackSummary(tx, row.id) : null };
}
export async function settleCampaign(tx: Transaction, row: Campaign) {
  if (["draft", "cancelled", "deleted", "expired"].includes(row.status)) return;
  const rows = await tx.campaignDelivery.groupBy({ by: ["status"], where: { campaignId: row.id }, _count: true });
  const count = (states: string[]) => rows.filter(r => states.includes(r.status)).reduce((n, r) => n + r._count, 0);
  const pending = count(["queued", "sending"]), good = count(["local_delivered", "accepted", "provider_accepted"]), bad = count(["failed", "unknown", "excluded", "cancelled"]);
  const status = pending ? "dispatching" : good ? bad ? "partial_failed" : "completed" : "failed";
  if (row.status !== status) await changeCampaign(tx, row, { status, completedAt: pending ? null : new Date() }, pending ? "dispatching" : "settled");
}
export { encrypt };
