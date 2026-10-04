import type { BillingHistoryList, BillingHistoryQuery } from "@/contracts/billing-history";
import { Prisma } from "@/generated/prisma/client";
import type { Context } from "./context";
import { db } from "./db";
import { fail } from "./http";
import { roleCan } from "./permissions";

// Subscription timestamps are UTC in the database. The original billing filters
// select calendar months in Korea, including the first midnight of each month.
function koreaMonthStart(month: string, next = false) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + Number(next), 1) - 9 * 3600000);
}

export async function billingHistory(ctx: Context, query: BillingHistoryQuery): Promise<BillingHistoryList> {
  if (!roleCan(ctx.member.role, "billing.read")) fail(403, "FORBIDDEN", "결제 내역을 볼 권한이 없습니다.");
  if (query.fromMonth && query.toMonth && query.fromMonth > query.toMonth)
    fail(422, "INVALID_PERIOD", "조회 시작 월은 종료 월보다 늦을 수 없습니다.");
  const period = {
    ...(query.fromMonth ? { gte: koreaMonthStart(query.fromMonth) } : {}),
    ...(query.toMonth ? { lt: koreaMonthStart(query.toMonth, true) } : {}),
  };
  const where = { tenantId: ctx.tenantId, planId: "trial", status: { in: ["trialing", "expired"] }, periodStart: period };
  const orderWhere = { tenantId: ctx.tenantId, createdAt: period };
  const now = new Date();
  const [trials, orders, refunds] = await db.$transaction([
    db.billingSubscription.findMany({ where, include: { plan: { select: { name: true } } } }),
    db.paymentOrder.findMany({ where: orderWhere,
      include: { subscription: { include: { plan: { select: { name: true } } } }, method: { select: { kind: true } } } }),
    db.paymentRefund.findMany({ where: orderWhere, include: { order: { include: { subscription: { include: { plan: { select: { name: true } } } } } } } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const items = [
    ...trials.map(row => ({
      id: row.id, occurredAt: (row.periodStart ?? row.createdAt).toISOString(), kind: "trial_started" as const,
      status: (row.status === "expired" || (row.cancelAt ?? row.periodEnd)! <= now ? "expired" : "trialing") as "trialing" | "expired",
      method: "none" as const, amountKrw: 0, planName: row.plan.name,
      periodStart: row.periodStart!.toISOString(), periodEnd: (row.cancelAt ?? row.periodEnd)!.toISOString() })),
    ...orders.map(row => ({
      id: row.id, orderId: row.id, occurredAt: row.createdAt.toISOString(), kind: "payment" as const,
      status: row.status as "paid" | "pending" | "failed",
      method: (row.method?.kind ?? "none") as "card" | "transfer" | "none", amountKrw: row.amount, planName: row.subscription.plan.name,
      periodStart: (row.subscription.periodStart ?? row.createdAt).toISOString(), periodEnd: (row.subscription.cancelAt ?? row.subscription.periodEnd ?? row.createdAt).toISOString() })),
    ...refunds.map(row => ({
      id: row.id, orderId: row.orderId, occurredAt: row.createdAt.toISOString(), kind: "refund" as const,
      status: row.status as "requested" | "refunded" | "rejected", method: "none" as const, amountKrw: -row.amount,
      planName: row.order.subscription.plan.name, reason: row.reason,
      periodStart: (row.order.subscription.periodStart ?? row.createdAt).toISOString(), periodEnd: (row.order.subscription.cancelAt ?? row.order.subscription.periodEnd ?? row.createdAt).toISOString() })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
  const total = items.length;
  return { total, page: query.page, pageSize: query.pageSize, items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) };
}
