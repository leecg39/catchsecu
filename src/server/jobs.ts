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
import { requireVerifiedSender } from "./sender-access";
import { HttpError } from "./http";
import { CAMPAIGN_MAIL_JOB_TYPES } from "@/contracts/campaigns";

const mailSchema = z.object({ to: z.email(), subject: z.string().max(200), text: z.string().max(100000) }).strict();
type Mail = z.infer<typeof mailSchema>;
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
  const result = await withMarketingDelivery({ ...scope, channel: "email", contact: parsed.to }, async (tx, row) => {
    if (sender) await requireVerifiedSender(tx, { ...scope, ...sender, channel: "email" });
    const dedupeKey = "mail:marketing:" + scope.tenantId + ":" + scope.serviceId + ":" + key;
    const job = await tx.job.upsert({ where: { dedupeKey }, update: {}, create: { dedupeKey, dueAt, tenantId: scope.tenantId, type: sender ? SENDER_MAIL_JOB_TYPE : "mail", senderId: sender?.id, marketingPreferenceId: row.id, marketingSubmissionId: row.sourceSubmissionId,
      payloadCipher: encrypt({ ...parsed, ...(sender ? { sender } : {}), marketing: { tenantId: scope.tenantId, serviceId: scope.serviceId, id: row.id, version: row.version } }) } });
    return { id: job.id, suppressed: false };
  });
  return result ?? { id: null, suppressed: true };
}
export type ClaimedJob = { campaignDeliveryId: string | null; senderId: string | null; dedupeKey: string; tenantId: string | null; id: string; type: string; payloadCipher: string; attempts: number; maxAttempts: number };
export async function claimJob(workerId: string): Promise<ClaimedJob | undefined> {
  const rows = await db.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET status = 'leased', "leaseOwner" = ${workerId},
      "leaseUntil" = now() + interval '60 seconds', attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE ((status IN ('queued', 'retry') AND "dueAt" <= now())
        OR (status = 'leased' AND "leaseUntil" < now()))
        AND attempts < "maxAttempts"
      ORDER BY "dueAt", id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id, type, "payloadCipher", attempts, "maxAttempts", "tenantId", "dedupeKey", "senderId", "campaignDeliveryId"`;
  return rows[0];
}
async function sendMail(job: ClaimedJob) {
  const parsed = scopedMailSchema.parse(decrypt(job.payloadCipher)), { deliveryScope, marketing, sender, ...mail } = parsed;
  if ((sender || job.dedupeKey.startsWith("mail:sender-verification:")) && job.type !== SENDER_MAIL_JOB_TYPE) throw new Error("SENDER_PROTOCOL_REQUIRED");
  if ((job.senderId ?? undefined) !== sender?.id || (sender && !marketing)) throw new Error("INVALID_SENDER_SCOPE");
  if (marketing) {
    if (job.tenantId !== marketing.tenantId || deliveryScope) throw new Error("INVALID_MARKETING_SCOPE");
    return !!await withMarketingDelivery({ tenantId: marketing.tenantId, serviceId: marketing.serviceId, channel: "email", contact: mail.to }, async tx => {
      let from: { name: string; address: string } | undefined;
      if (sender) try { const verified = await requireVerifiedSender(tx, { tenantId: marketing.tenantId, serviceId: marketing.serviceId, ...sender, channel: "email" }); from = { name: verified.row.label, address: verified.address }; }
      catch (e) { if (e instanceof HttpError && e.code === "SENDER_UNAVAILABLE") return false; throw e; }
      await deliverMail(job, mail, from); return true;
    }, marketing);
  }
  if (!deliveryScope) {
    if (job.dedupeKey.startsWith("mail:sender-verification:")) return db.$transaction(async tx => {
      const id = job.dedupeKey.slice("mail:sender-verification:".length), initial = await tx.senderVerification.findUnique({ where: { id } });
      if (!initial) return false;
      await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${initial.senderId} FOR SHARE`;
      const proof = await tx.senderVerification.findUnique({ where: { id }, include: { sender: { include: { service: { include: { tenant: true } } } } } });
      if (!proof || proof.status !== "pending" || proof.expiresAt <= new Date() || proof.sender.status !== "pending" || proof.generation !== proof.sender.generation || proof.sender.service.status !== "active" || proof.sender.service.tenant.status !== "active") return false;
      await deliverMail(job, mail); return true;
    }, { timeout: 45000 });
    if (job.dedupeKey.startsWith("mail:subject-access:")) return db.$transaction(async tx => {
      const id = job.dedupeKey.slice("mail:subject-access:".length);
      await tx.$queryRaw`SELECT id FROM "SubjectAccessRequest" WHERE id=${id} FOR SHARE`;
      const request = await tx.subjectAccessRequest.findUnique({ where: { id } });
      if (!request || request.expiresAt <= new Date()) return false;
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
export async function deliverMail(job: Pick<ClaimedJob, "id">, mail: Mail & { html?: string; attachments?: MailAttachment[]; headers?: { "List-Unsubscribe": string; "List-Unsubscribe-Post"?: string } }, sender?: { name: string; address: string }) {
  if (env.MAIL_TRANSPORT === "local") {
    const dir = resolve(env.LOCAL_MAIL_DIR);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Publish only a fully written file. An interrupted temporary write cannot look delivered.
    const temp = resolve(dir, job.id + "." + randomUUID() + ".tmp");
    try {
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ id: job.id, ...mail, ...(mail.attachments ? { attachments: mail.attachments.map(a => ({ filename: a.filename, mime: a.contentType, size: a.content.length, sha256: createHash("sha256").update(a.content).digest("hex"), contentBase64: a.content.toString("base64") })) } : {}), from: sender ?? env.MAIL_FROM, deliveredAt: new Date().toISOString() }, null, 2)); await file.sync(); }
      finally { await file.close(); }
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
  const response = await transport.sendMail({ ...mail, ...(mail.attachments ? { attachments: mail.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content, contentDisposition: "attachment" as const })) } : {}), disableFileAccess: true, disableUrlAccess: true, from: sender ?? env.MAIL_FROM, messageId: "<" + job.id + "@catchsecu.local>" });
  if (!response.accepted.some(address => address.toLowerCase() === mail.to.toLowerCase())) throw new Error("RECIPIENT_NOT_ACCEPTED");
  return "accepted" as const;
}
export async function runOneJob(workerId: string): Promise<boolean> {
  // A worker dying on its last attempt must not leave a permanent leased row.
  await db.$executeRaw`UPDATE "Job" SET status='dead', "leaseOwner"=NULL, "leaseUntil"=NULL, "lastError"='LEASE_EXHAUSTED'
    WHERE status='leased' AND "leaseUntil" < now() AND attempts >= "maxAttempts"`;
  const job = await claimJob(workerId);
  if (!job) return false;
  try {
    if (CAMPAIGN_MAIL_JOB_TYPES.includes(job.type)) {
      await (await import("./campaign-worker")).runCampaignJob(job, workerId); return true;
    }
    if (job.type !== "mail" && job.type !== SENDER_MAIL_JOB_TYPE) throw new Error("UNSUPPORTED_JOB_TYPE");
    const delivered = await sendMail(job);
    await db.job.updateMany({ where: { id: job.id, status: "leased", leaseOwner: workerId },
      data: { status: delivered ? "done" : "cancelled", completedAt: new Date(), leaseOwner: null, leaseUntil: null, lastError: delivered ? null : "SUPPRESSED" } });
  } catch {
    // Provider errors may contain recipient addresses and credentials. Persist a safe code.
    await db.job.updateMany({ where: { id: job.id, status: "leased", leaseOwner: workerId },
      data: { status: job.attempts >= job.maxAttempts ? "dead" : "retry",
        dueAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)),
        leaseOwner: null, leaseUntil: null, lastError: "DELIVERY_FAILED" } });
  }
  return true;
}
