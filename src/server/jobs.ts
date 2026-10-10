import { withMarketingDelivery } from "./marketing";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, link, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import nodemailer from "nodemailer";
import { z } from "zod";
import { db, type Transaction } from "./db";
import { decrypt, encrypt } from "./crypto";
import { env } from "./env";
import { contactEmailHash, isSuppressed, lockDelivery, type DeliveryScope } from "./suppression";
import { lockSubjectScopes, retainedSubjectSubmission } from "./subject-scope";
import { requireVerifiedSender, senderDenial } from "./sender-access";
import { senderEnvironment } from "./sender-providers";
import { HttpError } from "./http";
import { CAMPAIGN_MAIL_JOB_TYPES } from "@/contracts/campaigns";
import { roleCan, roleCapabilities } from "./permissions";
import { audit, type MailOutcomeMetadata } from "./audit";

const mailSchema = z.object({ to: z.email(), subject: z.string().max(200), text: z.string().max(100000) }).strict();
export type Mail = z.infer<typeof mailSchema>;
// A legacy worker must reject sender-bound jobs before parsing away their policy fields.
export const SENDER_MAIL_JOB_TYPE = "mail.sender.v1";
export async function enqueueMail(mail: Mail, key: string = randomUUID(), tx: Transaction = db, tenantId?: string) {
  return tx.job.upsert({
    where: { dedupeKey: "mail:" + key },
    update: {},
    create: { type: key.startsWith("sender-verification:") ? SENDER_MAIL_JOB_TYPE : "mail", dedupeKey: "mail:" + key, payloadCipher: encrypt(mailSchema.parse(mail)), tenantId },
  });
}
const scopedMailSchema = mailSchema.extend({ sender: z.object({ id: z.uuid(), version: z.number().int().positive() }).strict().optional(), marketing: z.object({ id: z.uuid(), version: z.number().int().positive(), serviceId: z.uuid(), tenantId: z.uuid() }).strict().optional(), deliveryScope: z.object({ tenantId: z.uuid(), serviceId: z.uuid(), emailHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() });
async function activeService(tx: Transaction, scope: DeliveryScope) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${scope.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${scope.serviceId} AND "tenantId"=${scope.tenantId} FOR SHARE`;
  return !!await tx.service.count({ where: { id: scope.serviceId, tenantId: scope.tenantId, status: "active", tenant: { status: "active" } } });
}
/** Business delivery only. Authentication mails use enqueueMail and do not depend on marketing consent. */
export async function enqueueServiceMail(mail: Mail, scope: { tenantId: string; serviceId: string }, key: string = randomUUID()) {
  const parsed = mailSchema.parse(mail), deliveryScope = { tenantId: scope.tenantId, serviceId: scope.serviceId, emailHash: contactEmailHash(parsed.to) };
  return db.$transaction(async tx => {
    if (!await activeService(tx, deliveryScope)) throw new Error("SERVICE_UNAVAILABLE");
    await lockDelivery(tx, deliveryScope);
    if (await isSuppressed(tx, deliveryScope)) return { id: null, suppressed: true };
    const job = await tx.job.upsert({ where: { dedupeKey: "mail:service:" + scope.tenantId + ":" + scope.serviceId + ":" + key }, update: {},
      create: { type: "mail", tenantId: scope.tenantId, dedupeKey: "mail:service:" + scope.tenantId + ":" + scope.serviceId + ":" + key, payloadCipher: encrypt({ ...parsed, deliveryScope }) } });
    return { id: job.id, suppressed: false };
  });
}
export async function enqueueMarketingMail(mail: Mail, scope: { tenantId: string; serviceId: string }, key: string = randomUUID(), dueAt = new Date(), sender?: { id: string; version: number }) {
  z.date().parse(dueAt);
  const parsed = mailSchema.parse(mail);
  const result = await withMarketingDelivery({ ...scope, channel: "email", contact: parsed.to }, async (tx, row, assertCurrent) => {
    const verifiedSender = sender ? await requireVerifiedSender(tx, { ...scope, ...sender, channel: "email" }) : undefined;
    const dedupeKey = "mail:marketing:" + scope.tenantId + ":" + scope.serviceId + ":" + key;
    const job = await tx.job.upsert({ where: { dedupeKey }, update: {}, create: { dedupeKey, dueAt, tenantId: scope.tenantId, type: sender ? SENDER_MAIL_JOB_TYPE : "mail", senderId: sender?.id, marketingPreferenceId: row.id, marketingSubmissionId: row.sourceSubmissionId,
      payloadCipher: encrypt({ ...parsed, ...(sender ? { sender } : {}), marketing: { tenantId: scope.tenantId, serviceId: scope.serviceId, id: row.id, version: row.version } }) } });
    await assertCurrent();
    if (verifiedSender && senderDenial(verifiedSender.row)) throw new Error("SENDER_UNAVAILABLE");
    return { id: job.id, suppressed: false };
  });
  return result ?? { id: null, suppressed: true };
}
export type ClaimedJob = { campaignDeliveryId: string | null; senderId: string | null; dedupeKey: string; tenantId: string | null; id: string; type: string; payloadCipher: string; attempts: number; maxAttempts: number };
export type JobScope = { tenantId: string | null; jobId: string };
export async function claimJob(workerId: string, scope?: JobScope): Promise<(ClaimedJob & { attemptId: string }) | undefined> {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" SET status = 'leased', "leaseOwner" = ${workerId},
        "leaseUntil" = now() + interval '60 seconds', attempts = attempts + 1, "updatedAt" = now()
      WHERE id = (
        SELECT id FROM "Job"
        WHERE ((status IN ('queued', 'retry') AND "dueAt" <= now())
          OR (status = 'leased' AND "leaseUntil" < now()))
          AND attempts < "maxAttempts"
          AND (${scope === undefined} OR ("tenantId" IS NOT DISTINCT FROM ${scope?.tenantId ?? null} AND id=${scope?.jobId ?? null}))
        ORDER BY "dueAt", id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING id, type, "payloadCipher", attempts, "maxAttempts", "tenantId", "dedupeKey", "senderId", "campaignDeliveryId"`;
    const job = rows[0];
    if (!job) return;
    const attemptId = randomUUID();
    await tx.$executeRaw`UPDATE "JobAttempt" SET outcome = 'expired', "finishedAt" = now() WHERE "jobId" = ${job.id} AND outcome = 'leased'`;
    await tx.$executeRaw`INSERT INTO "JobAttempt" (id, "jobId", "workerId", attempt, outcome, "createdAt") VALUES (${attemptId}, ${job.id}, ${workerId}, ${job.attempts}, 'leased', now())`;
    return { ...job, attemptId };
  });
}
async function finishAttempt(attemptId: string, outcome: string, errorCode?: string, tx: Transaction = db) {
  await tx.$executeRaw`UPDATE "JobAttempt" SET outcome = ${outcome}, "errorCode" = ${errorCode ?? null}, "finishedAt" = now() WHERE id = ${attemptId} AND outcome = 'leased'`;
}
type AuditJob = Pick<ClaimedJob, "id" | "tenantId" | "payloadCipher" | "type" | "attempts">;
async function mailOutcomeAudit(tx: Transaction, job: AuditJob, requestId: string, action: string, status: MailOutcomeMetadata["status"], errorCode?: MailOutcomeMetadata["errorCode"]) {
  let serviceId: string | undefined;
  try {
    const payload = decrypt<{ deliveryScope?: { tenantId: string; serviceId: string }; marketing?: { tenantId: string; serviceId: string } }>(job.payloadCipher);
    const scope = payload.deliveryScope ?? payload.marketing;
    if (scope?.tenantId === job.tenantId && z.uuid().safeParse(scope.serviceId).success
      && await tx.service.count({ where: { id: scope.serviceId, tenantId: job.tenantId! } })) serviceId = scope.serviceId;
  } catch { /* A failed encrypted payload still has a safe job-level outcome. */ }
  await audit(tx, { tenantId: job.tenantId, user: { id: null } }, requestId, action, "job", job.id, ["status"], serviceId,
    { status, attempt: job.attempts, transport: env.MAIL_TRANSPORT, ...(errorCode ? { errorCode } : {}) });
}
async function finishMailJob(job: ClaimedJob & { attemptId: string }, workerId: string, delivered: boolean | undefined) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.job.findFirst({ where: { id: job.id, status: "leased", leaseOwner: workerId,
      attempts: job.attempts, payloadErasedAt: null, leaseUntil: { gt: new Date() } } });
    if (!current?.leaseUntil) return false;
    const status = delivered === undefined ? (job.attempts >= job.maxAttempts ? "dead" : "retry") : delivered ? "done" : "cancelled";
    const errorCode = delivered === undefined ? "DELIVERY_FAILED" : delivered ? undefined : "SUPPRESSED";
    await tx.job.update({ where: { id: job.id }, data: { status,
      ...(delivered === undefined ? { dueAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)) } : { completedAt: new Date() }),
      leaseOwner: null, leaseUntil: null, lastError: errorCode ?? null } });
    await finishAttempt(job.attemptId, delivered === undefined ? status : delivered ? "delivered" : "suppressed", errorCode, tx);
    await mailOutcomeAudit(tx, job, job.attemptId, delivered === undefined ? "email.failed" : delivered
      ? env.MAIL_TRANSPORT === "local" ? "email.local_delivered" : "email.accepted" : "email.suppressed", status, errorCode);
    if (current.leaseUntil <= new Date()) throw new Error("LEASE_EXPIRED");
    return true;
  });
}
async function retryMailReceipt(job: ClaimedJob & { attemptId: string }, workerId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.job.findFirst({ where: { id: job.id, status: "leased", leaseOwner: workerId,
      attempts: job.attempts, leaseUntil: { gt: new Date() }, payloadErasedAt: null } });
    if (!current?.leaseUntil) return false;
    const status = job.attempts >= job.maxAttempts ? "dead" : "retry";
    const changed = await tx.job.updateMany({ where: { id: job.id, status: "leased", leaseOwner: workerId,
      attempts: job.attempts, leaseUntil: { gt: new Date() }, payloadErasedAt: null }, data: { status,
      dueAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)), leaseOwner: null, leaseUntil: null, lastError: "RECEIPT_PERSISTENCE_FAILED" } });
    if (!changed.count) return false;
    await finishAttempt(job.attemptId, status, "RECEIPT_PERSISTENCE_FAILED", tx);
    await mailOutcomeAudit(tx, job, job.attemptId, status === "retry" ? "email.receipt_retry" : "email.receipt_failed", status, "RECEIPT_PERSISTENCE_FAILED");
    if (current.leaseUntil <= new Date()) throw new Error("LEASE_EXPIRED");
    return true;
  });
}
async function sendMail(job: ClaimedJob, workerId: string) {
  const parsed = scopedMailSchema.parse(decrypt(job.payloadCipher)), { deliveryScope, marketing, sender, ...mail } = parsed;
  if ((sender || job.dedupeKey.startsWith("mail:sender-verification:")) && job.type !== SENDER_MAIL_JOB_TYPE) throw new Error("SENDER_PROTOCOL_REQUIRED");
  if ((job.senderId ?? undefined) !== sender?.id || (sender && !marketing)) throw new Error("INVALID_SENDER_SCOPE");
  if (marketing) {
    if (job.tenantId !== marketing.tenantId || deliveryScope) throw new Error("INVALID_MARKETING_SCOPE");
    return !!await withMarketingDelivery({ tenantId: marketing.tenantId, serviceId: marketing.serviceId, channel: "email", contact: mail.to }, async (tx, _row, assertCurrent) => {
      let from: { name: string; address: string } | undefined;
      let verifiedSender: Awaited<ReturnType<typeof requireVerifiedSender>> | undefined;
      if (sender) try { verifiedSender = await requireVerifiedSender(tx, { tenantId: marketing.tenantId, serviceId: marketing.serviceId, ...sender, channel: "email" }); from = { name: verifiedSender.row.label, address: verifiedSender.address }; }
      catch (e) { if (e instanceof HttpError && e.code === "SENDER_UNAVAILABLE") return false; throw e; }
      await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.job.findFirst({ where: { id: job.id, tenantId: marketing.tenantId, status: "leased", leaseOwner: workerId, attempts: job.attempts, payloadErasedAt: null } });
      if (!current?.leaseUntil || current.leaseUntil <= new Date()) return false;
      const beforeDispatch = async () => {
        await assertCurrent();
        if (verifiedSender && senderDenial(verifiedSender.row)) throw new Error("SENDER_UNAVAILABLE");
        if (current.leaseUntil! <= new Date()) throw new Error("LEASE_EXPIRED");
      };
      await deliverMail(job, mail, from, beforeDispatch); return true;
    }, marketing);
  }
  if (!deliveryScope) {
    if (job.dedupeKey.startsWith("mail:org-email:"))
      return (await import("./org-email-mail")).deliverOrgEmailMail(job, workerId, mail);
    if (job.dedupeKey.startsWith("mail:sso-policy:"))
      return (await import("./sso-policy-mail")).deliverSsoPolicyMail(job, workerId, mail);
    if (job.dedupeKey.startsWith("mail:invitation:")) {
      const [, , id, rawVersion, ...rest] = job.dedupeKey.split(":");
      const version = Number(rawVersion);
      if (rest.length || !z.uuid().safeParse(id).success || !Number.isSafeInteger(version) || version < 1) return false;
      const initial = await db.invitation.findUnique({ where: { id }, select: { tenantId: true } });
      if (!initial || job.tenantId !== initial.tenantId) return false;
      return db.$transaction(async tx => {
        // The same company lock serializes delivery with resend, revoke and acceptance.
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${initial.tenantId} FOR SHARE`;
        const row = await tx.invitation.findUnique({ where: { id }, include: { tenant: { select: { status: true } } } });
        if (!row || row.status !== "pending" || row.version !== version || row.expiresAt <= new Date() ||
          row.tenant.status !== "active" || row.email !== mail.to || row.role === "owner") return false;
        const inviter = await tx.membership.findFirst({ where: { id: row.invitedBy, tenantId: row.tenantId, status: "active",
          user: { status: "active", emailVerified: true } } });
        if (!inviter || !roleCan(inviter.role, "member.manage") || (inviter.role !== "owner" &&
          !roleCapabilities(row.role).every(capability => roleCan(inviter.role, capability)))) return false;
        if (!row.serviceIds.length || await tx.service.count({ where: { tenantId: row.tenantId, id: { in: row.serviceIds }, status: "active" } }) !== row.serviceIds.length) return false;
        await deliverMail(job, mail); return true;
      }, { timeout: 45000 });
    }
    if (job.dedupeKey.startsWith("mail:sender-verification:")) return db.$transaction(async tx => {
      const id = job.dedupeKey.slice("mail:sender-verification:".length), initial = await tx.senderVerification.findUnique({ where: { id }, include: { sender: true } });
      if (!initial || initial.tenantId !== job.tenantId || initial.method !== "email") return false;
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${initial.tenantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${initial.sender.serviceId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${initial.senderId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "SenderVerification" WHERE id=${id} FOR SHARE`;
      const proof = await tx.senderVerification.findUnique({ where: { id }, include: { sender: { include: { service: { include: { tenant: true } } } } } });
      if (!proof || proof.status !== "pending" || !proof.tokenHash || proof.expiresAt <= new Date() || proof.sender.status !== "pending" || proof.generation !== proof.sender.generation || proof.sender.service.status !== "active" || proof.sender.service.tenant.status !== "active" || proof.environment !== senderEnvironment() || !proof.sender.addressCipher || decrypt<string>(proof.sender.addressCipher) !== mail.to) return false;
      await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.job.findFirst({ where: { id: job.id, tenantId: proof.tenantId, status: "leased", leaseOwner: workerId, attempts: job.attempts, payloadErasedAt: null } });
      if (!current?.leaseUntil || current.leaseUntil <= new Date()) return false;
      const beforeDispatch = async () => {
        if (proof.expiresAt <= new Date()) throw new Error("VERIFICATION_EXPIRED");
        if (current.leaseUntil! <= new Date()) throw new Error("LEASE_EXPIRED");
        if (proof.environment !== senderEnvironment()) throw new Error("VERIFICATION_ENVIRONMENT");
      };
      await deliverMail(job, mail, undefined, beforeDispatch); return true;
    }, { timeout: 45000 });
    if (job.dedupeKey.startsWith("mail:subject-access:")) return db.$transaction(async tx => {
      const id = job.dedupeKey.slice("mail:subject-access:".length);
      await tx.$queryRaw`SELECT id FROM "SubjectAccessRequest" WHERE id=${id} FOR SHARE`;
      const request = await tx.subjectAccessRequest.findUnique({ where: { id } });
      if (!request || request.consumedAt || request.expiresAt <= new Date()) return false;
      await lockSubjectScopes(tx, id);
      const eligible = await tx.subjectAccessScope.count({ where: { requestId: id, subject: { submissions: { some: retainedSubjectSubmission() } } } });
      if (request.expiresAt <= new Date() || !eligible) return false;
      await deliverMail(job, mail); return true;
    }, { timeout: 45000 });
    await deliverMail(job, mail); return true;
  }
  if (job.tenantId !== deliveryScope.tenantId || contactEmailHash(mail.to) !== deliveryScope.emailHash) throw new Error("INVALID_DELIVERY_SCOPE");
  return db.$transaction(async tx => {
    if (!await activeService(tx, deliveryScope)) return false;
    // Serialize with withdrawal through delivery completion. A withdrawal committed first always blocks this send.
    await lockDelivery(tx, deliveryScope);
    if (await isSuppressed(tx, deliveryScope)) return false;
    await deliverMail(job, mail); return true;
  }, { timeout: 45000 });
}
export type MailAttachment = { filename: string; contentType: string; content: Buffer };
export async function deliverMail(job: Pick<ClaimedJob, "id">, mail: Mail & { html?: string; attachments?: MailAttachment[]; headers?: { "List-Unsubscribe": string; "List-Unsubscribe-Post"?: string } }, sender?: { name: string; address: string }, beforeDispatch?: () => Promise<void>) {
  if (env.MAIL_TRANSPORT === "local") {
    const dir = resolve(env.LOCAL_MAIL_DIR);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Publish only a fully written file. An interrupted temporary write cannot look delivered.
    const temp = resolve(dir, job.id + "." + randomUUID() + ".tmp");
    try {
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ id: job.id, ...mail, ...(mail.attachments ? { attachments: mail.attachments.map(a => ({ filename: a.filename, mime: a.contentType, size: a.content.length, sha256: createHash("sha256").update(a.content).digest("hex"), contentBase64: a.content.toString("base64") })) } : {}), from: sender ?? env.MAIL_FROM, deliveredAt: new Date().toISOString() }, null, 2)); await file.sync(); }
      finally { await file.close(); }
      await beforeDispatch?.();
      await link(temp, resolve(dir, job.id + ".json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally { await unlink(temp).catch(() => {}); }
    return "local_delivered" as const;
  }
  if (!env.SMTP_HOST) throw new Error("SMTP_NOT_CONFIGURED");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    requireTLS: env.SMTP_SECURE !== "true", connectionTimeout: 10000, socketTimeout: 20000,
  });
  await beforeDispatch?.();
  const response = await transport.sendMail({ ...mail, ...(mail.attachments ? { attachments: mail.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content, contentDisposition: "attachment" as const })) } : {}), disableFileAccess: true, disableUrlAccess: true, from: sender ?? env.MAIL_FROM, messageId: "<" + job.id + "@catchsecu.local>" });
  if (!response.accepted.some(address => address.toLowerCase() === mail.to.toLowerCase())) throw new Error("RECIPIENT_NOT_ACCEPTED");
  return "accepted" as const;
}
export async function runOneJob(workerId: string, scope?: JobScope): Promise<boolean> {
  // A worker dying on its last attempt must not leave a permanent leased row.
  await db.$transaction(async tx => {
    const exhausted = await tx.$queryRaw<AuditJob[]>`SELECT id,"tenantId","payloadCipher",type,attempts FROM "Job"
      WHERE status='leased' AND "leaseUntil" < now() AND attempts >= "maxAttempts"
      AND (${scope === undefined} OR ("tenantId" IS NOT DISTINCT FROM ${scope?.tenantId ?? null} AND id=${scope?.jobId ?? null})) FOR UPDATE`;
    for (const job of exhausted) {
      const attempt = await tx.jobAttempt.findFirst({ where: { jobId: job.id, outcome: "leased" }, orderBy: { createdAt: "desc" } });
      await tx.$executeRaw`UPDATE "JobAttempt" SET outcome='lease_exhausted',"errorCode"='LEASE_EXHAUSTED',"finishedAt"=now()
        WHERE "jobId"=${job.id} AND outcome='leased'`;
      await tx.job.update({ where: { id: job.id }, data: { status: "dead", leaseOwner: null, leaseUntil: null, lastError: "LEASE_EXHAUSTED" } });
      await mailOutcomeAudit(tx, job, attempt?.id ?? randomUUID(), job.type.startsWith("mail") ? "email.lease_exhausted" : "job.lease_exhausted", "dead", "LEASE_EXHAUSTED");
    }
  });
  const job = await claimJob(workerId, scope);
  if (!job) return false;
  let dispatched = false;
  try {
    if (CAMPAIGN_MAIL_JOB_TYPES.includes(job.type)) {
      await (await import("./campaign-worker")).runCampaignJob(job, workerId);
      const current = await db.job.findUnique({ where: { id: job.id }, select: { status: true, lastError: true } });
      const outcome = current?.status === "done" ? "delivered" : current?.status === "dead" ? "dead" : current?.status === "cancelled" ? "suppressed" : "retry";
      await finishAttempt(job.attemptId, outcome, current?.lastError ?? undefined);
      return true;
    }
    if (job.type !== "mail" && job.type !== SENDER_MAIL_JOB_TYPE && job.type !== "mail.activity-review.v1") throw new Error("UNSUPPORTED_JOB_TYPE");
    const delivered = job.type === "mail.activity-review.v1" ? await (await import("./activity-review-mail")).deliverReviewMail(job, workerId) : await sendMail(job, workerId);
    dispatched = delivered;
    await finishMailJob(job, workerId, delivered);
  } catch {
    // Provider errors may contain recipient addresses and credentials. Persist a safe code.
    if (dispatched) await retryMailReceipt(job, workerId);
    else await finishMailJob(job, workerId, undefined);
  }
  return true;
}
