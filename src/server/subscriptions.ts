import { db } from "./db";
import { fail, requireVersion } from "./http";
import { idempotent } from "./idempotency";
import type { Context } from "./context";
import { roleCan } from "./permissions";
import type { PlanRecord, SubscriptionRecord, EntitlementRecord, AssetOverview } from "@/contracts/subscriptions";

function billingRead(ctx: Context) { if (!roleCan(ctx.member.role, "billing.read")) fail(403, "FORBIDDEN", "결제 정보를 볼 권한이 없습니다."); }
function billingWrite(ctx: Context) { if (!roleCan(ctx.member.role, "billing.write")) fail(403, "FORBIDDEN", "구독을 변경할 권한이 없습니다."); }

export async function plans(ctx: Context): Promise<PlanRecord[]> {
  billingRead(ctx);
  const rows = await db.billingPlan.findMany({ include: { versions: { orderBy: [{ number: "desc" }, { cycle: "asc" }] } }, orderBy: { createdAt: "asc" } });
  return rows.map(p => ({ id: p.id, name: p.name, description: p.description,
    versions: p.versions.map(v => ({ id: v.id, number: v.number, cycle: v.cycle, priceKrw: v.priceKrw,
      currency: v.currency, serviceLimit: v.serviceLimit, memberLimit: v.memberLimit,
      subjectLimit: v.subjectLimit, formLimit: v.formLimit,
      orderable: v.orderable && v.effectiveFrom <= new Date() && (!v.effectiveTo || v.effectiveTo > new Date()),
      effectiveFrom: v.effectiveFrom.toISOString(), effectiveTo: v.effectiveTo?.toISOString() ?? null })) }));
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
  billingRead(ctx);
  const rows = await db.billingSubscription.findMany({ where: { tenantId: ctx.tenantId }, include: { plan: true }, orderBy: { createdAt: "desc" } });
  return rows.map(subDto);
}
export async function entitlement(ctx: Context): Promise<EntitlementRecord> {
  billingRead(ctx);
  const now = new Date();
  const [current, services, members, subjects, forms] = await Promise.all([
    db.billingSubscription.findFirst({ where: { tenantId: ctx.tenantId, status: { in: ["trialing", "active"] }, periodStart: { lte: now }, periodEnd: { gt: now },
      OR: [{ cancelAt: null }, { cancelAt: { gt: now } }] }, include: { planVersion: true }, orderBy: { periodEnd: "desc" } }),
    db.service.count({ where: { tenantId: ctx.tenantId, status: "active" } }),
    db.membership.count({ where: { tenantId: ctx.tenantId, status: "active" } }),
    db.dataSubject.count({ where: { tenantId: ctx.tenantId } }),
    db.form.count({ where: { tenantId: ctx.tenantId, status: { not: "deleted" }, sourceType: "form" } }),
  ]);
  return { active: !!current, status: current?.status ?? "expired", periodEnd: current?.cancelAt?.toISOString() ?? current?.periodEnd?.toISOString() ?? null,
    limits: { services: current?.planVersion.serviceLimit ?? null, members: current?.planVersion.memberLimit ?? null,
      subjects: current?.planVersion.subjectLimit ?? null, forms: current?.planVersion.formLimit ?? null },
    usage: { services, members, subjects, forms } };
}
export async function assetOverview(ctx: Context): Promise<AssetOverview> {
  billingRead(ctx);
  const [current, services] = await Promise.all([
    entitlement(ctx),
    db.service.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, status: true, _count: { select: {
        forms: { where: { sourceType: "form", status: { not: "deleted" } } }, dataSubjects: true,
      } } } }),
  ]);
  return { entitlement: current, services: services.map(service => ({ id: service.id, name: service.name,
    status: service.status, forms: service._count.forms, subjects: service._count.dataSubjects })) };
}
export async function requestPurchase(ctx: Context, planVersionId: string, key: string | null, requestId: string) {
  billingWrite(ctx);
  return idempotent("billing:purchase:" + ctx.tenantId, key, { planVersionId }, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"billing:" + ctx.tenantId}, 0))`;
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
    return { status: 202, body: subDto(created) };
  });
}
export async function cancelPurchase(ctx: Context, id: string, version: number, key: string | null, requestId: string) {
  billingWrite(ctx);
  return idempotent("billing:cancel:" + ctx.tenantId + ":" + id, key, { id, version }, async tx => {
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
  billingWrite(ctx);
  return idempotent("billing:trial-schedule:" + ctx.tenantId + ":" + id, key,
    { id, version, effectiveAt: effectiveAt.toISOString() }, async tx => {
      await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
      const row = await tx.billingSubscription.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { plan: true } });
      if (!row) fail(404, "NOT_FOUND", "체험 구독을 찾을 수 없습니다.");
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
      return { status: 200, body: subDto(updated) };
    });
}

export async function undoTrialCancellation(ctx: Context, id: string, version: number, key: string | null, requestId: string) {
  billingWrite(ctx);
  return idempotent("billing:trial-undo:" + ctx.tenantId + ":" + id, key, { id, version }, async tx => {
    await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
    const row = await tx.billingSubscription.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { plan: true } });
    if (!row) fail(404, "NOT_FOUND", "구독을 찾을 수 없습니다.");
    requireVersion({ version }, row);
    const trial = row.planId === "trial" && row.status === "trialing", paid = row.status === "active";
    if ((!trial && !paid) || !row.cancelAt || row.cancelAt <= new Date())
      fail(409, "SUBSCRIPTION_UNAVAILABLE", "취소할 종료 예약이 없습니다.");
    const updated = await tx.billingSubscription.update({ where: { id, tenantId: ctx.tenantId, version }, data: {
      cancelAt: null, version: { increment: 1 },
      events: { create: { version: version + 1, kind: trial ? "trial_cancel_revoked" : "cancel_revoked", detail: {} } },
    }, include: { plan: true } });
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, action: "billing." + (trial ? "trial." : "") + "cancel_revoked",
      resource: "subscription", resourceId: id, requestId, detail: {} } });
    return { status: 200, body: subDto(updated) };
  });
}
