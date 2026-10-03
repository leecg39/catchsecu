import type { Transaction } from "./db";
import { fail } from "./http";

type Resource = "services" | "members" | "subjects" | "forms";
/** Serialize resource creation for one company before checking the persisted allowance. */
export async function assertQuota(tx: Transaction, tenantId: string, resource: Resource, reserveInvitation = false) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"entitlement:" + tenantId}, 0))`;
  const subscriptions = await tx.billingSubscription.findMany({ where: { tenantId }, include: { planVersion: true } });
  // Old test fixtures use direct Company inserts. Production creation and the backfill always attach a trial.
  if (!subscriptions.length) return;
  const now = new Date();
  const active = subscriptions.find(row => row.status === "trialing" && row.periodStart && row.periodStart <= now && row.periodEnd && row.periodEnd > now
    && (!row.cancelAt || row.cancelAt > now));
  if (!active) fail(402, "SUBSCRIPTION_REQUIRED", "이용 가능한 구독이 없습니다. 구독 정보를 확인해주세요.");
  const limit = { services: active.planVersion.serviceLimit, members: active.planVersion.memberLimit,
    subjects: active.planVersion.subjectLimit, forms: active.planVersion.formLimit }[resource];
  if (limit === null) return;
  const count = resource === "services" ? await tx.service.count({ where: { tenantId, status: "active" } })
    : resource === "members" ? await tx.membership.count({ where: { tenantId, status: "active" } })
    : resource === "subjects" ? await tx.dataSubject.count({ where: { tenantId } })
    : await tx.form.count({ where: { tenantId, status: { not: "deleted" }, sourceType: "form" } });
  const pending = resource === "members" && reserveInvitation ? await tx.invitation.count({ where: { tenantId, status: "pending", expiresAt: { gt: now } } }) : 0;
  if (count + pending >= limit) fail(409, "QUOTA_EXCEEDED", "현재 구독의 이용 한도에 도달했습니다.");
}
