import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { roleCan } from "./permissions";
import { idempotent } from "./idempotency";
import { renderPdf } from "./pdf-renderer";
import type { PaymentRefund } from "@/generated/prisma/client";
import type { MonthCloseRecord, RefundRecord } from "@/contracts/billing-settlement";

const billingRead = (ctx: Context) => { if (!roleCan(ctx.member.role, "billing.read")) fail(403, "FORBIDDEN", "결제 정보를 볼 권한이 없습니다."); };
const billingWrite = (ctx: Context) => { if (!roleCan(ctx.member.role, "billing.write")) fail(403, "FORBIDDEN", "결제를 변경할 권한이 없습니다."); };
const refundDto = (row: PaymentRefund): RefundRecord => ({ id: row.id, orderId: row.orderId, amount: row.amount, currency: row.currency,
  reason: row.reason, status: row.status as RefundRecord["status"], version: row.version, createdAt: row.createdAt.toISOString() });

async function paidOrder(tx: Transaction, ctx: Context, orderId: string) {
  const order = await tx.paymentOrder.findFirst({ where: { id: orderId, tenantId: ctx.tenantId } });
  if (!order) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
  return order;
}

export async function requestRefund(ctx: Context, orderId: string, input: { amount: number; reason: string }, key: string | null, requestId: string) {
  billingWrite(ctx);
  return idempotent("billing:refund:" + ctx.tenantId + ":" + orderId, key, { orderId, ...input }, async tx => {
    const order = await paidOrder(tx, ctx, orderId);
    if (order.status !== "paid") fail(409, "ORDER_NOT_PAID", "결제 완료된 주문만 환불할 수 있습니다.");
    // 주문 행을 잠근 뒤 누계를 확인한다 — 동시 환불 요청이 결제액을 초과하지 못하게 직렬화.
    await tx.$executeRaw`SELECT id FROM "PaymentOrder" WHERE id=${order.id} FOR UPDATE`;
    const settled = await tx.paymentRefund.aggregate({ _sum: { amount: true },
      where: { orderId: order.id, tenantId: ctx.tenantId, status: { in: ["requested", "refunded"] } } });
    if ((settled._sum.amount ?? 0) + input.amount > order.amount)
      fail(409, "REFUND_EXCEEDS_PAID", "환불 누계가 결제 금액을 초과할 수 없습니다.");
    const row = await tx.paymentRefund.create({ data: { tenantId: ctx.tenantId, orderId: order.id,
      amount: input.amount, currency: order.currency, reason: input.reason } });
    await audit(tx, ctx, requestId, "billing.refund_requested", "paymentRefund", row.id, ["amount"]);
    return { status: 201, body: refundDto(row) };
  });
}

export async function listRefunds(ctx: Context, orderId: string) {
  billingRead(ctx);
  const order = await db.paymentOrder.findFirst({ where: { id: orderId, tenantId: ctx.tenantId } });
  if (!order) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
  const rows = await db.paymentRefund.findMany({ where: { orderId: order.id, tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } });
  const refundedTotal = rows.filter(r => r.status === "refunded").reduce((sum, r) => sum + r.amount, 0);
  return { items: rows.map(refundDto), refundedTotal, refundable: order.amount - refundedTotal };
}

export async function invoicePdf(ctx: Context, orderId: string) {
  billingRead(ctx);
  const order = await db.paymentOrder.findFirst({ where: { id: orderId, tenantId: ctx.tenantId },
    include: { subscription: { include: { plan: true, planVersion: true } }, refunds: true } });
  if (!order) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
  if (order.status !== "paid") fail(409, "INVOICE_UNAVAILABLE", "결제 완료된 주문만 청구서를 발행할 수 있습니다.");
  const paid = await db.paymentEvent.findFirst({ where: { orderId: order.id, outcome: "paid" } });
  const refunded = order.refunds.filter(r => r.status === "refunded").reduce((s, r) => s + r.amount, 0);
  const won = (n: number) => n.toLocaleString("ko-KR") + "원";
  const lines = [
    `주문 번호: ${order.id}`,
    `구독 상품: ${order.subscription.plan.name} (${order.subscription.planVersion.cycle === "year" ? "연간" : "월간"})`,
    `공급가액: ${won(Math.floor(order.amount / 1.1))}`,
    `부가세: ${won(order.amount - Math.floor(order.amount / 1.1))}`,
    `합계: ${won(order.amount)} (${order.currency})`,
    `결제 승인 시각: ${(paid?.createdAt ?? order.updatedAt).toISOString()}`,
    `환불 누계: ${won(refunded)}`,
    `실결제 잔액: ${won(order.amount - refunded)}`,
    "",
    `주문 상태: ${order.status} / 청구서 발행 시각: ${new Date().toISOString()}`,
  ].join("\n");
  const pdf = await renderPdf({ title: `청구서 ${order.id}`, author: "Catchsecu", text: lines,
    contentHash: order.id, version: order.version, publishedAt: paid?.createdAt ?? order.updatedAt, label: "청구서" });
  return { bytes: pdf.bytes, name: `invoice-${order.id}.pdf`, hash: pdf.pdfHash };
}

type KindTotals = { funded: bigint; refunded: bigint; reservedNet: bigint; captured: bigint; released: bigint };
async function monthTotals(tx: Transaction, ctx: Context, month: string, currency: string, before?: Date): Promise<KindTotals> {
  const start = new Date(month + "-01T00:00:00Z"), end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const rows = await tx.ledgerTransaction.findMany({ where: { tenantId: ctx.tenantId, currency,
    createdAt: { gte: start, lt: end, ...(before ? { lt: before } : {}) } }, select: { kind: true, amount: true } });
  const totals: KindTotals = { funded: BigInt(0), refunded: BigInt(0), reservedNet: BigInt(0), captured: BigInt(0), released: BigInt(0) };
  for (const row of rows) {
    if (row.kind === "funding") totals.funded += row.amount;
    else if (row.kind === "refund") totals.refunded += row.amount;
    else if (row.kind === "reserve") totals.reservedNet += row.amount;
    else if (row.kind === "capture") { totals.captured += row.amount; totals.reservedNet -= row.amount; }
    else if (row.kind === "release") { totals.released += row.amount; totals.reservedNet -= row.amount; }
  }
  return totals;
}
const totalsJson = (t: KindTotals) => ({ funded: t.funded.toString(), refunded: t.refunded.toString(),
  reservedNet: t.reservedNet.toString(), captured: t.captured.toString(), released: t.released.toString() });

export async function readMonthClose(ctx: Context, month: string, currency: string): Promise<MonthCloseRecord> {
  billingRead(ctx);
  const close = await db.billingMonthClose.findUnique({ where: { tenantId_month_currency: { tenantId: ctx.tenantId, month, currency } } });
  const live = await db.$transaction(tx => monthTotals(tx, ctx, month, currency));
  if (!close)
    return { month, currency, closed: false, closedAt: null, totals: totalsJson(live), postCloseAdjustments: 0 };
  // 사후 정정 = 닫힌 월에 귀속하지만 마감 시각 이후에 기록된 거래. 원장은 불변이라 기록 시각은 감사 이벤트로 본다.
  const monthStart = new Date(month + "-01T00:00:00Z"), monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const counted = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "LedgerTransaction" t
    JOIN "AuditEvent" a ON a."resourceId" = t.id AND a.resource = 'ledgerTransaction'
    WHERE t."tenantId" = ${ctx.tenantId} AND t.currency = ${currency}
      AND t."createdAt" >= ${monthStart} AND t."createdAt" < ${monthEnd}
      AND a."createdAt" > ${close.closedAt}`;
  return { month, currency, closed: true, closedAt: close.closedAt.toISOString(),
    totals: close.totals as MonthCloseRecord["totals"], postCloseAdjustments: Number(counted[0]?.n ?? 0) };
}

export async function closeMonth(ctx: Context, month: string, currency: string, key: string | null, requestId: string) {
  billingWrite(ctx);
  const current = new Date().toISOString().slice(0, 7);
  if (month >= current) fail(422, "MONTH_NOT_CLOSED_YET", "지난달까지만 마감할 수 있습니다.");
  return idempotent("billing:close:" + ctx.tenantId + ":" + month + ":" + currency, key, { month, currency }, async tx => {
    const existing = await tx.billingMonthClose.findUnique({ where: { tenantId_month_currency: { tenantId: ctx.tenantId, month, currency } } });
    if (existing) return { status: 200, body: { month, currency, closed: true, closedAt: existing.closedAt.toISOString(), totals: existing.totals, postCloseAdjustments: 0 } };
    const totals = totalsJson(await monthTotals(tx, ctx, month, currency));
    const row = await tx.billingMonthClose.create({ data: { tenantId: ctx.tenantId, month, currency, totals, closedBy: ctx.member.id } });
    await audit(tx, ctx, requestId, "billing.month_closed", "billingMonthClose", row.id, []);
    return { status: 201, body: { month, currency, closed: true, closedAt: row.closedAt.toISOString(), totals, postCloseAdjustments: 0 } };
  });
}
