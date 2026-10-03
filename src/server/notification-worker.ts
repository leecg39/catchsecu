import type { NotificationDelivery, NotificationEvent } from "@/generated/prisma/client";
import { notificationLabels, type NotificationProvider } from "@/contracts/notifications";
import { submissionDataAvailable } from "@/contracts/destruction";
import { db, type Transaction } from "./db";
import { lockFileContext } from "./file-access";
import { decrypt } from "./crypto";
import { env } from "./env";
import { HttpError } from "./http";
import { deliverNotification, type NotificationResult } from "./notification-transport";

export async function recoverNotifications() {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<NotificationDelivery[]>`SELECT * FROM "NotificationDelivery" WHERE status IN ('leased','sending') AND "leaseUntil"<now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100`;
    for (const row of rows) {
      const unknown = row.status === "sending", exhausted = row.attempts >= row.maxAttempts;
      const status = unknown ? "unknown" : exhausted ? "failed" : "retry", code = unknown ? "LEASE_LOST" : exhausted ? "LEASE_EXHAUSTED" : "LEASE_RECOVERED", now = new Date();
      await tx.notificationDelivery.update({ where: { id: row.id }, data: { status, lastError: code, leaseOwner: null, leaseUntil: null, completedAt: status === "retry" ? null : now, nextAttemptAt: now, version: { increment: 1 } } });
      await tx.notificationAttempt.create({ data: { deliveryId: row.id, number: row.attempts, outcome: status, code, startedAt: row.startedAt ?? row.createdAt, finishedAt: now } });
    }
    return rows.length;
  });
}
export async function claimNotification(workerId: string) {
  const rows = await db.$queryRaw<NotificationDelivery[]>`UPDATE "NotificationDelivery" SET status='leased', "leaseOwner"=${workerId}, "leaseUntil"=now()+interval '60 seconds', "startedAt"=now(), attempts=attempts+1, version=version+1, "updatedAt"=now()
    WHERE id=(SELECT id FROM "NotificationDelivery" WHERE status IN ('queued','retry') AND "nextAttemptAt"<=now() AND attempts<"maxAttempts" ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  return rows[0];
}
async function lockSource(tx: Transaction, event: NotificationEvent) {
  if (event.kind === "submission.created") {
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${event.sourceId} FOR SHARE`;
    const source = await tx.submission.findUnique({ where: { id: event.sourceId }, include: { formVersion: { include: { form: true } } } });
    return !!source && source.tenantId === event.tenantId && source.formVersion.form.serviceId === event.serviceId && source.formVersion.formId === event.targetId && source.formVersion.form.status !== "deleted" && submissionDataAvailable(source);
  }
  if (event.kind === "import.completed") {
    await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${event.sourceId} FOR SHARE`;
    const source = await tx.importJob.findUnique({ where: { id: event.sourceId } });
    return !!source && source.tenantId === event.tenantId && source.serviceId === event.serviceId && ["completed", "partialFailed"].includes(source.status);
  }
  return true;
}
export async function notificationAttemptResult(tx: Transaction, row: NotificationDelivery, result: NotificationResult | { kind: "cancelled"; code: string }) {
  const terminal = result.kind !== "retry" || row.attempts >= row.maxAttempts;
  const status = result.kind === "success" ? "succeeded" : result.kind === "retry" && terminal ? "failed" : result.kind;
  const now = new Date();
  await tx.notificationDelivery.update({ where: { id: row.id }, data: { status, outcome: result.kind === "success" ? result.outcome : null, lastError: result.code ?? null,
    leaseOwner: null, leaseUntil: null, completedAt: terminal ? now : null, nextAttemptAt: new Date(now.getTime() + ("retrySeconds" in result ? result.retrySeconds ?? 5 : 5) * 1000), version: { increment: 1 } } });
  await tx.notificationAttempt.create({ data: { deliveryId: row.id, number: row.attempts, outcome: result.kind === "success" ? result.outcome! : status, code: result.code ?? null,
    httpStatus: "httpStatus" in result ? result.httpStatus : null, startedAt: row.startedAt ?? row.createdAt, finishedAt: now } });
}
function message(event: NotificationEvent) {
  const label = notificationLabels[event.kind as keyof typeof notificationLabels];
  return "[캐치시큐] " + label + "\n" + (event.kind === "test" ? "알림 연결을 확인하는 테스트입니다." : event.kind === "import.completed" ? `반영 ${event.importedRows}건 · 미반영 ${event.failedRows}건` : "새 응답이 접수되었습니다. 관리 화면에서 확인해주세요.") + "\n발생 시각: " + event.occurredAt.toISOString() + "\n참조: " + event.id;
}
export async function processNotification(claimed: NotificationDelivery, workerId: string) {
  // Persist intent before any external effect. A crash after this commit is never retried blindly.
  const prepared = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE id=${claimed.id} FOR UPDATE`;
    const row = await tx.notificationDelivery.findUniqueOrThrow({ where: { id: claimed.id } });
    if (row.status !== "leased" || row.leaseOwner !== workerId || !row.leaseUntil || row.leaseUntil <= new Date()) return false;
    await tx.notificationDelivery.update({ where: { id: row.id }, data: { status: "sending", version: { increment: 1 } } }); return true;
  });
  if (!prepared) return;
  await db.$transaction(async tx => {
    const initial = await tx.notificationIntegration.findUniqueOrThrow({ where: { id: claimed.integrationId } });
    const member = await tx.membership.findUniqueOrThrow({ where: { id: initial.creatorId } });
    let denied: string | null = null;
    try { await lockFileContext(tx, { tenantId: initial.tenantId, member: { id: member.id }, user: { id: member.userId } }, initial.serviceId, ["integration.manage"]); }
    catch (error) { if (error instanceof HttpError) denied = "PERMISSION_REVOKED"; else throw error; }
    const event = await tx.notificationEvent.findUniqueOrThrow({ where: { id: claimed.eventId } });
    if (!denied && !await lockSource(tx, event)) denied = "SOURCE_UNAVAILABLE";
    await tx.$queryRaw`SELECT id FROM "NotificationIntegration" WHERE id=${initial.id} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE id=${claimed.id} FOR UPDATE`;
    const row = await tx.notificationDelivery.findUniqueOrThrow({ where: { id: claimed.id } });
    if (row.status !== "sending" || row.leaseOwner !== workerId || !row.leaseUntil || row.leaseUntil <= new Date()) return;
    const integration = await tx.notificationIntegration.findUniqueOrThrow({ where: { id: row.integrationId } });
    if (!integration.enabled || integration.deletedAt || integration.generation !== row.generation) denied = "CONFIG_CHANGED";
    if (row.transport !== env.NOTIFICATION_TRANSPORT) denied = "TRANSPORT_CHANGED";
    if (Date.now() - event.occurredAt.getTime() > 86400000) denied = "EVENT_EXPIRED";
    if (denied || !integration.endpointCipher) { await notificationAttemptResult(tx, row, { kind: "cancelled", code: denied ?? "INTEGRATION_DELETED" }); return; }
    let result: NotificationResult;
    try { result = await deliverNotification({ id: row.id, provider: integration.provider as NotificationProvider, transport: row.transport, endpoint: decrypt<string>(integration.endpointCipher), text: message(event) }); }
    catch { result = { kind: "unknown", code: "DELIVERY_UNCERTAIN" }; }
    await notificationAttemptResult(tx, row, result);
  }, { timeout: 20000 });
}
export async function runOneNotification(workerId: string) {
  await recoverNotifications();
  const row = await claimNotification(workerId);
  if (!row) return false;
  try { await processNotification(row, workerId); }
  catch {
    // Database/interruption failures retain the committed sending intent for lease recovery.
    console.error("알림 처리 상태를 복구 대기 중입니다.", { deliveryId: row.id });
  }
  return true;
}
