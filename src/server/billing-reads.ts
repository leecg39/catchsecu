import { z } from "zod";
import { withBillingAccess } from "./billing-access";
import { fail } from "./http";
import type { Context } from "./context";

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  serviceId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
}).strict().refine(input => !input.from || !input.to || input.from <= input.to, "시작일은 종료일 이후여야 합니다.");
export const invoiceQuery = pageQuery;
export const usageEventQuery = pageQuery.extend({
  kind: z.enum(["funding", "reserve", "capture", "release", "refund"]).optional(),
}).strict();
const range = (query: z.infer<typeof pageQuery>) => ({
  ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) });

export async function listInvoices(ctx: Context, raw: unknown) {
  const query = invoiceQuery.parse(raw);
  return withBillingAccess(ctx, "billing.read", async tx => {
    const where = { tenantId: ctx.tenantId, status: "paid", createdAt: range(query) };
    const [rows, total] = await Promise.all([
      tx.paymentOrder.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { subscription: { include: { plan: { select: { name: true } } } },
          method: { select: { kind: true } }, refunds: { where: { status: "refunded" }, select: { amount: true } } } }),
      tx.paymentOrder.count({ where })]);
    return { items: rows.map(row => ({ id: row.id, amount: row.amount, currency: row.currency,
      method: row.method?.kind ?? "none", planName: row.subscription.plan.name,
      periodStart: (row.subscription.periodStart ?? row.createdAt).toISOString(),
      periodEnd: (row.subscription.cancelAt ?? row.subscription.periodEnd ?? row.createdAt).toISOString(),
      refundedAmount: row.refunds.reduce((sum, refund) => sum + refund.amount, 0),
      invoiceAvailable: true, createdAt: row.createdAt.toISOString() })), total, page: query.page, pageSize: query.pageSize };
  });
}
export async function listUsageEvents(ctx: Context, raw: unknown) {
  const query = usageEventQuery.parse(raw);
  return withBillingAccess(ctx, "billing.read", async tx => {
    const where = { tenantId: ctx.tenantId, ...(query.kind ? { kind: query.kind } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}), createdAt: range(query) };
    if (query.serviceId && !(await tx.service.count({ where: { tenantId: ctx.tenantId, id: query.serviceId } })))
      fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    const [rows, total] = await Promise.all([
      tx.ledgerTransaction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { entries: { select: { account: true, amount: true } }, service: { select: { name: true } } } }),
      tx.ledgerTransaction.count({ where })]);
    return { items: rows.map(row => ({ id: row.id, kind: row.kind, sourceKind: row.sourceKind, sourceId: row.sourceId,
      serviceId: row.serviceId, serviceName: row.service?.name ?? null, amount: Number(row.amount), currency: row.currency,
      reservationId: row.reservationId, entries: row.entries.map(entry => ({ account: entry.account, amount: Number(entry.amount) })),
      createdAt: row.createdAt.toISOString() })), total, page: query.page, pageSize: query.pageSize };
  });
}
