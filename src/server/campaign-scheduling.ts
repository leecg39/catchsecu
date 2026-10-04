import { z } from "zod";
import { CAMPAIGN_MAIL_JOB_TYPE, campaignSchedule, campaignReschedule, campaignRetry } from "@/contracts/campaigns";
import type { Campaign, CampaignDelivery, Sender } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { encrypt } from "./crypto";
import { fail, requireVersion } from "./http";
import { idempotent } from "./idempotency";
import { env } from "./env";
import { senderDenial } from "./sender-access";
import { campaignDraft, campaignLive, locateCampaign, lockCampaign, changeCampaign, recipientBinding } from "./campaign-common";
import { readCampaignAttachments } from "./campaign-files";
import { prepareCampaign } from "./campaigns";

function validateTime(row: Campaign, at: string | null) {
  const date = at ? new Date(at) : new Date();
  if (at && date.getTime() < Date.now() + 10000) fail(422, "SCHEDULE_TIME", "예약 시각은 현재보다 10초 이후로 선택해주세요.");
  if (date >= row.expiresAt) fail(422, "SCHEDULE_EXPIRED", "캠페인 보관 기한 이전으로 예약해주세요.");
  return date;
}
function requireTransport(row: Campaign, sender: Sender | null, at: Date, snapshot = false) {
  if (row.channel === "sms") {
    if (env.SMS_TRANSPORT !== "local") fail(503, "SMS_PROVIDER_REQUIRED", "문자 전송·요금 공급자를 연결한 뒤 발송할 수 있습니다.");
  } else if (env.MAIL_TRANSPORT !== "local" && !env.SMTP_HOST) fail(503, "SMTP_REQUIRED", "SMTP 연결 설정이 필요합니다.");
  if (!sender || senderDenial(sender) || !sender.expiresAt || sender.expiresAt <= at || snapshot && sender.version !== row.senderVersion)
    fail(409, "SENDER_UNAVAILABLE", "발송 시각까지 유효한 최신 인증 발신자가 필요합니다.");
}
async function enqueue(tx: Transaction, campaign: Campaign, rows: CampaignDelivery[], dueAt: Date) {
  await tx.job.createMany({ data: rows.map(row => ({ type: campaign.mailProtocol, tenantId: row.tenantId, senderId: campaign.senderId,
    campaignDeliveryId: row.id, marketingPreferenceId: row.preferenceId, marketingSubmissionId: row.sourceSubmissionId,
    dedupeKey: "campaign:" + row.id + ":" + row.attempt, dueAt,
    payloadCipher: encrypt({ campaignId: campaign.id, deliveryId: row.id, attempt: row.attempt, transport: campaign.channel === "sms" ? "sms-local" : env.MAIL_TRANSPORT }) })) });
}
export async function scheduleCampaign(ctx: Context, id: string, input: z.infer<typeof campaignSchedule>, key: string | null, requestId: string) {
  return idempotent("campaign:schedule:" + ctx.member.id + ":" + id, key, input, async tx => {
    const { row, sender, evaluations } = await prepareCampaign(tx, ctx, id, input.version, "message.send");
    campaignDraft(row, input.version); const attachments = await readCampaignAttachments(tx, row, false); const dueAt = validateTime(row, input.at); requireTransport(row, sender, dueAt);
    const checked = evaluations.map(e => ({ ...e, reason: e.reason ?? (e.consent!.sourceSubmission.retentionUntil <= dueAt ? "SOURCE_UNAVAILABLE" : null) }));
    const eligible = checked.filter(e => !e.reason);
    if (!eligible.length) fail(422, "NO_ELIGIBLE_RECIPIENTS", "발송 가능한 수신자가 없습니다.");
    if (checked.length !== eligible.length && !input.excludeInvalid) fail(409, "RECIPIENT_REVIEW_REQUIRED", "제외 대상을 확인하고 제외 후 발송에 동의해주세요.");
    const pending: CampaignDelivery[] = [];
    for (const item of checked) {
      const saved = await tx.campaignDelivery.update({ where: { id: item.row.id }, data: item.reason ?
        { status: item.row.erasedAt ? "cancelled" : "excluded", reason: item.reason } :
        { ...recipientBinding(item.consent), contactCipher: encrypt(item.contact), status: "queued", reason: null, attempt: { increment: 1 } } });
      if (!item.reason) pending.push(saved);
    }
    const saved = await changeCampaign(tx, row, { attachmentSnapshot: attachments.snapshot, mailProtocol: CAMPAIGN_MAIL_JOB_TYPE, status: "scheduled", requesterId: ctx.user.id, requestedAt: new Date(), scheduledAt: dueAt, senderVersion: sender!.version }, "scheduled", ctx, requestId);
    await enqueue(tx, saved, pending, dueAt);
    return { status: 202, body: { id, version: saved.version, queued: pending.length, excluded: checked.length - pending.length } };
  }, async tx => { await locateCampaign(tx, ctx, id, "message.send"); });
}
export async function rescheduleCampaign(ctx: Context, id: string, input: z.infer<typeof campaignReschedule>, requestId: string) {
  return db.$transaction(async tx => {
    const { row, sender, evaluations } = await prepareCampaign(tx, ctx, id, input.version, "message.send");
    if (row.status !== "scheduled" || row.archivedAt || evaluations.some(e => !["queued", "excluded", "cancelled"].includes(e.row.status)))
      fail(409, "RESCHEDULE_UNAVAILABLE", "처리가 시작되기 전 예약만 변경할 수 있습니다.");
    await readCampaignAttachments(tx, row);
    const dueAt = validateTime(row, input.at); requireTransport(row, sender, dueAt, true);
    const pending = evaluations.filter(e => e.row.status === "queued");
    if (!pending.length || pending.some(e => e.reason || e.consent!.sourceSubmission.retentionUntil <= dueAt)) fail(409, "RECIPIENT_CHANGED", "수신 근거가 변경되었습니다. 예약을 취소하고 대상을 다시 확인해주세요.");
    await tx.job.updateMany({ where: { campaignDeliveryId: { in: pending.map(e => e.row.id) }, status: { in: ["queued", "retry", "leased"] } }, data: { dueAt, status: "queued", leaseOwner: null, leaseUntil: null } });
    const saved = await changeCampaign(tx, row, { scheduledAt: dueAt }, "rescheduled", ctx, requestId); return { id, version: saved.version };
  }, { timeout: 30000 });
}
export async function cancelCampaign(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    await locateCampaign(tx, ctx, id, "message.manage"); const row = await lockCampaign(tx, id); campaignLive(row); requireVersion({ version }, row);
    if (!["scheduled", "dispatching"].includes(row.status)) fail(409, "CANCEL_UNAVAILABLE", "대기 중인 발송만 취소할 수 있습니다.");
    // The worker keeps the parent locked through delivery. A committed cancellation prevents all subsequent sends.
    // If a worker died after external acceptance, "sending" may already have caused an effect.
    // The live worker holds this parent through I/O; only an interrupted/gap attempt can reach here.
    await tx.campaignDelivery.updateMany({ where: { campaignId: id, status: "sending" }, data: { status: "unknown", reason: "DELIVERY_UNCERTAIN" } });
    await tx.job.updateMany({ where: { campaignDelivery: { campaignId: id, status: "unknown" }, status: { in: ["queued", "retry", "leased"] } }, data: { status: "dead", completedAt: new Date(), leaseOwner: null, leaseUntil: null, lastError: "DELIVERY_UNCERTAIN" } });
    const cancelled = await tx.campaignDelivery.updateMany({ where: { campaignId: id, status: "queued" }, data: { status: "cancelled", reason: "CANCELLED" } });
    await tx.job.updateMany({ where: { campaignDelivery: { campaignId: id }, status: { in: ["queued", "retry", "leased"] } }, data: { status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseUntil: null, lastError: "CAMPAIGN_CANCELLED" } });
    const saved = await changeCampaign(tx, row, { status: "cancelled", completedAt: new Date() }, "cancelled", ctx, requestId);
    return { id, version: saved.version, cancelled: cancelled.count, accepted: await tx.campaignDelivery.count({ where: { campaignId: id, status: { in: ["accepted", "local_delivered"] } } }), unknown: await tx.campaignDelivery.count({ where: { campaignId: id, status: "unknown" } }) };
  }, { timeout: 45000 });
}
export async function archiveCampaign(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    await locateCampaign(tx, ctx, id, "message.manage"); const row = await lockCampaign(tx, id); campaignLive(row); requireVersion({ version }, row);
    if (!["completed", "partial_failed", "failed", "cancelled"].includes(row.status)) fail(409, "ARCHIVE_UNAVAILABLE", "처리가 끝난 캠페인만 보관할 수 있습니다.");
    const saved = await changeCampaign(tx, row, { archivedAt: row.archivedAt ? null : new Date() }, row.archivedAt ? "unarchived" : "archived", ctx, requestId);
    return { id, version: saved.version };
  });
}
export async function retryCampaign(ctx: Context, id: string, input: z.infer<typeof campaignRetry>, key: string | null, requestId: string) {
  return idempotent("campaign:retry:" + ctx.member.id + ":" + id, key, input, async tx => {
    const { row, sender, evaluations } = await prepareCampaign(tx, ctx, id, input.version, "message.send");
    if (!["failed", "partial_failed"].includes(row.status) || row.archivedAt) fail(409, "RETRY_UNAVAILABLE", "보관하지 않은 실패 건만 다시 요청할 수 있습니다.");
    await readCampaignAttachments(tx, row);
    const at = new Date(); requireTransport(row, sender, at, true);
    const ids = [...new Set(input.ids)], selected = evaluations.filter(e => ids.includes(e.row.id));
    if (selected.length !== ids.length) fail(404, "TARGET_NOT_FOUND", "수신자를 찾을 수 없습니다.");
    if (selected.some(e => e.row.status !== "failed" || e.reason || e.row.attempt >= 5)) fail(409, "RETRY_UNAVAILABLE", "동일한 동의·발신자를 유지한 실패 건만 최대 5회 요청할 수 있습니다. 접수 여부가 불확실한 건은 재전송할 수 없습니다.");
    const pending = []; for (const e of selected) pending.push(await tx.campaignDelivery.update({ where: { id: e.row.id }, data: { status: "queued", reason: null, attempt: { increment: 1 } } }));
    const saved = await changeCampaign(tx, row, { status: "scheduled", scheduledAt: at, completedAt: null }, "retry_requested", ctx, requestId);
    await enqueue(tx, saved, pending, at); return { status: 202, body: { id, version: saved.version, queued: pending.length } };
  }, async tx => { await locateCampaign(tx, ctx, id, "message.send"); });
}
