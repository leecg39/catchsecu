import { securityCapabilities, securityCapabilityLabels, type SecurityCapability, type SecurityEntitlements } from "@/contracts/feature-entitlements";
import type { Transaction } from "./db";
import { fail } from "./http";

/** Call after actor/company locks. Subscription revocation cannot race a configuration write. */
export async function lockSecurityEntitlements(tx: Transaction, tenantId: string) {
  await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE "tenantId"=${tenantId} ORDER BY id FOR SHARE`;
  const rows = await tx.billingSubscription.findMany({ where: { tenantId }, include: { planVersion: true } });
  const snapshot = (): SecurityEntitlements => {
    const now = Date.now();
    const active = rows.filter(row => ["active", "trialing"].includes(row.status) && row.periodStart && row.periodStart.getTime() <= now
      && row.periodEnd && row.periodEnd.getTime() > now && (!row.cancelAt || row.cancelAt.getTime() > now));
    const pending = rows.some(row => row.status === "pending" || (["active", "trialing"].includes(row.status) && row.periodStart && row.periodStart.getTime() > now));
    return Object.fromEntries(securityCapabilities.map(capability => {
      const ends = active.filter(row => row.planVersion.capabilities.includes(capability))
        .map(row => Math.min(row.periodEnd!.getTime(), row.cancelAt?.getTime() ?? Infinity));
      return [capability, { available: ends.length > 0,
        state: ends.length ? "included" : active.length ? "not_included" : !rows.length ? "unsubscribed" : pending ? "pending" : "expired",
        expiresAt: ends.length ? new Date(Math.max(...ends)).toISOString() : null }];
    })) as SecurityEntitlements;
  };
  const assert = (capability: SecurityCapability) => {
    const feature = snapshot()[capability];
    if (!feature.available) fail(402, feature.state === "not_included" ? "FEATURE_NOT_INCLUDED" : "SUBSCRIPTION_REQUIRED",
      feature.state === "not_included" ? securityCapabilityLabels[capability] + " 기능이 현재 구독에 포함되어 있지 않습니다."
        : "유효한 구독이 필요합니다. 현재 보안 설정과 보호는 유지됩니다.");
  };
  return { snapshot, assert };
}
