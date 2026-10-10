import { db } from "@/server/db";
import { env } from "@/server/env";

/** Explicit persisted trial for old direct-company test fixtures; never a production bypass. */
export async function grantSecurityTestTrials() {
  const url = new URL(env.DATABASE_URL);
  if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
  const companies = await db.company.findMany({ where: { subscriptions: { none: {} } }, select: { id: true } });
  for (const company of companies) {
    const periodStart = new Date();
    await db.billingSubscription.create({ data: { tenantId: company.id, planId: "trial", planVersionId: "trial-v1", status: "trialing",
      priceKrw: 0, currency: "KRW", activationSource: "trial", periodStart, periodEnd: new Date(periodStart.getTime() + 7 * 86400000) } });
  }
}
