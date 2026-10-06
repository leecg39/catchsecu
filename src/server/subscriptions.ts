import { db, type Transaction } from "./db";
import { fail, requireVersion } from "./http";
import { idempotent } from "./idempotency";
import type { Context } from "./context";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import type { PlanRecord, SubscriptionRecord, EntitlementRecord, AssetOverview } from "@/contracts/subscriptions";

async function billingRead<T>(ctx: Context, read: (tx: Transaction) => Promise<T>) {
  return db.$transaction(async tx => {
    const actor = await lockServiceActor(tx, ctx, "billing.read");
    const result = await read(tx);
    assertFileDeadlines(actor.deadlines);
    return result;
  });
}
type SubscriptionChange = { status: number; body: SubscriptionRecord; finalCheck?: () => void };
async function billingChange(ctx: Context, scope: string, key: string | null, payload: unknown,
  change: (tx: Transaction) => Promise<SubscriptionChange>) {
  let deadlines: Awaited<ReturnType<typeof lockServiceActor>>["deadlines"];
  let check: (() => void) | undefined;
  return idempotent(scope, key, payload, async tx => {
    deadlines = (await lockServiceActor(tx, ctx, "billing.write")).deadlines;
    const result = await change(tx);
    check = result.finalCheck;
    return { status: result.status, body: result.body };
  }, async tx => {
    deadlines = (await lockServiceActor(tx, ctx, "billing.write")).deadlines;
  }, async (tx, cached) => {
    await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE id=${cached.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const row = await tx.billingSubscription.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId }, include: { plan: true } });
    if (!row) fail(410, "SUBSCRIPTION_UNAVAILABLE", "기존 구독 요청을 찾을 수 없습니다. 최신 목록을 확인해주세요.");
    return subDto(row);
  }, async () => {
    assertFileDeadlines(deadlines);
    check?.();
  });
}
function assertSubscriptionDeadline(deadline: Date) {
  if (deadline <= new Date()) fail(409, "SUBSCRIPTION_UNAVAILABLE", "구독 변경 가능 시간이 지났습니다. 최신 상태를 확인해주세요.");
}

export async function plans(ctx: Context): Promise<PlanRecord[]> {
  return billingRead(ctx, async tx => {
    const rows = await tx.billingPlan.findMany({ include: { versions: { orderBy: [{ number: "desc" }, { cycle: "asc" }] } }, orderBy: { createdAt: "asc" } });
    return rows.map(p => ({ id: p.id, name: p.name, description: p.description,
      versions: p.versions.map(v => ({ id: v.id, number: v.number, cycle: v.cycle, priceKrw: v.priceKrw,
        currency: v.currency, serviceLimit: v.serviceLimit, memberLimit: v.memberLimit,
        subjectLimit: v.subjectLimit, formLimit: v.formLimit,
        orderable: v.orderable && v.effectiveFrom <= new Date() && (!v.effectiveTo || v.effectiveTo > new Date()),
        effectiveFrom: v.effectiveFrom.toISOString(), effectiveTo: v.effectiveTo?.toISOString() ?? null })) }));
  });
}

type SubRow = Awaited<ReturnType<typeof db.billingSubscription.findFirstOrThrow>> & { plan: { name: string } };
function subDto(row: SubRow): SubscriptionRecord {
  const trialEnd = row.cancelAt && row.periodEnd && row.cancelAt < row.periodEnd ? row.cancelAt : row.periodEnd;
  const status = (row.status === "trialing" || row.status === "active") && trialEnd && trialEnd <= new Date() ? "expired" : row.status;
  return { id: row.id, planId: row.planId, planName: row.plan.name, planVersionId: row.planVersionId,
    status, periodStart: row.periodStart?.toISOString() ?? null, periodEnd: row.periodEnd?.toISOString() ?? null,
    cancelAt: row.cancelAt?.toISOString() ?? null, priceKrw: row.priceKrw, currency: row.currency,
    version: row.version, createdAt: row.createdAt.toISOString() };
}
export async function subscriptions(ctx: Context): Promise<SubscriptionRecord[]> {
  return billingRead(ctx, async tx => {
    const rows = await tx.billingSubscription.findMany({ where: { tenantId: ctx.tenantId }, include: { plan: true }, orderBy: { createdAt: "desc" } });
    return rows.map(subDto);
  });
}
export async function entitlement(ctx: Context): Promise<EntitlementRecord> {
  return billingRead(ctx, tx => readEntitlement(tx, ctx));
}
async function readEntitlement(tx: Transaction, ctx: Context): Promise<EntitlementRecord> {
  const now = new Date();
  const [selected, services, members, subjects, forms] = await Promise.all([
    tx.billingSubscription.findFirst({ where: { tenantId: ctx.tenantId, status: { in: ["trialing", "active"] }, periodStart: { lte: now }, periodEnd: { gt: now },
      OR: [{ cancelAt: null }, { cancelAt: { gt: now } }] }, include: { planVersion: true }, orderBy: { periodEnd: "desc" } }),
    tx.service.count({ where: { tenantId: ctx.tenantId, status: "active" } }),
    tx.membership.count({ where: { tenantId: ctx.tenantId, status: "active" } }),
    tx.dataSubject.count({ where: { tenantId: ctx.tenantId } }),
    tx.form.count({ where: { tenantId: ctx.tenantId, status: { not: "deleted" }, sourceType: "form" } }),
  ]);
  const end = selected?.cancelAt ?? selected?.periodEnd;
  const current = end && end > new Date() ? selected : null;
  return { active: !!current, status: current?.status ?? "expired", periodEnd: current?.cancelAt?.toISOString() ?? current?.periodEnd?.toISOString() ?? null,
    limits: { services: current?.planVersion.serviceLimit ?? null, members: current?.planVersion.memberLimit ?? null,
      subjects: current?.planVersion.subjectLimit ?? null, forms: current?.planVersion.formLimit ?? null },
    usage: { services, members, subjects, forms } };
}
export async function assetOverview(ctx: Context): Promise<AssetOverview> {
  return billingRead(ctx, async tx => {
    const [current, services] = await Promise.all([
      readEntitlement(tx, ctx),
      tx.service.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, status: true, _count: { select: {
          forms: { where: { sourceType: "form", status: { not: "deleted" } } }, dataSubjects: true,
        } } } }),
    ]);
    return { entitlement: current, services: services.map(service => ({ id: service.id, name: service.name,
      status: service.status, forms: service._count.forms, subjects: service._count.dataSubjects })) };
  });
}
export async function requestPurchase(ctx: Context, planVersionId: string, key: string | null, requestId: string) {
  return billingChange(ctx, "billing:purchase:" + ctx.tenantId, key, { planVersionId }, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"billing:" + ctx.tenantId}, 0))`;
    await tx.$queryRaw`SELECT id FROM "BillingPlanVersion" WHERE id=${planVersionId} FOR SHARE`;
    const version = await tx.billingPlanVersion.findUnique({ where: { id: planVersionId }, include: { plan: true } });
    if (!version || !version.orderable || version.cycle === "trial" || version.priceKrw === null ||
      version.effectiveFrom > new Date() || (version.effectiveTo && version.effectiveTo <= new Date()))
      fail(409, "PLAN_UNAVAILABLE", "현재 요청할 수 없는 상품입니다.");
    const duplicate = await tx.billingSubscription.findFirst({ where: { tenantId: ctx.tenantId, planId: version.planId, status: "pending" } });
    if (duplicate) fail(409, "PURCHASE_ALREADY_PENDING", "이미 처리 대기 중인 구독 요청이 있습니다.");
    const created = await tx.billingSubscription.create({ data: { tenantId: ctx.tenantId, planId: version.planId,
      planVersionId: version.id, status: "pending", priceKrw: version.priceKrw, currency: version.currency,
      events: { create: { version: 1, kind: "purchase_requested", detail: { cycle: version.cycle, priceKrw: version.priceKrw } } } }, include: { plan: true } });
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, action: "billing.purchase.requested",
      resource: "subscription", resourceId: created.id, requestId, detail: { planVersionId } } });
    return { status: 202, body: subDto(created), finalCheck: () => {
      if (version.effectiveTo && version.effectiveTo <= new Date()) fail(409, "PLAN_UNAVAILABLE", "현재 요청할 수 없는 상품입니다.");
    } };
  });
}
export async function cancelPurchase(ctx: Context, id: string, version: number, key: string | null, requestId: string) {
  return billingChange(ctx, "billing:cancel:" + ctx.tenantId + ":" + id, key, { id, version }, async tx => {
    await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
    const row = await tx.billingSubscription.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { plan: true } });
    if (!row) fail(404, "NOT_FOUND", "구독 요청을 찾을 수 없습니다.");
    requireVersion({ version }, row);
    if (row.status !== "pending") fail(409, "INVALID_STATUS", "대기 중인 요청만 취소할 수 있습니다.");
    const updated = await tx.billingSubscription.update({ where: { id, tenantId: ctx.tenantId, version }, data: {
      status: "cancelled", version: { increment: 1 }, events: { create: { version: version + 1, kind: "request_cancelled", detail: {} } },
    }, include: { plan: true } });
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, action: "billing.purchase.cancelled",
      resource: "subscription", resourceId: id, requestId, detail: {} } });
    return { status: 200, body: subDto(updated) };
  });
}

export async function scheduleTrialCancellation(ctx: Context, id: string, version: number, effectiveAt: Date, key: string | null, requestId: string, reason?: string) {
  return billingChange(ctx, "billing:trial-schedule:" + ctx.tenantId + ":" + id, key,
    { id, version, effectiveAt: effectiveAt.toISOString(), ...(reason ? { reason } : {}) }, async tx => {
      await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
      const row = await tx.billingSubscription.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { plan: true } });
      if (!row) fail(404, "NOT_FOUND", "구독을 찾을 수 없습니다.");
      requireVersion({ version }, row);
      const now = new Date();
      const trial = row.planId === "trial" && row.status === "trialing", paid = row.status === "active";
      if ((!trial && !paid) || !row.periodEnd || row.periodEnd <= now || (row.cancelAt && row.cancelAt <= now))
        fail(409, "SUBSCRIPTION_UNAVAILABLE", "종료 예약할 수 있는 구독이 없습니다.");
      if (effectiveAt <= now || effectiveAt > row.periodEnd)
        fail(422, "INVALID_CANCEL_DATE", "구독 기간 안의 미래 시각을 선택해주세요.");
      if (row.cancelAt?.getTime() === effectiveAt.getTime()) fail(409, "ALREADY_SCHEDULED", "이미 같은 시각으로 예약되었습니다.");
      const updated = await tx.billingSubscription.update({ where: { id, tenantId: ctx.tenantId, version }, data: {
        cancelAt: effectiveAt, version: { increment: 1 },
        events: { create: { version: version + 1, kind: trial ? "trial_cancel_scheduled" : "cancel_scheduled", detail: { effectiveAt: effectiveAt.toISOString(), ...(reason ? { reason } : {}) } } },
      }, include: { plan: true } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, action: "billing." + (trial ? "trial." : "") + "cancel_scheduled",
        resource: "subscription", resourceId: id, requestId, detail: { effectiveAt: effectiveAt.toISOString(), ...(reason ? { reason } : {}) } } });
      const cutoff = new Date(Math.min(effectiveAt.getTime(), row.periodEnd.getTime(), row.cancelAt?.getTime() ?? Infinity));
      return { status: 200, body: subDto(updated), finalCheck: () => assertSubscriptionDeadline(cutoff) };
    });
}

export async function undoTrialCancellation(ctx: Context, id: string, version: number, key: string | null, requestId: string) {
  return billingChange(ctx, "billing:trial-undo:" + ctx.tenantId + ":" + id, key, { id, version }, async tx => {
    await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
    const row = await tx.billingSubscription.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { plan: true } });
    if (!row) fail(404, "NOT_FOUND", "구독을 찾을 수 없습니다.");
    requireVersion({ version }, row);
    const trial = row.planId === "trial" && row.status === "trialing", paid = row.status === "active";
    if ((!trial && !paid) || !row.cancelAt || !row.periodEnd || row.cancelAt <= new Date() || row.periodEnd <= new Date())
      fail(409, "SUBSCRIPTION_UNAVAILABLE", "취소할 종료 예약이 없습니다.");
    const updated = await tx.billingSubscription.update({ where: { id, tenantId: ctx.tenantId, version }, data: {
      cancelAt: null, version: { increment: 1 },
      events: { create: { version: version + 1, kind: trial ? "trial_cancel_revoked" : "cancel_revoked", detail: {} } },
    }, include: { plan: true } });
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, action: "billing." + (trial ? "trial." : "") + "cancel_revoked",
      resource: "subscription", resourceId: id, requestId, detail: {} } });
    const cutoff = new Date(Math.min(row.cancelAt.getTime(), row.periodEnd.getTime()));
    return { status: 200, body: subDto(updated), finalCheck: () => assertSubscriptionDeadline(cutoff) };
  });
}
