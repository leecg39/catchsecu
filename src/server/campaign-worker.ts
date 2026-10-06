import { lockKakaoBinding } from "./kakao-binding";
import { campaignLedgerSource } from "./campaign-ledger";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
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
import { solapiConfigured } from "./sender-providers";
import { evaluateRecipient, lockCampaign, lockCampaignConsents, settleCampaign, changeCampaign, normalizedTarget, type RecipientContact } from "./campaign-common";
import { readCampaignAttachments, markCampaignFilesForDeletion } from "./campaign-files";
import { finishFileDeletion } from "./files";
import { deliverMail, type MailAttachment, type ClaimedJob } from "./jobs";
import { deliverSms, smsReceiptFile } from "./sms-adapter";
import { postLedgerTransfer } from "./ledger";
import { audit } from "./audit";

const jobPayload = z.object({ campaignId: z.uuid(), deliveryId: z.uuid(), attempt: z.number().int().positive(), transport: z.enum(["local", "smtp", "sms-local", "sms-solapi", "kakao-local"]), unitCost: z.number().int().min(0).max(1000000).optional() }).strict();
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
  // 알림톡 대체발송 잡은 SMS 채널 동의와 대체발신자를 검증한다 — 원래 잡의 카카오 바인딩은 그대로 유지된다.
  const fallbackLeg = initial.campaign.channel === "kakao" && (payload.transport === "sms-local" || payload.transport === "sms-solapi");
  let consentHash = initial.contactHash;
  if (fallbackLeg && !initial.erasedAt && initial.contactCipher)
    try { consentHash = normalizedTarget("sms", decrypt<RecipientContact>(initial.contactCipher).contact).hash; } catch { /* evaluateRecipient reports the original failure */ }
  const consents = await lockCampaignConsents(tx, { tenantId: initial.tenantId, serviceId: initial.serviceId, channel: fallbackLeg ? "sms" : initial.campaign.channel }, [consentHash]);
  const senderId = fallbackLeg ? initial.campaign.fallbackSenderId : initial.campaign.senderId;
  const sender = senderId
    ? (await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${senderId} FOR SHARE`, await tx.sender.findUnique({ where: { id: senderId } }))
    : null;
  const campaign = await lockCampaign(tx, initial.campaignId);
  await tx.$queryRaw`SELECT id FROM "CampaignDelivery" WHERE id=${initial.id} FOR UPDATE`;
  const recipient = await tx.campaignDelivery.findUniqueOrThrow({ where: { id: initial.id } });
  await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
  const current = await tx.job.findUniqueOrThrow({ where: { id: job.id } });
  if (current.status !== "leased" || current.leaseOwner !== workerId || !current.leaseUntil || current.leaseUntil <= new Date() || current.payloadErasedAt) return null;
  if (!["scheduled", "dispatching"].includes(campaign.status)) reason = "CANCELLED";
  if (campaign.expiresAt <= new Date() || !campaign.contentCipher || recipient.erasedAt) reason = "DATA_ERASED";
  let kakaoTemplate: { id: string; status: string; version: number; body: string; buttons: unknown; channel: { status: string } } | null = null;
  if (fallbackLeg) {
    if (!sender || sender.version !== campaign.fallbackSenderVersion || senderDenial(sender)) reason ??= "FALLBACK_UNAVAILABLE";
  } else if (campaign.channel === "kakao") {
    kakaoTemplate = await lockKakaoBinding(tx, campaign.tenantId, campaign.serviceId, campaign.kakaoTemplateId);
    if (!kakaoTemplate || kakaoTemplate.status !== "approved" || kakaoTemplate.channel.status !== "verified" || kakaoTemplate.version !== campaign.kakaoTemplateVersion) reason ??= "TEMPLATE_UNAVAILABLE";
  } else if (!sender || sender.version !== campaign.senderVersion || senderDenial(sender)) reason ??= "SENDER_UNAVAILABLE";
  const expectedTransport = fallbackLeg || campaign.channel === "sms"
    ? env.SMS_TRANSPORT === "solapi" ? "sms-solapi" : env.SMS_TRANSPORT === "local" ? "sms-local" : null
    : campaign.channel === "kakao" ? env.KAKAO_PROVIDER === "local" ? "kakao-local" : null
    : env.MAIL_TRANSPORT;
  if (payload.transport !== expectedTransport)
    reason ??= fallbackLeg || campaign.channel === "sms" ? "SMS_PROVIDER_REQUIRED" : campaign.channel === "kakao" ? "KAKAO_PROVIDER_REQUIRED" : "SENDER_UNAVAILABLE";
  const evaluated = await evaluateRecipient(tx, recipient, campaign, consents.get(consentHash), true, fallbackLeg ? "sms" : undefined);
  reason ??= evaluated.reason;
  return { campaign, recipient, reason, evaluated, sender, kakaoTemplate };
}
async function finish(tx: Transaction, job: ClaimedJob, campaign: Campaign, recipient: CampaignDelivery, status: string, reason: string | null, acceptedAt?: Date) {
  if (["queued", "sending"].includes(recipient.status)) await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status, reason, ...(acceptedAt ? { acceptedAt } : {}) } });
  await tx.job.update({ where: { id: job.id }, data: { status: ["local_delivered", "accepted"].includes(status) ? "done" : status === "cancelled" ? "cancelled" : "dead",
    lastError: reason, completedAt: new Date(), leaseOwner: null, leaseUntil: null } });
  await settleCampaign(tx, campaign);
  await deliveryAudit(tx, job, recipient, status);
}
/** 잠금/첨부 I/O를 기다린 뒤 현재 기한을 다시 확인한다. 아직 발송 전이므로 임대 만료는 안전하게 재예약할 수 있다. */
async function readyBeforeIo(tx: Transaction, job: ClaimedJob, workerId: string, payload: Payload,
  campaign: Campaign, recipient: CampaignDelivery, hasHold: boolean, ledgerSource: string) {
  const fresh = await lockedState(tx, job, workerId, payload);
  if (!fresh) {
    if (job.attempts >= job.maxAttempts) {
      if (hasHold) await releaseHeld(tx, recipient, ledgerSource);
      await finish(tx, job, campaign, recipient, "cancelled", "LEASE_EXHAUSTED");
    } else {
      // 같은 원천의 reserve는 멱등이다. 재시도할 예약 잔액을 release하면 다음 capture가 불가능해진다.
      await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "queued", reason: "LEASE_EXPIRED" } });
      await tx.job.update({ where: { id: job.id }, data: { status: "retry",
        leaseOwner: null, leaseUntil: null, lastError: "LEASE_EXPIRED" } });
      await deliveryAudit(tx, job, recipient, "queued");
    }
    return null;
  }
  if (fresh.reason) {
    if (hasHold) await releaseHeld(tx, recipient, ledgerSource);
    await finish(tx, job, campaign, recipient, "cancelled", fresh.reason); return null;
  }
  return fresh;
}
/** 발송 정산. 예약은 원천키 멱등이라 재시도에서 재사용하고, 최종 상태에서만 capture/release로 정산한다. */
function isSms(transport: string) { return transport === "sms-local" || transport === "sms-solapi"; }
function isKakao(transport: string) { return transport === "kakao-local"; }
function isMessage(transport: string) { return isSms(transport) || isKakao(transport); }
async function kakaoReceipt(jobId: string) {
  try { return (await stat(resolve(env.LOCAL_KAKAO_DIR, jobId + ".json"))).mtime; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/** 로컬 알림톡 발송 — 템플릿 본문의 #{name}/#{contact}만 치환해 영수증 파일에 남긴다. 미치환 변수는 발송하지 않는다. */
async function deliverKakaoLocal(jobId: string, deliveryId: string, template: { id: string; body: string; buttons: unknown }, to: { name: string; contact: string }) {
  const body = template.body.replaceAll(/#\{(name|contact)\}/g, (_, key: "name" | "contact") => to[key]);
  if (/#\{[A-Za-z0-9_]{1,30}\}/.test(body)) throw new HttpError(422, "VARIABLE_MISSING", "템플릿 변수를 치환할 수 없습니다.");
  await mkdir(env.LOCAL_KAKAO_DIR, { recursive: true });
  await writeFile(resolve(env.LOCAL_KAKAO_DIR, jobId + ".json"), JSON.stringify({ deliveryId, templateId: template.id, to: to.contact, body, buttons: template.buttons, status: "local_delivered", at: new Date().toISOString() }));
}
async function reserveMessage(tx: Transaction, recipient: CampaignDelivery, unitCost: number, source = recipient.id) {
  return postLedgerTransfer(tx, { tenantId: recipient.tenantId, serviceId: recipient.serviceId, currency: "KRW", kind: "reserve", amount: BigInt(unitCost), sourceKind: "campaign_delivery", sourceId: source });
}
async function captureMessage(tx: Transaction, recipient: CampaignDelivery, holdId: string, unitCost: number, source = recipient.id) {
  return postLedgerTransfer(tx, { tenantId: recipient.tenantId, serviceId: recipient.serviceId, currency: "KRW", kind: "capture", amount: BigInt(unitCost), sourceKind: "campaign_delivery", sourceId: source, reservationId: holdId });
}
async function releaseHeld(tx: Transaction, recipient: CampaignDelivery, source = recipient.id) {
  const hold = await tx.ledgerTransaction.findUnique({ where: { tenantId_kind_sourceKind_sourceId: { tenantId: recipient.tenantId, kind: "reserve", sourceKind: "campaign_delivery", sourceId: source } } });
  if (!hold) return;
  const settled = await tx.ledgerTransaction.findFirst({ where: { reservationId: hold.id, kind: { in: ["release", "capture"] } } });
  if (settled) return;
  await postLedgerTransfer(tx, { tenantId: recipient.tenantId, serviceId: recipient.serviceId, currency: "KRW", kind: "release", amount: hold.amount, sourceKind: "campaign_delivery", sourceId: source, reservationId: hold.id });
}
async function settleRecovered(tx: Transaction, recipient: CampaignDelivery, unitCost: number, source = recipient.id) {
  const hold = await reserveMessage(tx, recipient, unitCost, source);
  const released = await tx.ledgerTransaction.findFirst({ where: { reservationId: hold.id, kind: "release" } });
  if (released) return;
  await captureMessage(tx, recipient, hold.id, unitCost, source);
}
/** 알림톡 최종 실패 → 문자 대체발송. SMS 동의·공급자·재시도 한도를 확인한 뒤 잡을 교체한다. */
async function enqueueFallback(tx: Transaction, job: ClaimedJob, campaign: Campaign, recipient: CampaignDelivery, cause: string) {
  if (!campaign.fallbackSenderId || recipient.attempt >= 5 || !recipient.contactCipher || recipient.erasedAt) return false;
  if (env.SMS_TRANSPORT === "solapi" ? !solapiConfigured(campaign.tenantId) : env.SMS_TRANSPORT !== "local") return false;
  const target = normalizedTarget("sms", decrypt<RecipientContact>(recipient.contactCipher).contact);
  if (!target.valid) return false;
  const consent = await tx.marketingPreference.findFirst({ where: { tenantId: campaign.tenantId, serviceId: campaign.serviceId, channel: "sms", contactHash: target.hash, status: "granted", contactCipher: { not: null } } });
  if (!consent) return false;
  const next = recipient.attempt + 1;
  // 상태기계는 attempt 증분을 failed→queued에서만 허용한다 — 실패 기록을 남긴 뒤 재예약한다.
  await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "failed", reason: cause } });
  await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "queued", reason: null, attempt: next } });
  await tx.job.create({ data: { type: campaign.mailProtocol, tenantId: campaign.tenantId, senderId: campaign.fallbackSenderId, campaignDeliveryId: recipient.id,
    marketingPreferenceId: recipient.preferenceId, marketingSubmissionId: recipient.sourceSubmissionId,
    dedupeKey: "campaign:" + recipient.id + ":" + next, dueAt: new Date(),
    payloadCipher: encrypt({ campaignId: campaign.id, deliveryId: recipient.id, attempt: next, transport: env.SMS_TRANSPORT === "solapi" ? "sms-solapi" : "sms-local", unitCost: env.MESSAGE_UNIT_COST_KRW }) } });
  await tx.job.update({ where: { id: job.id }, data: { status: "done", lastError: "KAKAO_FALLBACK:" + cause, completedAt: new Date(), leaseOwner: null, leaseUntil: null } });
  await settleCampaign(tx, campaign);
  await audit(tx, { tenantId: recipient.tenantId, user: { id: null } }, job.id, "campaign.delivery_fallback", "campaignDelivery", recipient.id, ["status"], recipient.serviceId);
  await tx.jobAttempt.updateMany({ where: { jobId: job.id, attempt: job.attempts, outcome: "leased" }, data: { outcome: "retry", finishedAt: new Date() } });
  return true;
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
  const unitCost = isMessage(payload.transport) ? (payload.unitCost ?? (isKakao(payload.transport) ? env.KAKAO_UNIT_COST_KRW : env.MESSAGE_UNIT_COST_KRW)) : 0;
  const prepared = await db.$transaction(async tx => {
    const state = await lockedState(tx, job, workerId, payload); if (!state) return false;
    const { campaign, recipient, reason } = state;
    // 대체발송 잡은 카카오 홀드와 분리된 원장 원천으로 정산한다.
    const ledgerSource = await campaignLedgerSource(tx, recipient.tenantId, recipient.id, payload.attempt, campaign.channel, payload.transport);
    if (recipient.status === "sending") {
      const solapi = payload.transport === "sms-solapi";
      const smsRow = solapi ? await tx.smsReceipt.findUnique({ where: { deliveryId_attempt: { deliveryId: payload.deliveryId, attempt: payload.attempt } } }) : null;
      const receipt = payload.transport === "local" ? await localReceipt(job.id) : payload.transport === "sms-local" ? await smsReceiptFile(job.id) : solapi ? smsRow?.createdAt ?? null : payload.transport === "kakao-local" ? await kakaoReceipt(job.id) : null;
      // 공급자가 거부·미확인으로 답한 건은 접수가 아니다 — 홀드를 환불하고 종결한다.
      if (smsRow && smsRow.status !== "provider_accepted") {
        if (unitCost > 0) await releaseHeld(tx, recipient, ledgerSource);
        await finish(tx, job, campaign, recipient, smsRow.status === "failed" ? "failed" : "unknown", smsRow.status === "failed" ? "DELIVERY_FAILED" : "DELIVERY_UNCERTAIN"); return false;
      }
      if (receipt || payload.transport === "smtp" || solapi) {
        if (receipt && isMessage(payload.transport) && unitCost > 0) await settleRecovered(tx, recipient, unitCost, ledgerSource);
        // solapi는 영수증 부재만으로 재전송하면 공급자 중복 발송 위험이 있다 — unknown으로 두고 webhook 대사가 정산한다.
        await finish(tx, job, campaign, recipient, receipt ? solapi ? "accepted" : "local_delivered" : "unknown", receipt ? null : "DELIVERY_UNCERTAIN", receipt ?? undefined); return false;
      }
    }
    if (!["queued", "sending"].includes(recipient.status)) {
      if (isMessage(payload.transport) && unitCost > 0) await releaseHeld(tx, recipient, ledgerSource);
      await finish(tx, job, campaign, recipient, recipient.status, recipient.reason, recipient.acceptedAt ?? undefined); return false;
    }
    if (reason) {
      if (isMessage(payload.transport) && unitCost > 0) await releaseHeld(tx, recipient, ledgerSource);
      await finish(tx, job, campaign, recipient, "cancelled", reason); return false;
    }
    await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "sending", reason: null } });
    await deliveryAudit(tx, job, recipient, "sending");
    await settleCampaign(tx, campaign); return true;
  }, { timeout: 45000 });
  if (!prepared) return;
  await db.$transaction(async tx => {
    const state = await lockedState(tx, job, workerId, payload); if (!state) return;
    const { campaign, recipient, reason, kakaoTemplate } = state;
    const ledgerSource = await campaignLedgerSource(tx, recipient.tenantId, recipient.id, payload.attempt, campaign.channel, payload.transport);
    if (recipient.status !== "sending") {
      if (isMessage(payload.transport) && unitCost > 0) await releaseHeld(tx, recipient, ledgerSource);
      await finish(tx, job, campaign, recipient, recipient.status, recipient.reason, recipient.acceptedAt ?? undefined); return;
    }
    if (reason) {
      if (isMessage(payload.transport) && unitCost > 0) await releaseHeld(tx, recipient, ledgerSource);
      await finish(tx, job, campaign, recipient, "cancelled", reason); return;
    }
    if (isKakao(payload.transport)) {
      if (!kakaoTemplate) { await finish(tx, job, campaign, recipient, "cancelled", "TEMPLATE_UNAVAILABLE"); return; }
      let hold: { id: string } | null = null;
      if (unitCost > 0) {
        const acct = await tx.$queryRaw<{ available: bigint }[]>`SELECT available FROM "CreditAccount" WHERE "tenantId"=${recipient.tenantId} AND currency='KRW' FOR UPDATE`;
        const existing = await tx.ledgerTransaction.findUnique({ where: { tenantId_kind_sourceKind_sourceId: { tenantId: recipient.tenantId, kind: "reserve", sourceKind: "campaign_delivery", sourceId: ledgerSource } } });
        if (!existing && (acct.length === 0 || acct[0].available < BigInt(unitCost))) { await finish(tx, job, campaign, recipient, "failed", "INSUFFICIENT_CREDIT"); return; }
        hold = await reserveMessage(tx, recipient, unitCost, ledgerSource);
      }
      // 잔고 잠금 대기 중에도 시각은 흐른다. 발송 직전에 보유 기한·현재 권한·리스 기한을 다시 검사한다.
      const fresh = await readyBeforeIo(tx, job, workerId, payload, campaign, recipient, !!hold, ledgerSource);
      if (!fresh) return;
      if (!fresh.kakaoTemplate || !fresh.evaluated.contact) {
        if (hold) await releaseHeld(tx, recipient, ledgerSource);
        await finish(tx, job, campaign, recipient, "cancelled", "TEMPLATE_UNAVAILABLE"); return;
      }
      try { await deliverKakaoLocal(job.id, recipient.id, fresh.kakaoTemplate, fresh.evaluated.contact); }
      catch (error) {
        if (error instanceof HttpError && error.status === 422) { if (hold) await releaseHeld(tx, recipient, ledgerSource); if (await enqueueFallback(tx, job, campaign, recipient, error.code)) return; await finish(tx, job, campaign, recipient, "failed", error.code); return; }
        if (job.attempts >= job.maxAttempts) { if (hold) await releaseHeld(tx, recipient, ledgerSource); if (await enqueueFallback(tx, job, campaign, recipient, "DELIVERY_FAILED")) return; await finish(tx, job, campaign, recipient, "failed", "DELIVERY_FAILED"); return; }
        await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "queued", reason: "DELIVERY_FAILED" } });
        await tx.job.update({ where: { id: job.id }, data: { status: "retry", dueAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)), leaseOwner: null, leaseUntil: null, lastError: "DELIVERY_FAILED" } });
        await deliveryAudit(tx, job, recipient, "queued"); return;
      }
      if (hold) await captureMessage(tx, recipient, hold.id, unitCost, ledgerSource);
      await finish(tx, job, campaign, recipient, "local_delivered", null, new Date()); return;
    }
    if (payload.transport === "sms-local" || payload.transport === "sms-solapi") {
      const solapi = payload.transport === "sms-solapi";
      let hold: { id: string } | null = null;
      if (unitCost > 0) {
        // 계정 행을 잠근 뒤 잔액을 확인한다 — 부족하면 같은 트랜잭션에서 실패 처리할 수 있게 INSERT 예외 전에 차단.
        const acct = await tx.$queryRaw<{ available: bigint }[]>`SELECT available FROM "CreditAccount" WHERE "tenantId"=${recipient.tenantId} AND currency='KRW' FOR UPDATE`;
        const existing = await tx.ledgerTransaction.findUnique({ where: { tenantId_kind_sourceKind_sourceId: { tenantId: recipient.tenantId, kind: "reserve", sourceKind: "campaign_delivery", sourceId: ledgerSource } } });
        if (!existing && (acct.length === 0 || acct[0].available < BigInt(unitCost))) { await finish(tx, job, campaign, recipient, "failed", "INSUFFICIENT_CREDIT"); return; }
        hold = await reserveMessage(tx, recipient, unitCost, ledgerSource);
      }
      const fresh = await readyBeforeIo(tx, job, workerId, payload, campaign, recipient, !!hold, ledgerSource);
      if (!fresh) return;
      try {
        const sent = await deliverSms({ transport: solapi ? "solapi" : "local", jobId: job.id, to: fresh.evaluated.contact!.contact,
          from: decrypt<string>(fresh.sender!.addressCipher!), text: fresh.evaluated.content!.text });
        if (solapi) await tx.smsReceipt.create({ data: { tenantId: recipient.tenantId, deliveryId: recipient.id, attempt: payload.attempt, receiptId: sent.receiptId, status: "provider_accepted" } });
      }
      catch (error) {
        if (error instanceof HttpError && error.status === 422) { if (hold) await releaseHeld(tx, recipient, ledgerSource); await finish(tx, job, campaign, recipient, "failed", error.code); return; }
        // 공급자 요청 후 오류는 접수 여부를 모른다. 재전송하지 않고 webhook 대사까지 예약을 유지한다.
        if (solapi) { await finish(tx, job, campaign, recipient, "unknown", "DELIVERY_UNCERTAIN"); return; }
        if (job.attempts >= job.maxAttempts) { if (hold) await releaseHeld(tx, recipient, ledgerSource); await finish(tx, job, campaign, recipient, "failed", "DELIVERY_FAILED"); return; }
        await tx.campaignDelivery.update({ where: { id: recipient.id }, data: { status: "queued", reason: "DELIVERY_FAILED" } });
        await tx.job.update({ where: { id: job.id }, data: { status: "retry", dueAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)), leaseOwner: null, leaseUntil: null, lastError: "DELIVERY_FAILED" } });
        await deliveryAudit(tx, job, recipient, "queued"); return;
      }
      if (hold) await captureMessage(tx, recipient, hold.id, unitCost, ledgerSource);
      await finish(tx, job, campaign, recipient, solapi ? "accepted" : "local_delivered", null, new Date()); return;
    }
    let attachments: MailAttachment[];
    try { attachments = (await readCampaignAttachments(tx, campaign)).attachments; } catch { await finish(tx, job, campaign, recipient, "failed", "ATTACHMENT_UNAVAILABLE"); return; }
    const fresh = await readyBeforeIo(tx, job, workerId, payload, campaign, recipient, false, ledgerSource);
    if (!fresh) return;
    let status: "local_delivered" | "accepted";
    try {
      status = await deliverMail(job, withEmailPolicy(job.id, { to: fresh.evaluated.contact!.contact, subject: fresh.evaluated.content!.subject,
        attachments, text: fresh.evaluated.content!.text, ...(fresh.evaluated.content!.format === "html" ? { html: fresh.evaluated.content!.html } : {}) }),
        { name: fresh.sender!.label, address: decrypt<string>(fresh.sender!.addressCipher!) });
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
      for (const dir of [env.LOCAL_MAIL_DIR, env.LOCAL_SMS_DIR, env.LOCAL_KAKAO_DIR])
        try { await unlink(resolve(dir, job.id + ".json")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
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
    const parsed = (() => { try { return jobPayload.parse(decrypt(current.payloadCipher)); } catch { return null; } })();
    const transport = parsed?.transport ?? null;
    const unitCost = parsed && isMessage(parsed.transport) ? (parsed.unitCost ?? (isKakao(parsed.transport) ? env.KAKAO_UNIT_COST_KRW : env.MESSAGE_UNIT_COST_KRW)) : 0;
    const ledgerSource = await campaignLedgerSource(tx, row.tenantId, row.id, row.attempt, campaign.channel, transport);
    const smsRow = transport === "sms-solapi" ? await tx.smsReceipt.findUnique({ where: { deliveryId_attempt: { deliveryId: row.id, attempt: row.attempt } } }) : null;
    const receipt = transport === "sms-local" ? await smsReceiptFile(job.id) : transport === "sms-solapi" ? smsRow?.createdAt ?? null : transport === "kakao-local" ? await kakaoReceipt(job.id) : transport ? await localReceipt(job.id) : null;
    const status = smsRow && smsRow.status !== "provider_accepted" ? smsRow.status === "failed" ? "failed" : "unknown"
      : receipt && row.status === "sending" ? transport === "sms-solapi" ? "accepted" : "local_delivered"
      : row.status === "sending" ? "unknown" : job.status === "cancelled" ? "cancelled" : "failed";
    // 복구 정산: 공급자가 접수를 확인한 건만 청구하고, 거부·미확인·미전송은 홀드를 풀어 잔액이 새지 않게 한다.
    // solapi 영수증 부재는 webhook이 뒤늦게 올 수 있으므로 보류를 유지한다.
    if (unitCost > 0) {
      if (status === "accepted" || status === "local_delivered") await settleRecovered(tx, row, unitCost, ledgerSource);
      else if (!(transport === "sms-solapi" && status === "unknown")) await releaseHeld(tx, row, ledgerSource);
    }
    await finish(tx, job, campaign, row, status, receipt ? null : status === "unknown" ? "DELIVERY_UNCERTAIN" : "DELIVERY_FAILED", receipt ?? undefined);
  });
  const candidates = await db.campaign.findMany({ where: { status: { in: ["scheduled", "dispatching"] }, recipients: { none: { status: { in: ["queued", "sending"] } } } }, take: 100, select: { id: true } });
  for (const row of candidates) await db.$transaction(async tx => { await settleCampaign(tx, await lockCampaign(tx, row.id)); });
  return { expired: expired.length, repaired: broken.length };
}
