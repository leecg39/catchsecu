import { stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Campaign, CampaignDelivery } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import { decrypt, encrypt } from "./crypto";
import { env } from "./env";
import { HttpError } from "./http";
import { withEmailPolicy } from "./email-policy";
import { lockFileIssuer } from "./file-access";
import { senderDenial } from "./sender-access";
import { evaluateRecipient, lockCampaign, lockCampaignConsents, settleCampaign, changeCampaign } from "./campaign-common";
import { readCampaignAttachments, markCampaignFilesForDeletion } from "./campaign-files";
import { finishFileDeletion } from "./files";
import { deliverMail, type MailAttachment, type ClaimedJob } from "./jobs";
import { deliverSms, smsReceiptFile } from "./sms-adapter";
import { audit } from "./audit";

const jobPayload = z.object({ campaignId: z.uuid(), deliveryId: z.uuid(), attempt: z.number().int().positive(), transport: z.enum(["local", "smtp", "sms-local", "sms-solapi"]) }).strict();
type Payload = z.infer<typeof jobPayload>;
async function lockedState(tx: Transaction, job: ClaimedJob, workerId: string, payload: Payload) {
  const initial = await tx.campaignDelivery.findUnique({ where: { id: payload.deliveryId }, include: { campaign: true } });
  if (!initial || initial.id !== job.campaignDeliveryId || initial.tenantId !== job.tenantId || initial.campaignId !== payload.campaignId || initial.attempt !== payload.attempt || job.type !== initial.campaign.mailProtocol) throw new Error("CAMPAIGN_JOB_SCOPE");
  const member = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: initial.tenantId, userId: initial.campaign.requesterId! } } });
  let reason: string | null = null;
  try {
    await lockFileIssuer(tx, { tenantId: initial.tenantId, member: { id: member?.id ?? "" }, user: { id: initial.campaign.requesterId! } }, initial.serviceId, ["message.send", "marketing.read"]);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    reason = ["COMPANY_UNAVAILABLE", "SERVICE_ARCHIVED", "NOT_FOUND"].includes(error.code) ? "SERVICE_UNAVAILABLE" : "PERMISSION_REVOKED";
  }
  const consents = await lockCampaignConsents(tx, initial.campaign, [initial.contactHash]);
  await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${initial.campaign.senderId} FOR SHARE`;
  const sender = await tx.sender.findUnique({ where: { id: initial.campaign.senderId! } });
  const campaign = await lockCampaign(tx, initial.campaignId);
  await tx.$queryRaw`SELECT id FROM "CampaignDelivery" WHERE id=${initial.id} FOR UPDATE`;
  const recipient = await tx.campaignDelivery.findUniqueOrThrow({ where: { id: initial.id } });
  await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
  const current = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
  if (current.status !== "leased" || current.leaseOwner !== workerId || !current.leaseUntil || current.leaseUntil <= new Date() || current.payloadErasedAt) return null;
  if (!["scheduled", "dispatching"].includes(campaign.status)) reason = "CANCELLED";
  if (campaign.expiresAt <= new Date() || !campaign.contentCipher || recipient.erasedAt) reason = "DATA_ERASED";
  if (!sender || sender.version !== campaign.senderVersion || senderDenial(sender)) reason ??= "SENDER_UNAVAILABLE";
  if (campaign.channel === "sms" ? payload.transport !== (env.SMS_TRANSPORT === "solapi" ? "sms-solapi" : env.SMS_TRANSPORT === "local" ? "sms-local" : null) : payload.transport !== env.MAIL_TRANSPORT) reason ??= campaign.channel === "sms" ? "SMS_PROVIDER_REQUIRED" : "SENDER_UNAVAILABLE";
  const evaluated = await evaluateRecipient(tx, recipient, campaign, consents.get(recipient.contactHash), true);
  reason ??= evaluated.reason;
  return { campaign, recipient, reason, evaluated, sender };
}
async function finish(tx: Transaction, job: ClaimedJob, campaign: Campaign, recipient: CampaignDelivery, status: string, reason: string | null, acceptedAt?: Date) {
  if (["queued", "sending"].includes(recipient.status)) await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status, reason, ...(acceptedAt ? { acceptedAt } : {}) } });
  await tx.job.update({ where: { id: job.id }, data: { status: ["local_delivered", "accepted"].includes(status) ? "done" : status === "cancelled" ? "cancelled" : "dead",
    lastError: reason, completedAt: new Date(), leaseOwner: null, leaseUntil: null } });
  await settleCampaign(tx, campaign);
  await deliveryAudit(tx, job, recipient, status);
}
async function deliveryAudit(tx: Transaction, job: ClaimedJob, recipient: CampaignDelivery, status: string) {
  await audit(tx, { tenantId: recipient.tenantId, user: { id: null } }, job.id,
    "campaign.delivery_" + status, "campaignDelivery", recipient.id, ["status"], recipient.serviceId);
  if (status !== "sending") await tx.jobAttempt.updateMany({ where: { jobId: job.id, attempt: job.attempts, outcome: "leased" },
    data: { outcome: status === "local_delivered" || status === "accepted" ? "delivered" : status === "cancelled" ? "suppressed" : status === "queued" ? "retry" : "dead", finishedAt: new Date() } });
}
async function localReceipt(jobId: string) {
  try { return (await stat(resolve(env.LOCAL_MAIL_DIR, jobId + ".json"))).mtime; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/** Persist "sending" before I/O so an SMTP timeout or a killed process cannot cause a blind resend. */
export async function runCampaignJob(job: ClaimedJob, workerId: string) {
  const payload = jobPayload.parse(decrypt(job.payloadCipher));
  const prepared = await db.$transaction(async tx => {
    const state = await lockedState(tx, job, workerId, payload); if (!state) return false;
    const { campaign, recipient, reason } = state;
    if (recipient.status === "sending") {
      const receipt = payload.transport === "local" ? await localReceipt(job.id) : payload.transport === "sms-local" ? await smsReceiptFile(job.id) : payload.transport === "sms-solapi" ? (await tx.smsReceipt.findUnique({ where: { deliveryId: payload.deliveryId } }))?.createdAt ?? null : null;
      if (receipt || payload.transport === "smtp") {
        await finish(tx, job, campaign, recipient, receipt ? payload.transport === "sms-solapi" ? "accepted" : "local_delivered" : "unknown", receipt ? null : "DELIVERY_UNCERTAIN", receipt ?? undefined); return false;
      }
    }
    if (!["queued", "sending"].includes(recipient.status)) {
      await finish(tx, job, campaign, recipient, recipient.status, recipient.reason, recipient.acceptedAt ?? undefined); return false;
    }
    if (reason) { await finish(tx, job, campaign, recipient, "cancelled", reason); return false; }
    await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "sending", reason: null } });
    await deliveryAudit(tx, job, recipient, "sending");
    await settleCampaign(tx, campaign); return true;
  }, { timeout: 45000 });
  if (!prepared) return;
  await db.$transaction(async tx => {
    const state = await lockedState(tx, job, workerId, payload); if (!state) return;
    const { campaign, recipient, reason, sender, evaluated } = state;
    if (recipient.status !== "sending") { await finish(tx, job, campaign, recipient, recipient.status, recipient.reason, recipient.acceptedAt ?? undefined); return; }
    if (reason) { await finish(tx, job, campaign, recipient, "cancelled", reason); return; }
    if (payload.transport === "sms-local" || payload.transport === "sms-solapi") {
      const solapi = payload.transport === "sms-solapi";
      try {
        const sent = await deliverSms({ transport: solapi ? "solapi" : "local", jobId: job.id, to: evaluated.contact!.contact, from: decrypt<string>(sender!.addressCipher!), text: evaluated.content!.text });
        if (solapi) await tx.smsReceipt.create({ data: { tenantId: recipient.tenantId, deliveryId: recipient.id, receiptId: sent.receiptId, status: "provider_accepted" } });
      }
      catch (error) {
        if (error instanceof HttpError && error.status === 422) { await finish(tx, job, campaign, recipient, "failed", error.code); return; }
        if (job.attempts >= job.maxAttempts) { await finish(tx, job, campaign, recipient, "failed", "DELIVERY_FAILED"); return; }
        await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "queued", reason: "DELIVERY_FAILED" } });
        await tx.job.update({ where: { id: job.id }, data: { status: "retry", dueAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)), leaseOwner: null, leaseUntil: null, lastError: "DELIVERY_FAILED" } });
        await deliveryAudit(tx, job, recipient, "queued"); return;
      }
      await finish(tx, job, campaign, recipient, solapi ? "accepted" : "local_delivered", null, new Date()); return;
    }
    let attachments: MailAttachment[];
    try { attachments = (await readCampaignAttachments(tx, campaign)).attachments; } catch { await finish(tx, job, campaign, recipient, "failed", "ATTACHMENT_UNAVAILABLE"); return; }
    let status: "local_delivered" | "accepted";
    try {
      status = await deliverMail(job, withEmailPolicy(job.id, { to: evaluated.contact!.contact, subject: evaluated.content!.subject, attachments, text: evaluated.content!.text, ...(evaluated.content!.format === "html" ? { html: evaluated.content!.html } : {}) }), { name: sender!.label, address: decrypt<string>(sender!.addressCipher!) });
    } catch {
      if (payload.transport === "smtp") { await finish(tx, job, campaign, recipient, "unknown", "DELIVERY_UNCERTAIN"); return; }
      if (job.attempts >= job.maxAttempts) { await finish(tx, job, campaign, recipient, "failed", "DELIVERY_FAILED"); return; }
      await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "queued", reason: "DELIVERY_FAILED" } });
      await tx.job.update({ where: { id: job.id }, data: { status: "retry", dueAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)), leaseOwner: null, leaseUntil: null, lastError: "DELIVERY_FAILED" } });
      await deliveryAudit(tx, job, recipient, "queued"); return;
    }
    // Keep DB failure outside the transport catch: a successful external send must remain uncertain after rollback.
    await finish(tx, job, campaign, recipient, status, null, new Date());
  }, { timeout: 45000 });
}

export async function cleanupCampaigns() {
  const expired = await db.campaign.findMany({ where: { expiresAt: { lte: new Date() }, status: { notIn: ["expired", "deleted"] } }, take: 50, select: { id: true } });
  for (const candidate of expired) await db.$transaction(async tx => {
    const campaign = await lockCampaign(tx, candidate.id);
    if (["expired", "deleted"].includes(campaign.status) || campaign.expiresAt > new Date()) return;
    // No source locks here: erasure and expiry both proceed parent/source → delivery → job.
    const recipients = await tx.campaignDelivery.findMany({ where: { campaignId: campaign.id, erasedAt: null }, orderBy: { id: "asc" } });
    for (const row of recipients) await tx.campaignDelivery.update({ where: { id: row.id }, data: { contactCipher: null, erasedAt: new Date(),
      ...(["accepted", "local_delivered", "provider_accepted", "unknown"].includes(row.status) ? {} : row.status === "sending" ? { status: "unknown", reason: "DELIVERY_UNCERTAIN" } : { status: "cancelled", reason: "DATA_ERASED" }) } });
    const jobs = await tx.job.findMany({ where: { campaignDelivery: { campaignId: campaign.id }, payloadErasedAt: null }, orderBy: { id: "asc" } });
    for (const job of jobs) {
      try { await unlink(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await tx.job.update({ where: { id: job.id }, data: { payloadCipher: encrypt({ erased: true }), payloadErasedAt: new Date(), status: job.status === "done" ? "done" : "cancelled", leaseOwner: null, leaseUntil: null } });
    }
    await markCampaignFilesForDeletion(tx, campaign.id);
    await changeCampaign(tx, campaign, { status: "expired", title: campaign.title, contentCipher: null, completedAt: campaign.completedAt ?? new Date() }, "expired");
  }, { timeout: 30000 });
  const removedFiles = await db.fileObject.findMany({ where: { campaignId: { not: null }, status: "deleting" }, select: { id: true }, take: 100 });
  for (const file of removedFiles) await finishFileDeletion(file.id, "campaign-expiry").catch(() => {});
  // Repair leases exhausted by a terminated worker, then settle campaigns changed by privacy erasure.
  // Filter old attempts before LIMIT: stale failed jobs must neither modify nor starve a new attempt.
  const brokenIds = await db.$queryRaw<{ id: string }[]>`
    SELECT j.id FROM "Job" j JOIN "CampaignDelivery" d ON d.id=j."campaignDeliveryId"
    WHERE j.type IN ('mail.campaign.v1','mail.campaign.v2','mail.campaign.v3') AND j.status IN ('dead','cancelled') AND d.status IN ('queued','sending')
      AND j."dedupeKey"='campaign:'||d.id||':'||d.attempt::text
    ORDER BY j."updatedAt", j.id LIMIT 100`;
  const broken = await db.job.findMany({ where: { id: { in: brokenIds.map(j => j.id) } } });
  for (const job of broken) await db.$transaction(async tx => {
    const initial = await tx.campaignDelivery.findUniqueOrThrow({ where: { id: job.campaignDeliveryId! } }), campaign = await lockCampaign(tx, initial.campaignId);
    await tx.$queryRaw`SELECT id FROM "CampaignDelivery" WHERE id=${initial.id} FOR UPDATE`;
    const row = await tx.campaignDelivery.findUniqueOrThrow({ where: { id: initial.id } });
    if (!["queued", "sending"].includes(row.status)) return;
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
    if (!["dead", "cancelled"].includes(current.status) || current.dedupeKey !== "campaign:" + row.id + ":" + row.attempt) return;
    const transport = (() => { try { return jobPayload.parse(decrypt(current.payloadCipher)).transport; } catch { return null; } })();
    const receipt = transport === "sms-local" ? await smsReceiptFile(job.id) : transport === "sms-solapi" ? (await tx.smsReceipt.findUnique({ where: { deliveryId: row.id } }))?.createdAt ?? null : await localReceipt(job.id);
    const status = receipt && row.status === "sending" ? transport === "sms-solapi" ? "accepted" : "local_delivered" : row.status === "sending" ? "unknown" : job.status === "cancelled" ? "cancelled" : "failed";
    await finish(tx, job, campaign, row, status, receipt ? null : status === "unknown" ? "DELIVERY_UNCERTAIN" : "DELIVERY_FAILED", receipt ?? undefined);
  });
  const candidates = await db.campaign.findMany({ where: { status: { in: ["scheduled", "dispatching"] }, recipients: { none: { status: { in: ["queued", "sending"] } } } }, take: 100, select: { id: true } });
  for (const row of candidates) await db.$transaction(async tx => { await settleCampaign(tx, await lockCampaign(tx, row.id)); });
  return { expired: expired.length, repaired: broken.length };
}
