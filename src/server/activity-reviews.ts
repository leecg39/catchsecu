import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { reviewAction, reviewCreate, reviewDestruction, reviewQuery, reviewNotify, type ReviewDetail, type ReviewRecord } from "@/contracts/activity-reviews";
import { db, type Transaction } from "./db";
import { activeMembershipWhere, type Context } from "./context";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { roleCan } from "./permissions";
import { fail, requireVersion } from "./http";
import { audit } from "./audit";
import { decrypt, encrypt } from "./crypto";
import { ACTIVITY_REVIEW_MAIL, activityMailKey, enqueueReviewMail, lockReviewRecipient, recipientCurrent } from "./activity-review-mail";
import { env } from "./env";
import { idempotent } from "./idempotency";

const include = { service: true, auditEvent: { select: { action: true } }, requester: { include: { user: { select: { name: true } } } }, recipient: { include: { user: { select: { name: true } } } } } as const;
type Row = Prisma.ActivityReviewGetPayload<{ include: typeof include }>;
type Actor = Awaited<ReturnType<typeof lockServiceActor>>;
const active = (status: string) => ["requested", "responded"].includes(status);
function manager(actor: Actor) { return roleCan(actor.member.role, "security.write") && roleCan(actor.member.role, "audit.read"); }
function manages(actor: Actor, serviceId: string) {
  if (!manager(actor)) return false;
  if (actor.member.accessKind === "expert" && !actor.member.expertAssignment?.services.some(s => s.serviceId === serviceId)) return false;
  return (actor.member.accessKind === "direct" && ["owner", "admin"].includes(actor.member.role)) || actor.member.grants.some(g => g.serviceId === serviceId && ["service.read", "security.write", "audit.read"].every(c => g.capabilities.includes(c)));
}
function managedScope(actor: Actor): Prisma.ServiceWhereInput {
  if (!manager(actor)) fail(403, "REVIEW_FORBIDDEN", "개인정보 활동 검토 관리 권한이 없습니다.");
  return { AND: [actor.scope, ...((actor.member.accessKind === "direct" && ["owner", "admin"].includes(actor.member.role)) ? [] : [{ id: { in: actor.member.grants.filter(g => ["service.read", "security.write", "audit.read"].every(c => g.capabilities.includes(c))).map(g => g.serviceId) } }])] };
}
function dto(row: Row): ReviewRecord {
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service.name, auditEventId: row.auditEventId, action: row.auditEvent.action, title: row.title,
    status: row.status as ReviewRecord["status"], version: row.version, destructionStatus: row.destructionStatus as ReviewRecord["destructionStatus"],
    retentionUntil: row.retentionUntil?.toISOString() ?? null, requesterName: row.requester.user.name, recipientName: row.recipient.user.name,
    createdAt: row.createdAt.toISOString(), respondedAt: row.respondedAt?.toISOString() ?? null, closedAt: row.closedAt?.toISOString() ?? null };
}
async function locate(tx: Transaction, ctx: Context, actor: Actor, id: string, write = false) {
  const found = await tx.activityReview.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { serviceId: true, recipientId: true } });
  if (!found || (found.recipientId !== actor.member.id && !manages(actor, found.serviceId))) fail(404, "NOT_FOUND", "검토 요청을 찾을 수 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${found.serviceId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  if (write) await tx.$queryRaw`SELECT id FROM "ActivityReview" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ActivityReview" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const row = await tx.activityReview.findUniqueOrThrow({ where: { id }, include });
  if (write && row.service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에서는 검토 요청을 변경할 수 없습니다.");
  return row;
}
function allowAction(actor: Actor, row: Row, action: z.infer<typeof reviewAction>["action"]) {
  if (action === "response") {
    if (row.recipientId !== actor.member.id) fail(403, "REVIEW_RECIPIENT_ONLY", "검토 대상자만 답변할 수 있습니다.");
  } else if (!manages(actor, row.serviceId) || row.recipientId === actor.member.id)
    fail(403, "REVIEW_FORBIDDEN", "해당 서비스의 보안 담당자가 처리해야 합니다.");
}
export async function listActivityReviews(ctx: Context, input: z.infer<typeof reviewQuery>) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "service.read");
    const scope: Prisma.ActivityReviewWhereInput = input.scope === "received" ? { recipientId: actor.member.id } :
      { service: managedScope(actor), ...(input.scope === "sent" ? { requesterId: actor.member.id } : {}) };
    const where: Prisma.ActivityReviewWhereInput = { ...scope, tenantId: ctx.tenantId, ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      ...(input.status === "all" ? {} : { status: input.status }), title: { contains: input.search, mode: "insensitive" },
      ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lt: new Date(input.to) } : {}) } } : {}) };
    const total = await tx.activityReview.count({ where }), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const rows = await tx.activityReview.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * input.pageSize, take: input.pageSize });
    const items = rows.map(dto); assertFileDeadlines(actor.deadlines);
    return { items, total, page, pageSize: input.pageSize };
  });
}
export async function readActivityReview(ctx: Context, id: string): Promise<ReviewDetail> {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "service.read"), row = await locate(tx, ctx, actor, id);
    const messages = await tx.activityReviewMessage.findMany({ where: { tenantId: ctx.tenantId, reviewId: id }, include: { author: { include: { user: { select: { name: true } } } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const notification = await tx.job.findFirst({ where: { tenantId: ctx.tenantId, type: ACTIVITY_REVIEW_MAIL, dedupeKey: { startsWith: "activity-review:" + row.id + ":" } }, orderBy: { createdAt: "desc" } });
    const result = { ...dto(row),
      canNotify: row.status === "requested" && row.recipientId !== actor.member.id && manages(actor, row.serviceId) && row.service.status === "active" && !notification,
      notification: notification ? { status: notification.payloadErasedAt ? "expired" : notification.status === "done" ? (decrypt<{ transport: string }>(notification.payloadCipher).transport === "local" ? "local_delivered" : "accepted") : notification.status, createdAt: notification.createdAt.toISOString(), completedAt: notification.completedAt?.toISOString() ?? null } : null, canRespond: row.status === "requested" && row.recipientId === actor.member.id && row.service.status === "active",
      canClose: active(row.status) && row.recipientId !== actor.member.id && manages(actor, row.serviceId) && row.service.status === "active",
      canDecideDestruction: row.destructionStatus === "awaiting" && manages(actor, row.serviceId) && row.service.status === "active",
      messages: messages.map(m => ({ id: m.id, kind: m.kind, authorName: m.author.user.name, body: decrypt<string>(m.bodyCipher), createdAt: m.createdAt.toISOString() })) };
    assertFileDeadlines(actor.deadlines); return result;
  });
}
export async function createActivityReview(ctx: Context, input: z.infer<typeof reviewCreate>, key: string | null, requestId: string) {
  let actor: Actor, recipientDeadline: Date | null = null;
  return idempotent("activity-review:create:" + ctx.tenantId + ":" + ctx.member.id, key, input, async tx => {
    actor = await lockServiceActor(tx, ctx, "service.read");
    const scope = managedScope(actor);
    const event = await tx.auditEvent.findFirst({ where: { id: input.auditEventId, tenantId: ctx.tenantId } });
    if (!event?.actorId || !event.serviceId || !/^(submission|file|destruction|import)\./.test(event.action))
      fail(422, "INVALID_REVIEW_EVENT", "회사 구성원의 개인정보 처리 기록을 선택해주세요.");
    const service = await tx.service.findFirst({ where: { AND: [scope, { id: event.serviceId, status: "active" }] } });
    if (!service) fail(403, "SERVICE_FORBIDDEN", "해당 서비스의 검토 요청 권한이 없습니다.");
    if (event.actorId === ctx.user.id) fail(422, "REVIEW_SELF_REQUEST", "본인의 처리 기록에는 검토 요청을 만들 수 없습니다.");
    const candidate = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId: event.actorId } } });
    if (!candidate) fail(422, "REVIEW_RECIPIENT_UNAVAILABLE", "현재 회사 구성원에게만 검토를 요청할 수 있습니다.");
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${candidate.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${event.actorId} FOR SHARE`;
    if (candidate.expertAssignmentId) await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${candidate.expertAssignmentId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const recipient = await tx.membership.findFirst({ where: { ...activeMembershipWhere(event.actorId, ctx.tenantId), id: candidate.id, user: { status: "active", emailVerified: true } }, include: { expertAssignment: true } });
    if (!recipient) fail(422, "REVIEW_RECIPIENT_UNAVAILABLE", "현재 회사 구성원에게만 검토를 요청할 수 있습니다.");
    recipientDeadline = recipient.accessKind === "expert" ? recipient.expertAssignment!.expiresAt : null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"activity-review:" + ctx.tenantId + ":" + event.id}, 0))`;
    if (await tx.activityReview.count({ where: { tenantId: ctx.tenantId, auditEventId: event.id, status: { in: ["requested", "responded"] } } }))
      fail(409, "REVIEW_ALREADY_OPEN", "이 처리 기록에는 진행 중인 검토 요청이 있습니다.");
    const row = await tx.activityReview.create({ data: { tenantId: ctx.tenantId, serviceId: service.id, auditEventId: event.id,
      recipientId: recipient.id, recipientUserId: event.actorId, requesterId: actor.member.id, title: input.title } });
    await tx.activityReviewMessage.create({ data: { tenantId: ctx.tenantId, reviewId: row.id, authorId: actor.member.id, kind: "request", bodyCipher: encrypt(input.message) } });
    await audit(tx, ctx, requestId, "activity_review.requested", "activityReview", row.id, ["title", "message", "status"], row.serviceId);
    return { status: 201, body: { id: row.id } };
  }, async tx => { actor = await lockServiceActor(tx, ctx, "service.read"); managedScope(actor); }, async (tx, cached) => {
    const row = await locate(tx, ctx, actor, cached.id, true);
    if (!manages(actor, row.serviceId)) fail(403, "REVIEW_FORBIDDEN", "검토 요청 권한이 없습니다.");
    return cached;
  }, async () => {
    assertFileDeadlines(actor.deadlines);
    if (recipientDeadline && recipientDeadline <= new Date()) fail(422, "REVIEW_RECIPIENT_UNAVAILABLE", "대상자의 전문가 배정이 만료되었습니다.");
  });
}
export async function actOnActivityReview(ctx: Context, id: string, input: z.infer<typeof reviewAction>, key: string | null, requestId: string) {
  let actor: Actor;
  return idempotent("activity-review:action:" + ctx.tenantId + ":" + ctx.member.id + ":" + id, key, input, async tx => {
    actor = await lockServiceActor(tx, ctx, "service.read");
    const now = new Date(), status = input.action === "response" ? "responded" : input.action === "resolve" ? "resolved" : "cancelled";
    // updatePolicy와 같은 순서로 정책을 먼저 잠가 종결 스냅샷이 정책 변경과 직렬화되게 한다.
    let retentionUntil: Date | null = null;
    if (status !== "responded") {
      await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${ctx.tenantId} FOR SHARE`;
      const policy = await tx.securityPolicy.findUnique({ where: { tenantId: ctx.tenantId }, select: { activityReviewRetentionDays: true } });
      if (policy?.activityReviewRetentionDays) retentionUntil = new Date(now.getTime() + policy.activityReviewRetentionDays * 86400000);
    }
    const row = await locate(tx, ctx, actor, id, true);
    allowAction(actor, row, input.action); requireVersion(input, row);
    if (input.action === "response" ? row.status !== "requested" : input.action === "resolve" ? row.status !== "responded" : !active(row.status))
      fail(409, "INVALID_REVIEW_TRANSITION", "현재 상태에서는 처리할 수 없습니다. 최신 검토 이력을 확인해주세요.");
    await tx.activityReview.update({ where: { id }, data: { status, version: { increment: 1 }, ...(input.action === "response" ? { respondedAt: now } : { closedAt: now, retentionUntil }) } });
    const message = await tx.activityReviewMessage.create({ data: { tenantId: ctx.tenantId, reviewId: id, authorId: actor.member.id, kind: input.action, bodyCipher: encrypt(input.message) } });
    await audit(tx, ctx, requestId, "activity_review." + status, "activityReview", id, ["message", "status"], row.serviceId);
    return { status: 200, body: { id, messageId: message.id } };
  }, async tx => { actor = await lockServiceActor(tx, ctx, "service.read"); }, async (tx, cached) => {
    const row = await locate(tx, ctx, actor, id, true); allowAction(actor, row, input.action); return cached;
  }, async () => { assertFileDeadlines(actor.deadlines); });
}

export async function notifyActivityReview(ctx: Context, id: string, input: z.infer<typeof reviewNotify>, key: string | null, requestId: string) {
  let actor: Actor, expiresAt: Date | null = null;
  return idempotent("activity-review:notify:" + ctx.tenantId + ":" + ctx.member.id + ":" + id, key, input, async tx => {
    actor = await lockServiceActor(tx, ctx, "service.read");
    const row = await locate(tx, ctx, actor, id, true); allowAction(actor, row, "cancel"); requireVersion(input, row);
    if (row.status !== "requested") fail(409, "REVIEW_NOTIFICATION_CLOSED", "답변 대기 중인 검토에만 알림을 요청할 수 있습니다.");
    const recipient = await lockReviewRecipient(tx, ctx.tenantId, row.recipientId, row.recipientUserId); expiresAt = recipient.expiresAt;
    const job = await enqueueReviewMail(tx, ctx.tenantId, { reviewId: id, version: row.version, issuerId: actor.member.id, issuerUserId: ctx.user.id, recipientId: row.recipientId, recipientUserId: row.recipientUserId, to: recipient.email, transport: env.MAIL_TRANSPORT });
    await audit(tx, ctx, requestId, "activity_review.notification_requested", "activityReview", id, ["notification"], row.serviceId);
    return { status: 202, body: { id, jobId: job.id } };
  }, async tx => { actor = await lockServiceActor(tx, ctx, "service.read"); }, async (tx, cached) => {
    const row = await locate(tx, ctx, actor, id, true); allowAction(actor, row, "cancel");
    const job = await tx.job.findFirst({ where: { id: cached.jobId, tenantId: ctx.tenantId, type: ACTIVITY_REVIEW_MAIL, dedupeKey: activityMailKey(id, input.version), payloadErasedAt: null } });
    if (!job) fail(410, "REVIEW_NOTIFICATION_EXPIRED", "알림 보관 기간이 끝났습니다. 최신 이력을 확인해주세요.");
    const recipient = await lockReviewRecipient(tx, ctx.tenantId, row.recipientId, row.recipientUserId); expiresAt = recipient.expiresAt;
    return cached;
  }, async () => { assertFileDeadlines(actor.deadlines); recipientCurrent(expiresAt); });
}

export async function decideActivityReviewDestruction(ctx: Context, id: string, input: z.infer<typeof reviewDestruction>, key: string | null, requestId: string) {
  let actor: Actor;
  return idempotent("activity-review:destruction:" + ctx.tenantId + ":" + ctx.member.id + ":" + id, key, input, async tx => {
    actor = await lockServiceActor(tx, ctx, "service.read");
    const row = await locate(tx, ctx, actor, id, true);
    if (!manages(actor, row.serviceId)) fail(403, "REVIEW_FORBIDDEN", "해당 서비스의 보안 담당자가 처리해야 합니다.");
    requireVersion(input, row);
    if (row.destructionStatus !== "awaiting") fail(409, "INVALID_DESTRUCTION_TRANSITION", "파기 승인 대기 중인 종결 검토만 처리할 수 있습니다.");
    if (input.action === "keep") {
      await tx.activityReview.update({ where: { id }, data: { destructionStatus: "kept", version: { increment: 1 } } });
      await audit(tx, ctx, requestId, "activity_review.destruction_kept", "activityReview", id, ["destructionStatus"], row.serviceId);
    } else {
      await tx.$queryRaw`SELECT set_config('app.activity_review_destroy', 'on', true)`;
      const removed = await tx.activityReviewMessage.deleteMany({ where: { tenantId: ctx.tenantId, reviewId: id } });
      await tx.activityReview.update({ where: { id }, data: { destructionStatus: "destroyed", destroyedAt: new Date(), destroyApproverId: actor.member.id, version: { increment: 1 } } });
      await audit(tx, ctx, requestId, "activity_review.destroyed", "activityReview", id, ["destructionStatus", `messages:${removed.count}`], row.serviceId);
    }
    return { status: 200, body: { id } };
  }, async tx => { actor = await lockServiceActor(tx, ctx, "service.read"); }, async (tx, cached) => {
    const row = await locate(tx, ctx, actor, id, true);
    if (!manages(actor, row.serviceId)) fail(403, "REVIEW_FORBIDDEN", "해당 서비스의 보안 담당자가 처리해야 합니다.");
    return cached;
  }, async () => { assertFileDeadlines(actor.deadlines); });
}

const closedReview = (status: string) => ["resolved", "cancelled"].includes(status);
async function systemReviewAudit(tx: Transaction, tenantId: string, serviceId: string, reviewId: string, action: string) {
  await tx.auditEvent.create({ data: { tenantId, serviceId, resource: "activityReview", resourceId: reviewId, action, requestId: randomUUID(), detail: {} } });
}
export async function sweepActivityReviewRetention(now = new Date(), limit = 50) {
  const candidates = await db.$queryRaw<{ id: string; tenantId: string }[]>`
    SELECT id,"tenantId" FROM "ActivityReview" WHERE "destructionStatus"='none' AND "retentionUntil" IS NOT NULL AND "retentionUntil"<=${now} AND "status" IN ('resolved','cancelled') ORDER BY "retentionUntil",id LIMIT ${limit}`;
  let pending = 0;
  for (const candidate of candidates) {
    const marked = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${candidate.tenantId} FOR SHARE`;
      await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${candidate.tenantId} FOR SHARE`;
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ActivityReview" WHERE id=${candidate.id} AND "tenantId"=${candidate.tenantId} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return false;
      const row = await tx.activityReview.findUniqueOrThrow({ where: { id: candidate.id } });
      if (row.destructionStatus !== "none" || !row.retentionUntil || row.retentionUntil > now || !closedReview(row.status)) return false;
      const policy = await tx.securityPolicy.findUnique({ where: { tenantId: row.tenantId }, select: { activityReviewRetentionDays: true } });
      if (!policy || policy.activityReviewRetentionDays === null) {
        await tx.activityReview.update({ where: { id: row.id }, data: { retentionUntil: null, version: { increment: 1 } } });
        return false;
      }
      await tx.activityReview.update({ where: { id: row.id }, data: { destructionStatus: "awaiting", version: { increment: 1 } } });
      await systemReviewAudit(tx, row.tenantId, row.serviceId, row.id, "activity_review.destruction_pending");
      return true;
    });
    if (marked) pending++;
  }
  return { pending };
}
