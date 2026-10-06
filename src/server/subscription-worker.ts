import { db } from "./db";
import { randomUUID } from "node:crypto";
import { audit } from "./audit";

/** 무료·유료 구독의 종료를 작은 배치로 저장한다. 조회 권한은 워커 실행 전에도 기한을 검사한다. */
export async function expireSubscriptions() {
  return db.$transaction(async tx => {
    const due = await tx.$queryRaw<{ id: string; tenantId: string; version: number; status: string; cancelAt: Date | null }[]>`
      SELECT id, "tenantId", version, status, "cancelAt" FROM "BillingSubscription"
      WHERE status IN ('trialing','active')
        AND LEAST(COALESCE("cancelAt", "periodEnd"), "periodEnd") <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      ORDER BY LEAST(COALESCE("cancelAt", "periodEnd"), "periodEnd"), id FOR UPDATE SKIP LOCKED LIMIT 100`;
    for (const row of due) {
      const kind = row.status === "trialing" ? "trial_expired" : "expired";
      await tx.billingSubscription.update({ where: { id: row.id, version: row.version }, data: {
        status: "expired", version: { increment: 1 },
        events: { create: { version: row.version + 1, kind, detail: { reason: row.cancelAt ? "scheduled_cancel" : "period_end" } } },
      } });
      await audit(tx, { tenantId: row.tenantId, user: { id: null } }, randomUUID(), "billing." + kind, "subscription", row.id, ["status"]);
    }
    return due.length;
  });
}
