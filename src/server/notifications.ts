import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { NotificationIntegration, NotificationDelivery, Prisma } from "@/generated/prisma/client";
import { integrationCreate, integrationPatch, integrationQuery, notificationHistoryQuery, type IntegrationRecord, type IntegrationOptions, type NotificationRecord, type NotificationKind, type SubscriptionInput, type NotificationProvider } from "@/contracts/notifications";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { lockFileContext } from "./file-access";
import { encrypt } from "./crypto";
import { env } from "./env";
import { audit } from "./audit";
import { fail, requireVersion } from "./http";
import { idempotent } from "./idempotency";
import { notificationEndpoint } from "./notification-transport";

export const pendingNotification = ["queued", "leased", "sending", "retry"];
export const retryableNotification = ["RATE_LIMITED", "LOCAL_WRITE_FAILED", "LEASE_EXHAUSTED"];
export async function notificationScope(tx: Transaction, ctx: Context, serviceId: string, write: boolean) {
  return lockFileContext(tx, ctx, serviceId, [write ? "integration.manage" : "integration.read"], !write);
}
async function locate(tx: Transaction, ctx: Context, id: string, write: boolean) {
  const first = await tx.notificationIntegration.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!first) fail(404, "NOT_FOUND", "알림 설정을 찾을 수 없습니다.");
  await notificationScope(tx, ctx, first.serviceId, write);
  if (write) await tx.$queryRaw`SELECT id FROM "NotificationIntegration" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "NotificationIntegration" WHERE id=${id} FOR SHARE`;
  const row = await tx.notificationIntegration.findUniqueOrThrow({ where: { id } });
  if (row.deletedAt) fail(410, "INTEGRATION_DELETED", "삭제한 알림 설정입니다.");
  return row;
}
async function targets(tx: Transaction, tenantId: string, serviceId: string, subscriptions: SubscriptionInput[]) {
  for (const sub of subscriptions) {
    if (!sub.targetId) continue;
    const valid = sub.kind === "submission.created" ? await tx.form.count({ where: { id: sub.targetId, tenantId, serviceId, sourceType: "form", status: { not: "deleted" } } }) :
      await tx.importJob.count({ where: { id: sub.targetId, tenantId, serviceId, status: { notIn: ["archived", "cancelled", "expired"] } } });
    if (!valid) fail(422, "INVALID_NOTIFICATION_TARGET", "현재 서비스에서 사용할 수 있는 알림 대상을 선택해주세요.");
  }
}
async function subscriptions(tx: Transaction, row: NotificationIntegration, input: SubscriptionInput[]) {
  await tx.notificationSubscription.deleteMany({ where: { integrationId: row.id } });
  await tx.notificationSubscription.createMany({ data: input.map(s => ({ ...s, integrationId: row.id, tenantId: row.tenantId, serviceId: row.serviceId })) });
}
async function dto(tx: Transaction, row: NotificationIntegration): Promise<IntegrationRecord> {
  const creator = await tx.membership.findUniqueOrThrow({ where: { id: row.creatorId }, include: { user: { select: { name: true } } } });
  const saved = await tx.notificationSubscription.findMany({ where: { integrationId: row.id }, orderBy: { kind: "asc" } });
  const mapped: IntegrationRecord["subscriptions"] = [];
  for (const sub of saved) {
    const target = !sub.targetId ? null : sub.kind === "submission.created" ? await tx.form.findUnique({ where: { id: sub.targetId }, select: { title: true } }) : await tx.importJob.findUnique({ where: { id: sub.targetId }, select: { title: true } });
    mapped.push({ kind: sub.kind as NotificationKind, targetId: sub.targetId, targetName: sub.targetId ? target?.title ?? "사용할 수 없는 대상" : null });
  }
  return { id: row.id, serviceId: row.serviceId, name: row.name, provider: row.provider as NotificationProvider, transport: row.transport as "local" | "webhook", enabled: row.enabled,
    endpointHost: row.endpointHost, version: row.version, generation: row.generation, deletedAt: row.deletedAt?.toISOString() ?? null, creatorId: row.creatorId, creatorName: creator.user.name, creatorRole: creator.role, createdAt: row.createdAt.toISOString(), subscriptions: mapped };
}
export async function createIntegration(ctx: Context, input: z.infer<typeof integrationCreate>, key: string | null, requestId: string) {
  const url = notificationEndpoint(input.provider, input.endpoint);
  return idempotent("notification:create:" + ctx.member.id, key, input, async tx => {
    await notificationScope(tx, ctx, input.serviceId, true);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"notification-limit:" + input.serviceId},0))`;
    if (await tx.notificationIntegration.count({ where: { serviceId: input.serviceId, tenantId: ctx.tenantId, deletedAt: null } }) >= 50) fail(409, "INTEGRATION_LIMIT", "서비스별 알림 설정은 최대 50개입니다.");
    await targets(tx, ctx.tenantId, input.serviceId, input.subscriptions);
    const row = await tx.notificationIntegration.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, creatorId: ctx.member.id, name: input.name, provider: input.provider,
      transport: env.NOTIFICATION_TRANSPORT, enabled: input.enabled, endpointCipher: encrypt(url.href), endpointHost: url.hostname } });
    await subscriptions(tx, row, input.subscriptions);
    await audit(tx, ctx, requestId, "integration.created", "integration", row.id, [], row.serviceId);
    return { status: 201, body: { id: row.id, version: row.version } };
  }, tx => notificationScope(tx, ctx, input.serviceId, true));
}
export async function integrationOptions(ctx: Context, serviceId: string): Promise<IntegrationOptions> {
  return db.$transaction(async tx => {
    await notificationScope(tx, ctx, serviceId, false);
    const forms = await tx.form.findMany({ where: { tenantId: ctx.tenantId, serviceId, sourceType: "form", status: { not: "deleted" } }, select: { id: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }], take: 301 });
    const imports = await tx.importJob.findMany({ where: { tenantId: ctx.tenantId, serviceId, status: { notIn: ["archived", "cancelled", "expired"] } }, select: { id: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }], take: 301 });
    const ids = await tx.notificationIntegration.findMany({ where: { tenantId: ctx.tenantId, serviceId, deletedAt: null }, select: { creatorId: true }, distinct: ["creatorId"] });
    const creators = await tx.membership.findMany({ where: { id: { in: ids.map(i => i.creatorId) } }, select: { id: true, user: { select: { name: true } } }, orderBy: { id: "asc" } });
    return { forms: forms.slice(0, 300), imports: imports.slice(0, 300), creators: creators.map(c => ({ id: c.id, name: c.user.name })), transport: env.NOTIFICATION_TRANSPORT, formsTruncated: forms.length > 300, importsTruncated: imports.length > 300 };
  });
}
export async function listIntegrations(ctx: Context, query: z.infer<typeof integrationQuery>) {
  return db.$transaction(async tx => {
    await notificationScope(tx, ctx, query.serviceId, false);
    let ids: string[] | undefined;
    if (query.kind !== "all" || query.targetId) ids = (await tx.notificationSubscription.findMany({ where: { tenantId: ctx.tenantId, serviceId: query.serviceId, ...(query.kind !== "all" ? { kind: query.kind } : {}), ...(query.targetId ? { targetId: query.targetId } : {}) }, select: { integrationId: true } })).map(s => s.integrationId);
    const where: Prisma.NotificationIntegrationWhereInput = { tenantId: ctx.tenantId, serviceId: query.serviceId, deletedAt: null, ...(ids ? { id: { in: ids } } : {}), ...(query.creatorId ? { creatorId: query.creatorId } : {}), ...(query.provider !== "all" ? { provider: query.provider } : {}), ...(query.enabled !== "all" ? { enabled: query.enabled === "true" } : {}), ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}) };
    const rows = await tx.notificationIntegration.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize });
    const items: IntegrationRecord[] = []; for (const row of rows) items.push(await dto(tx, row));
    return { items, total: await tx.notificationIntegration.count({ where }), page: query.page, pageSize: query.pageSize };
  });
}
export async function readIntegration(ctx: Context, id: string) { return db.$transaction(async tx => dto(tx, await locate(tx, ctx, id, false))); }
export async function cancelNotifications(tx: Transaction, integrationId: string, code: string) {
  await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE "integrationId"=${integrationId} AND status IN ('queued','leased','sending','retry') ORDER BY id FOR UPDATE`;
  const rows = await tx.notificationDelivery.findMany({ where: { integrationId, status: { in: pendingNotification } } });
  const now = new Date();
  await tx.notificationDelivery.updateMany({ where: { integrationId, status: { in: pendingNotification } }, data: { status: "cancelled", completedAt: now, leaseOwner: null, leaseUntil: null, lastError: code, version: { increment: 1 } } });
  const attempts = rows.filter(r => ["leased", "sending"].includes(r.status) && r.attempts > 0);
  if (attempts.length) await tx.notificationAttempt.createMany({ skipDuplicates: true, data: attempts.map(row => ({ deliveryId: row.id, number: row.attempts, outcome: "cancelled", code, startedAt: row.startedAt ?? row.createdAt, finishedAt: now })) });
}
export async function updateIntegration(ctx: Context, id: string, input: z.infer<typeof integrationPatch>, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); requireVersion(input, row);
    await targets(tx, ctx.tenantId, row.serviceId, input.subscriptions);
    const url = input.endpoint ? notificationEndpoint(row.provider as NotificationProvider, input.endpoint) : null;
    await cancelNotifications(tx, id, "CONFIG_CHANGED");
    const saved = await tx.notificationIntegration.update({ where: { id }, data: { name: input.name, enabled: input.enabled, version: { increment: 1 }, generation: { increment: 1 }, ...(url ? { endpointCipher: encrypt(url.href), endpointHost: url.hostname } : {}) } });
    await subscriptions(tx, saved, input.subscriptions);
    await audit(tx, ctx, requestId, "integration.updated", "integration", id, [], row.serviceId);
    return { id, version: saved.version };
  });
}
export async function toggleIntegration(ctx: Context, id: string, version: number, enabled: boolean, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); requireVersion({ version }, row);
    if (row.enabled === enabled) return { id, version };
    await cancelNotifications(tx, id, "CONFIG_CHANGED");
    const saved = await tx.notificationIntegration.update({ where: { id }, data: { enabled, version: { increment: 1 }, generation: { increment: 1 } } });
    await audit(tx, ctx, requestId, enabled ? "integration.enabled" : "integration.disabled", "integration", id, [], row.serviceId);
    return { id, version: saved.version };
  });
}
export async function deleteIntegrations(ctx: Context, input: { serviceId: string; items: { id: string; version: number }[] }, requestId: string) {
  return db.$transaction(async tx => {
    await notificationScope(tx, ctx, input.serviceId, true);
    const rows = [];
    for (const item of [...input.items].sort((a, b) => a.id.localeCompare(b.id))) {
      const row = await locate(tx, ctx, item.id, true); if (row.serviceId !== input.serviceId) fail(404, "NOT_FOUND", "현재 서비스의 알림만 선택해주세요."); requireVersion(item, row); rows.push(row);
    }
    for (const row of rows) {
      await cancelNotifications(tx, row.id, "INTEGRATION_DELETED");
      await tx.notificationSubscription.deleteMany({ where: { integrationId: row.id } });
      await tx.notificationIntegration.update({ where: { id: row.id }, data: { name: "", endpointCipher: null, endpointHost: null, enabled: false, deletedAt: new Date(), version: { increment: 1 }, generation: { increment: 1 } } });
      await audit(tx, ctx, requestId, "integration.deleted", "integration", row.id, [], row.serviceId);
    }
    return { deleted: rows.length };
  });
}
async function enqueue(tx: Transaction, integration: NotificationIntegration, eventId: string) {
  return tx.notificationDelivery.create({ data: { tenantId: integration.tenantId, serviceId: integration.serviceId, integrationId: integration.id, eventId, generation: integration.generation, transport: integration.transport } });
}
export async function testIntegration(ctx: Context, id: string, version: number, key: string | null, requestId: string) {
  return idempotent("notification:test:" + ctx.member.id + ":" + id, key, { version }, async tx => {
    const row = await locate(tx, ctx, id, true); requireVersion({ version }, row);
    if (!row.enabled) fail(409, "INTEGRATION_DISABLED", "사용 중인 알림만 테스트할 수 있습니다.");
    if (row.transport !== env.NOTIFICATION_TRANSPORT) fail(409, "TRANSPORT_CHANGED", "전송 환경이 변경되었습니다. 현재 환경에서 새 알림을 등록해주세요.");
    const event = await tx.notificationEvent.create({ data: { tenantId: row.tenantId, serviceId: row.serviceId, eventKey: "test:" + randomUUID(), kind: "test", sourceId: id, targetId: id, sourceVersion: row.generation } });
    const delivery = await enqueue(tx, row, event.id);
    await audit(tx, ctx, requestId, "integration.test_requested", "integration", id, [], row.serviceId);
    return { status: 202, body: { id: delivery.id, version: delivery.version } };
  }, async tx => { await locate(tx, ctx, id, true); });
}
export async function emitNotificationEvent(tx: Transaction, kind: NotificationKind, sourceId: string) {
  let data: Prisma.NotificationEventUncheckedCreateInput;
  if (kind === "submission.created") {
    const row = await tx.submission.findUniqueOrThrow({ where: { id: sourceId }, include: { formVersion: { include: { form: true } } } });
    data = { eventKey: "submission:" + row.id, tenantId: row.tenantId, serviceId: row.formVersion.form.serviceId, kind, sourceId, sourceVersion: row.version, targetId: row.formVersion.formId };
  } else {
    const row = await tx.importJob.findUniqueOrThrow({ where: { id: sourceId } });
    data = { eventKey: "import:" + row.id + ":" + row.version, tenantId: row.tenantId, serviceId: row.serviceId, kind, sourceId, sourceVersion: row.version, targetId: row.id, importedRows: row.importedRows, failedRows: row.invalidRows + row.skippedRows };
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"notification-event:" + data.eventKey},0))`;
  if (await tx.notificationEvent.findUnique({ where: { eventKey: data.eventKey } })) return;
  const event = await tx.notificationEvent.create({ data });
  const subs = await tx.notificationSubscription.findMany({ where: { tenantId: event.tenantId, serviceId: event.serviceId, kind, OR: [{ targetId: null }, { targetId: event.targetId }] }, select: { integrationId: true }, orderBy: { integrationId: "asc" } });
  for (const sub of subs) {
    await tx.$queryRaw`SELECT id FROM "NotificationIntegration" WHERE id=${sub.integrationId} FOR SHARE`;
    const row = await tx.notificationIntegration.findUniqueOrThrow({ where: { id: sub.integrationId } });
    const current = await tx.notificationSubscription.findFirst({ where: { integrationId: row.id, kind, OR: [{ targetId: null }, { targetId: event.targetId }] } });
    if (row.enabled && !row.deletedAt && current) await enqueue(tx, row, event.id);
  }
}
export function notificationCanRetry(row: NotificationDelivery) { return row.status === "failed" && retryableNotification.includes(row.lastError ?? "") && row.maxAttempts < 9; }
export async function notificationHistory(ctx: Context, id: string, query: z.infer<typeof notificationHistoryQuery>) {
  return db.$transaction(async tx => {
    await locate(tx, ctx, id, false);
    const where = { integrationId: id, ...(query.status === "all" ? {} : { status: query.status }) };
    const rows = await tx.notificationDelivery.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize });
    const items: NotificationRecord[] = [];
    for (const row of rows) {
      const event = await tx.notificationEvent.findUniqueOrThrow({ where: { id: row.eventId } });
      const attempts = await tx.notificationAttempt.findMany({ where: { deliveryId: row.id }, orderBy: { number: "asc" } });
      items.push({ id: row.id, kind: event.kind as NotificationRecord["kind"], status: row.status as NotificationRecord["status"], outcome: row.outcome, error: row.lastError, attempts: row.attempts, maxAttempts: row.maxAttempts, version: row.version, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, nextAttemptAt: row.nextAttemptAt.toISOString(), canRetry: notificationCanRetry(row), history: attempts.map(a => ({ number: a.number, outcome: a.outcome, code: a.code, httpStatus: a.httpStatus, startedAt: a.startedAt.toISOString(), finishedAt: a.finishedAt.toISOString() })) });
    }
    return { items, total: await tx.notificationDelivery.count({ where }), page: query.page, pageSize: query.pageSize };
  });
}
export async function retryNotification(ctx: Context, id: string, deliveryId: string, version: number, key: string | null, requestId: string) {
  return idempotent("notification:retry:" + ctx.member.id + ":" + deliveryId, key, { id, version }, async tx => {
    const integration = await locate(tx, ctx, id, true);
    await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE id=${deliveryId} FOR UPDATE`;
    const row = await tx.notificationDelivery.findFirst({ where: { id: deliveryId, integrationId: id } });
    if (!row) fail(404, "NOT_FOUND", "전송 내역을 찾을 수 없습니다."); requireVersion({ version }, row);
    if (!notificationCanRetry(row) || !integration.enabled || row.generation !== integration.generation || row.transport !== env.NOTIFICATION_TRANSPORT || Date.now() - row.createdAt.getTime() > 86400000) fail(409, "NOTIFICATION_NOT_RETRYABLE", "이 알림은 재전송할 수 없습니다. 현재 설정과 전송 결과를 확인해주세요.");
    const saved = await tx.notificationDelivery.update({ where: { id: row.id }, data: { status: "queued", maxAttempts: Math.min(9, row.maxAttempts + 3), nextAttemptAt: new Date(), completedAt: null, lastError: null, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "integration.retry_requested", "notification", row.id, [], row.serviceId);
    return { status: 202, body: { id: saved.id, version: saved.version } };
  }, async tx => { await locate(tx, ctx, id, true); });
}
