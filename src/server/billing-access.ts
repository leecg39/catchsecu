import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";

export async function lockBillingActor(tx: Transaction, ctx: Context, capability: "billing.read" | "billing.write") {
  // Acquire the stronger lock first: two concurrent SHARE → UPDATE upgrades deadlock.
  // Method removal and order creation use the same company lock.
  if (capability === "billing.write")
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR UPDATE`;
  return lockServiceActor(tx, ctx, capability);
}
export async function withBillingAccess<T>(ctx: Context, capability: "billing.read" | "billing.write", operation: (tx: Transaction) => Promise<T>) {
  return db.$transaction(async tx => {
    const actor = await lockBillingActor(tx, ctx, capability);
    const result = await operation(tx);
    assertFileDeadlines(actor.deadlines);
    return result;
  }, { timeout: 15000 });
}
