import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma, type CampaignDelivery } from "@/generated/prisma/client";
import { relayFeedback, suppressionQuery, type FeedbackKind, type FeedbackSummary, type SuppressionRecord, type UnsubscribeInfo } from "@/contracts/email-feedback";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { decrypt, tokenHash } from "./crypto";
import { env } from "./env";
import { fail, rateLimit } from "./http";
import { lockDelivery, contactEmailHash } from "./suppression";
import { assertFileDeadlines, lockFileContext } from "./file-access";
import { audit } from "./audit";
import { unsubscribeJobId, UNSUBSCRIBE_LIFETIME_MS } from "./email-policy";

const jobInclude = { campaignDelivery: { include: { campaign: { include: { service: { include: { tenant: true } } } } } } } as const;
type EmailJob = Prisma.JobGetPayload<{ include: typeof jobInclude }>;
export async function limitedEmailBody(request: Request, limit = 16384) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) fail(413, "BODY_TOO_LARGE", "요청이 너무 큽니다.");
  const reader = request.body?.getReader(); if (!reader) fail(400, "BODY_REQUIRED", "요청 내용이 없습니다.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length;
    if (length > limit) { await reader.cancel(); fail(413, "BODY_TOO_LARGE", "요청이 너무 큽니다."); } chunks.push(item.value); }
  return Buffer.concat(chunks);
}
function validateJob(job: EmailJob | null) {
  const delivery = job?.campaignDelivery;
  if (!job || !delivery || delivery.campaign.channel !== "email" || job.tenantId !== delivery.tenantId
    || job.dedupeKey !== "campaign:" + delivery.id + ":" + delivery.attempt)
    fail(404, "EMAIL_JOB_NOT_FOUND", "이메일 전달 기록을 찾을 수 없습니다.");
  if (job.createdAt.getTime() + UNSUBSCRIBE_LIFETIME_MS <= Date.now()) fail(410, "EMAIL_LINK_EXPIRED", "이메일 링크의 사용 기간이 끝났습니다.");
  if (!((job.status === "done" && ["accepted", "local_delivered"].includes(delivery.status)) || (job.status === "dead" && delivery.status === "unknown")))
    fail(409, "EMAIL_NOT_SENT", "전달된 이메일의 결과만 접수할 수 있습니다.");
  return delivery;
}
/** Matches delivery's source → contact → delivery → job order; never takes a parent lock after the job. */
async function lockedJob(tx: Transaction, jobId: string) {
  const initial = await tx.job.findUnique({ where: { id: jobId }, include: jobInclude });
  if (!initial?.campaignDelivery) fail(404, "EMAIL_JOB_NOT_FOUND", "이메일 전달 기록을 찾을 수 없습니다.");
  const delivery = initial.campaignDelivery;
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${delivery.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${delivery.serviceId} AND "tenantId"=${delivery.tenantId} FOR SHARE`;
  if (delivery.sourceSubmissionId) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${delivery.sourceSubmissionId} FOR SHARE`;
  await lockDelivery(tx, { tenantId: delivery.tenantId, serviceId: delivery.serviceId, emailHash: delivery.contactHash });
  await tx.$queryRaw`SELECT id FROM "CampaignDelivery" WHERE id=${delivery.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${jobId} FOR UPDATE`;
  const current = await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
  return { job: current, delivery: validateJob(current) };
}
export async function softBounceJobs(tx: Transaction, scope: { tenantId: string; serviceId: string; contactHash: string }) {
  const result = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT count(DISTINCT f."jobId") FROM "EmailFeedback" f WHERE f."tenantId"=${scope.tenantId} AND f."serviceId"=${scope.serviceId}
     AND f."contactHash"=${scope.contactHash} AND f.kind='soft_bounce' AND f."occurredAt">=(clock_timestamp() AT TIME ZONE 'UTC')-interval '7 days'
     AND NOT EXISTS(SELECT 1 FROM "EmailFeedback" d WHERE d."jobId"=f."jobId" AND d.kind='delivered')`;
  return Number(result[0].count);
}
async function storeFeedback(tx: Transaction, delivery: CampaignDelivery, input: { jobId: string; eventKey: string; kind: FeedbackKind; source: "relay" | "recipient"; occurredAt: Date; bodyHash: string }, requestId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"email-event:" + input.eventKey},0))`;
  const existing = await tx.emailFeedback.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) {
    if (existing.bodyHash !== input.bodyHash || existing.jobId !== input.jobId) fail(409, "EMAIL_EVENT_CONFLICT", "같은 이벤트 ID에 다른 내용이 등록되어 있습니다.");
    return { accepted: true, duplicate: true };
  }
  if (await tx.emailFeedback.count({ where: { jobId: input.jobId, source: input.source } }) >= 100) fail(422, "EMAIL_EVENT_LIMIT", "이메일 결과 기록 한도를 초과했습니다.");
  const scope = { tenantId: delivery.tenantId, serviceId: delivery.serviceId, contactHash: delivery.contactHash };
  const event = await tx.emailFeedback.create({ data: { ...scope, ...input, deliveryId: delivery.id } });
  const suppress = input.kind !== "delivered" && (input.kind !== "soft_bounce" || await softBounceJobs(tx, scope) >= 3);
  if (suppress && !await tx.emailSuppression.count({ where: { ...scope, reason: input.kind } }))
    await tx.emailSuppression.create({ data: { ...scope, reason: input.kind, sourceEventId: event.id } });
  await tx.auditEvent.create({ data: { tenantId: delivery.tenantId, serviceId: delivery.serviceId, action: "email." + input.kind, resource: "email_feedback", resourceId: event.id, requestId,
    detail: { source: input.source, suppressed: suppress } } });
  return { accepted: true, duplicate: false };
}
export async function acceptEmailRelay(request: Request, requestId: string) {
  if (!env.EMAIL_FEEDBACK_SECRET) fail(503, "EMAIL_RELAY_NOT_CONFIGURED", "이메일 결과 릴레이가 설정되지 않았습니다.");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") fail(415, "CONTENT_TYPE", "JSON 형식으로 요청해주세요.");
  const timestamp = request.headers.get("x-email-timestamp") ?? "", signature = request.headers.get("x-email-signature") ?? "";
  if (!/^[0-9]{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^v1=[a-f0-9]{64}$/.test(signature))
    fail(401, "EMAIL_SIGNATURE_INVALID", "이메일 결과 서명을 확인할 수 없습니다.");
  const bytes = await limitedEmailBody(request), expected = createHmac("sha256", env.EMAIL_FEEDBACK_SECRET).update(timestamp + ".").update(bytes).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex"))) fail(401, "EMAIL_SIGNATURE_INVALID", "이메일 결과 서명을 확인할 수 없습니다.");
  await rateLimit("email:relay:authenticated", 600);
  let value: unknown; try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(400, "INVALID_JSON", "JSON 형식을 확인해주세요."); }
  const input = relayFeedback.parse(value), occurredAt = new Date(input.occurredAt);
  return db.$transaction(async tx => {
    const { job, delivery } = await lockedJob(tx, input.jobId);
    if (occurredAt.getTime() > Date.now() + 300000 || occurredAt.getTime() < job.createdAt.getTime() - 300000)
      fail(422, "EMAIL_EVENT_TIME", "이메일 결과 시각을 확인해주세요.");
    return storeFeedback(tx, delivery, { jobId: job.id, eventKey: "relay:" + input.eventId, kind: input.type, source: "relay", occurredAt,
      bodyHash: createHash("sha256").update(bytes).digest("hex") }, requestId);
  }, { timeout: 55000 });
}
export async function readUnsubscribe(token: string): Promise<UnsubscribeInfo> {
  const jobId = unsubscribeJobId(token); await rateLimit("email:unsubscribe:" + jobId, 60);
  const job = await db.job.findUnique({ where: { id: jobId }, include: jobInclude }), delivery = validateJob(job);
  return { company: delivery.campaign.service.tenant.name, service: delivery.campaign.service.externalName || delivery.campaign.service.name,
    unsubscribed: !!await db.emailSuppression.count({ where: { tenantId: delivery.tenantId, serviceId: delivery.serviceId, contactHash: delivery.contactHash, reason: "unsubscribed" } }) };
}
export async function confirmUnsubscribe(token: string, requestId: string) {
  const jobId = unsubscribeJobId(token); await rateLimit("email:unsubscribe:" + jobId, 60);
  return db.$transaction(async tx => {
    const { delivery } = await lockedJob(tx, jobId);
    await storeFeedback(tx, delivery, { jobId, eventKey: "recipient:" + jobId, kind: "unsubscribed", source: "recipient", occurredAt: new Date(), bodyHash: tokenHash("email-unsubscribed:" + jobId) }, requestId);
    return { unsubscribed: true };
  }, { timeout: 55000 });
}
const ranks: Record<FeedbackKind, number> = { soft_bounce: 1, delivered: 2, unsubscribed: 3, hard_bounce: 4, complaint: 5 };
export async function feedbackSummary(tx: Transaction, deliveryId: string): Promise<FeedbackSummary | null> {
  const events = await tx.emailFeedback.findMany({ where: { deliveryId }, select: { kind: true, occurredAt: true, source: true } });
  events.sort((a, b) => ranks[b.kind as FeedbackKind] - ranks[a.kind as FeedbackKind] || b.occurredAt.getTime() - a.occurredAt.getTime());
  const top = events[0]; return top ? { outcome: top.kind as FeedbackKind, source: top.source as "relay" | "recipient", occurredAt: top.occurredAt.toISOString(), count: events.length } : null;
}
export async function listEmailSuppressions(ctx: Context, input: z.infer<typeof suppressionQuery>, requestId: string) {
  return db.$transaction(async tx => {
    const deadlines = await lockFileContext(tx, ctx, input.serviceId, ["message.read", "marketing.read"], true);
    let hash: string | undefined;
    if (input.search) { try { hash = contactEmailHash(input.search); } catch { hash = "no-match"; } }
    const where = { tenantId: ctx.tenantId, serviceId: input.serviceId, ...(hash ? { contactHash: hash } : {}), ...(input.reason === "all" ? {} : { reason: input.reason }) };
    const total = await tx.emailSuppression.count({ where }), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const rows = await tx.emailSuppression.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * input.pageSize, take: input.pageSize });
    const initial = await tx.marketingPreference.findMany({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, channel: "email", contactHash: { in: rows.map(r => r.contactHash) } } });
    for (const id of [...new Set(initial.map(p => p.sourceSubmissionId))].sort()) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} FOR SHARE`;
    for (const contactHash of [...new Set(rows.map(r => r.contactHash))].sort()) await lockDelivery(tx, { tenantId: ctx.tenantId, serviceId: input.serviceId, emailHash: contactHash });
    const preferences = await tx.marketingPreference.findMany({ where: { OR: initial.map(p => ({ id: p.id, sourceSubmissionId: p.sourceSubmissionId })), status: { not: "erased" } }, include: { sourceSubmission: true } });
    await audit(tx, ctx, requestId, "email.suppressions_viewed", "email_suppression", undefined, [], input.serviceId);
    const items: SuppressionRecord[] = rows.map(r => { const p = preferences.find(p => p.contactHash === r.contactHash), available = p && ["submitted", "corrected", "withdrawn"].includes(p.sourceSubmission.status) && p.sourceSubmission.retentionUntil > new Date();
      const contact = available && p.contactCipher ? decrypt<{ name: string; contact: string }>(p.contactCipher) : null;
      return { id: r.id, contact: contact?.contact ?? null, name: contact?.name ?? null, reason: r.reason as SuppressionRecord["reason"], createdAt: r.createdAt.toISOString() }; });
    assertFileDeadlines(deadlines);
    return { items, total, page, pageSize: input.pageSize, relayConfigured: !!env.EMAIL_FEEDBACK_SECRET, providerVerified: false };
  });
}
