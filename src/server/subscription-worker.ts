import { db } from "./db";
import { randomUUID } from "node:crypto";
import { audit } from "./audit";

/** Persist elapsed trial boundaries in small, row-locked batches. Reads enforce the boundary independently. */
export async function expireTrials() {
  return db.$transaction(async tx => {
    const now = new Date();
    const due = await tx.$queryRaw<{ id: string; tenantId: string; version: number; cancelAt: Date | null }[]>`
      SELECT id, "tenantId", version, "cancelAt" FROM "BillingSubscription"
      WHERE status='trialing' AND LEAST(COALESCE("cancelAt", "periodEnd"), "periodEnd")<=${now}
      ORDER BY "periodEnd", id FOR UPDATE SKIP LOCKED LIMIT 100`;
    for (const row of due) {
      await tx.billingSubscription.update({ where: { id: row.id, version: row.version }, data: {
        status: "expired", version: { increment: 1 },
        events: { create: { version: row.version + 1, kind: "trial_expired", detail: { reason: row.cancelAt ? "scheduled_cancel" : "period_end" } } },
      } });
      await audit(tx, { tenantId: row.tenantId, user: { id: null } }, randomUUID(), "billing.trial_expired", "subscription", row.id, ["status"]);
    }
    return due.length;
  });
}
