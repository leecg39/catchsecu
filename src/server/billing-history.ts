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
  const where = {
    tenantId: ctx.tenantId,
    planId: "trial",
    status: { in: ["trialing", "expired"] },
    periodStart: {
      ...(query.fromMonth ? { gte: koreaMonthStart(query.fromMonth) } : {}),
      ...(query.toMonth ? { lt: koreaMonthStart(query.toMonth, true) } : {}),
    },
  };
  const [total, rows] = await db.$transaction([
    db.billingSubscription.count({ where }),
    db.billingSubscription.findMany({ where, include: { plan: { select: { name: true } } },
      orderBy: [{ periodStart: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const now = new Date();
  return { total, page: query.page, pageSize: query.pageSize, items: rows.map(row => ({
    id: row.id,
    occurredAt: (row.periodStart ?? row.createdAt).toISOString(),
    kind: "trial_started" as const,
    status: row.status === "expired" || (row.cancelAt ?? row.periodEnd)! <= now ? "expired" as const : "trialing" as const,
    method: "none" as const,
    amountKrw: 0 as const,
    planName: row.plan.name,
    periodStart: row.periodStart!.toISOString(),
    periodEnd: (row.cancelAt ?? row.periodEnd)!.toISOString(),
  })) };
}
