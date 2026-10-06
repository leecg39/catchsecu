import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentOrder } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { lockBillingActor, withBillingAccess } from "./billing-access";
import { assertFileDeadlines } from "./file-access";
import { idempotent } from "./idempotency";
import { postLedgerTransfer } from "./ledger";
import { env } from "./env";

const providerEvent = z.object({
  orderId: z.uuid(),
  eventId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
  outcome: z.enum(["paid", "failed", "refunded", "refund_rejected"]),
  refundId: z.uuid().optional(),
}).strict();
export type PaymentOrderRecord = { id: string; subscriptionId: string; methodId: string | null; amount: number; currency: string; status: "pending" | "paid" | "failed"; version: number };

function dto(row: PaymentOrder): PaymentOrderRecord {
  return { id: row.id, subscriptionId: row.subscriptionId, methodId: row.methodId, amount: row.amount, currency: row.currency, status: row.status as PaymentOrderRecord["status"], version: row.version };
}
async function createPaymentOrder(tx: Transaction, ctx: Context, subscriptionId: string, requestId: string, methodId?: string) {
  await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE id=${subscriptionId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  const subscription = await tx.billingSubscription.findFirst({ where: { id: subscriptionId, tenantId: ctx.tenantId } });
  if (!subscription || subscription.status !== "pending" || subscription.priceKrw === null) fail(409, "ORDER_UNAVAILABLE", "결제할 수 있는 대기 구독이 없습니다.");
  if (methodId !== undefined) {
    const method = await tx.paymentMethod.findFirst({ where: { id: methodId, tenantId: ctx.tenantId } });
    if (!method) fail(404, "NOT_FOUND", "결제수단을 찾을 수 없습니다.");
    if (method.status !== "active") fail(409, "METHOD_INACTIVE", "해지된 결제수단으로는 결제할 수 없습니다.");
  }
  const existing = await tx.paymentOrder.findFirst({ where: { tenantId: ctx.tenantId, subscriptionId, status: "pending" } });
  if (existing) {
    if (existing.methodId !== (methodId ?? null)) fail(409, "ORDER_METHOD_CONFLICT", "다른 결제수단의 대기 주문이 있습니다. 기존 주문을 확인해주세요.");
    return dto(existing);
  }
  const row = await tx.paymentOrder.create({ data: { tenantId: ctx.tenantId, subscriptionId, methodId: methodId ?? null, amount: subscription.priceKrw, currency: subscription.currency } });
  await audit(tx, ctx, requestId, "billing.order_created", "paymentOrder", row.id, ["amount", "methodId"], undefined);
  return dto(row);
}
export async function requestPaymentOrder(ctx: Context, input: { subscriptionId: string; methodId?: string }, key: string | null, requestId: string) {
  let deadlines: Awaited<ReturnType<typeof lockBillingActor>>["deadlines"];
  const authorize = async (tx: Transaction) => { deadlines = (await lockBillingActor(tx, ctx, "billing.write")).deadlines; };
  return idempotent("billing-order:" + ctx.tenantId, key, input, async tx => {
    await authorize(tx);
    const row = await createPaymentOrder(tx, ctx, input.subscriptionId, requestId, input.methodId);
    return { status: 201, body: row, resource: { tenantId: ctx.tenantId, resourceType: "payment-order" as const, resourceId: row.id } };
  }, authorize, async (tx, cached) => {
    await tx.$queryRaw`SELECT id FROM "PaymentOrder" WHERE id=${cached.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const row = await tx.paymentOrder.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId } });
    if (!row) fail(410, "ORDER_UNAVAILABLE", "기존 결제 주문을 찾을 수 없습니다.");
    return dto(row);
  }, async () => { assertFileDeadlines(deadlines); });
}
export type PaymentOrderListItem = PaymentOrderRecord & { planName: string; refundedTotal: number };
export async function listPaymentOrders(ctx: Context) {
  return withBillingAccess(ctx, "billing.read", async tx => {
    const rows = await tx.paymentOrder.findMany({ where: { tenantId: ctx.tenantId },
      include: { subscription: { include: { plan: { select: { name: true } } } }, refunds: { where: { status: "refunded" }, select: { amount: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
    return { items: rows.map(row => ({ ...dto(row), planName: row.subscription.plan.name,
      refundedTotal: row.refunds.reduce((sum, r) => sum + r.amount, 0) })),
      virtual: virtualPaymentEnabled() };
  });
}
export async function readPaymentOrder(ctx: Context, id: string) {
  return withBillingAccess(ctx, "billing.read", async tx => {
    const row = await tx.paymentOrder.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
    return dto(row);
  });
}
export async function rejectPaymentReturn(ctx: Context, id: string) {
  return withBillingAccess(ctx, "billing.write", async tx => {
    const row = await tx.paymentOrder.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
    if (row.status === "pending") fail(409, "PAYMENT_UNCONFIRMED", "결제 성공 주소만으로는 결제를 확정할 수 없습니다.");
    return dto(row);
  });
}
// ---- 가상 PG(local mock) ----
// PAYMENT_PROVIDER=local일 때만 동작한다. 서버가 내부 서명 이벤트를 발행해 실제
// 웹훅과 동일한 서명 검증·이벤트 적용 함수를 사용하며, 호출자의 권한 잠금·감사·
// 최종 기한 검사가 끝날 때까지 같은 트랜잭션을 유지한다.
// providerEventId의 "vpg:" 접두사로 실제 공급자 이벤트와 구분된다.
export const virtualPaymentEnabled = () => env.PAYMENT_PROVIDER === "local";
const virtualSecret = () => env.PAYMENT_WEBHOOK_SECRET
  ?? createHmac("sha256", env.DATA_ENCRYPTION_KEY).update("virtual-pg-signing").digest("hex");
async function applyVirtualEvent(tx: Transaction, orderId: string, outcome: "paid" | "failed" | "refunded" | "refund_rejected", refundId: string | undefined, requestId: string) {
  const event = JSON.stringify({ orderId, eventId: "vpg:" + randomUUID(), outcome, ...(refundId ? { refundId } : {}) });
  const signature = createHmac("sha256", virtualSecret()).update(event).digest("hex");
  return applyParsedPaymentEvent(tx, parsePaymentEvent(event, signature, virtualSecret()), requestId);
}
export async function virtualPaymentCheckout(ctx: Context, orderId: string, outcome: "paid" | "failed", requestId: string) {
  if (!virtualPaymentEnabled()) fail(404, "NOT_FOUND", "가상 결제가 설정되지 않았습니다.");
  return withBillingAccess(ctx, "billing.write", async tx => {
    const row = await tx.paymentOrder.findFirst({ where: { id: orderId, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
    if (row.status !== "pending") fail(409, "OUT_OF_ORDER", "이미 종료된 결제입니다.");
    const result = await applyVirtualEvent(tx, orderId, outcome, undefined, requestId);
    await audit(tx, ctx, requestId, "billing.virtual_checkout", "paymentOrder", orderId, ["status"]);
    return result;
  });
}
export async function virtualRefundSettle(ctx: Context, refundId: string, outcome: "refunded" | "refund_rejected", requestId: string) {
  if (!virtualPaymentEnabled()) fail(404, "NOT_FOUND", "가상 결제가 설정되지 않았습니다.");
  return withBillingAccess(ctx, "billing.write", async tx => {
    const refund = await tx.paymentRefund.findFirst({ where: { id: refundId, tenantId: ctx.tenantId } });
    if (!refund) fail(404, "NOT_FOUND", "환불 요청을 찾을 수 없습니다.");
    if (refund.status !== "requested") fail(409, "OUT_OF_ORDER", "이미 종료된 환불입니다.");
    const result = await applyVirtualEvent(tx, refund.orderId, outcome, refundId, requestId);
    await audit(tx, ctx, requestId, "billing.virtual_refund_settle", "paymentRefund", refundId, ["status"]);
    return result;
  });
}
function signaturesMatch(secret: string, body: string, signature: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected), right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
function parsePaymentEvent(raw: string, signature: string, secret: string | undefined) {
  if (!secret) fail(503, "PAYMENT_PROVIDER_REQUIRED", "결제 결과 수신 비밀이 설정되지 않았습니다.");
  if (/"cardNumber"|"pan"|"cvc"/i.test(raw)) fail(422, "CARD_DATA_REJECTED", "카드 원문은 받을 수 없습니다.");
  if (!signaturesMatch(secret, raw, signature)) fail(401, "PAYMENT_SIGNATURE_INVALID", "결제 결과 서명을 확인할 수 없습니다.");
  return providerEvent.parse(JSON.parse(raw));
}
export async function applyPaymentEvent(raw: string, signature: string, secret: string | undefined, requestId: string = randomUUID()) {
  const input = parsePaymentEvent(raw, signature, secret);
  return db.$transaction(tx => applyParsedPaymentEvent(tx, input, requestId));
}
async function applyParsedPaymentEvent(tx: Transaction, input: z.infer<typeof providerEvent>, requestId: string) {
  const order = await tx.paymentOrder.findUnique({ where: { id: input.orderId } });
  if (!order) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
  const existing = await tx.paymentEvent.findUnique({ where: { providerEventId: input.eventId } });
  if (existing) {
    if (existing.orderId !== order.id || existing.outcome !== input.outcome ||
      (input.refundId && !(await tx.paymentRefund.findFirst({ where: { id: input.refundId, providerRef: input.eventId } }))))
      fail(409, "DUPLICATE_EVENT", "이미 다른 결제 결과가 기록되어 있습니다.");
    const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    return { ...dto(current), duplicate: true };
  }
  const isRefund = input.outcome === "refunded" || input.outcome === "refund_rejected";
  if (isRefund) {
    // 환불 결과는 paid 주문의 요청된 환불에만 적용한다. 주문 상태는 변경하지 않는다.
    if (order.status !== "paid") fail(409, "OUT_OF_ORDER", "결제 완료된 주문에만 환불 결과를 적용할 수 있습니다.");
    if (!input.refundId) fail(422, "REFUND_REQUIRED", "환불 식별자가 필요합니다.");
    const refund = await tx.paymentRefund.findFirst({ where: { id: input.refundId, orderId: order.id, tenantId: order.tenantId } });
    if (!refund) fail(404, "NOT_FOUND", "환불 요청을 찾을 수 없습니다.");
    if (refund.status !== "requested") fail(409, "OUT_OF_ORDER", "이미 종료된 환불입니다.");
    await tx.paymentEvent.create({ data: { orderId: order.id, providerEventId: input.eventId, outcome: input.outcome } });
    const settled = await tx.paymentRefund.update({ where: { id: refund.id },
      data: { status: input.outcome === "refunded" ? "refunded" : "rejected", providerRef: input.eventId, version: { increment: 1 } } });
    if (settled.status === "refunded")
      await postLedgerTransfer(tx, { tenantId: order.tenantId, currency: order.currency, kind: "refund",
        amount: BigInt(refund.amount), sourceKind: "payment_refund", sourceId: refund.id });
    await audit(tx, { tenantId: order.tenantId, user: { id: null } }, requestId, "billing." + input.outcome, "paymentRefund", refund.id, ["status"]);
    const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    return { ...dto(current), duplicate: false };
  }
  if (order.status !== "pending") fail(409, "OUT_OF_ORDER", "이미 종료된 결제에 다른 결과를 적용할 수 없습니다.");
  await tx.paymentEvent.create({ data: { orderId: order.id, providerEventId: input.eventId, outcome: input.outcome } });
  const saved = await tx.paymentOrder.update({ where: { id: order.id }, data: { status: input.outcome, version: { increment: 1 } } });
  await audit(tx, { tenantId: order.tenantId, user: { id: null } }, requestId, "billing.payment_" + input.outcome, "paymentOrder", order.id, ["status"]);
  if (input.outcome === "paid") {
    // 서명된 승인만이 구독을 활성화하고 동액 크레딧을 충전한다 — 같은 트랜잭션으로 원자 커밋.
    const subscription = await tx.billingSubscription.findUnique({ where: { id: order.subscriptionId }, include: { planVersion: true } });
    if (subscription && subscription.status === "pending") {
      const start = new Date(), end = new Date(start);
      if (subscription.planVersion.cycle === "year") end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
      await tx.billingSubscription.update({ where: { id: subscription.id }, data: { status: "active", periodStart: start, periodEnd: end, activationSource: "payment", version: { increment: 1 },
        events: { create: { version: subscription.version + 1, kind: "activated", detail: { orderId: order.id, amount: order.amount } } } } });
    }
    await postLedgerTransfer(tx, { tenantId: order.tenantId, currency: order.currency, kind: "funding",
      amount: BigInt(order.amount), sourceKind: "pg_capture", sourceId: order.id });
  }
  return { ...dto(saved), duplicate: false };
}
