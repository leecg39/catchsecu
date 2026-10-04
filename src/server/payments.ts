import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentOrder } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { roleCan } from "./permissions";
import { postLedgerTransfer } from "./ledger";

const providerEvent = z.object({
  orderId: z.uuid(),
  eventId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
  outcome: z.enum(["paid", "failed"]),
}).strict();
export type PaymentOrderRecord = { id: string; subscriptionId: string; methodId: string | null; amount: number; currency: string; status: "pending" | "paid" | "failed"; version: number };

function dto(row: PaymentOrder): PaymentOrderRecord {
  return { id: row.id, subscriptionId: row.subscriptionId, methodId: row.methodId, amount: row.amount, currency: row.currency, status: row.status as PaymentOrderRecord["status"], version: row.version };
}
function billingWrite(ctx: Context) { if (!roleCan(ctx.member.role, "billing.write")) fail(403, "FORBIDDEN", "결제를 변경할 권한이 없습니다."); }
export async function createPaymentOrder(tx: Transaction, ctx: Context, subscriptionId: string, requestId: string, methodId?: string) {
  billingWrite(ctx);
  const subscription = await tx.billingSubscription.findFirst({ where: { id: subscriptionId, tenantId: ctx.tenantId } });
  if (!subscription || subscription.status !== "pending" || subscription.priceKrw === null) fail(409, "ORDER_UNAVAILABLE", "결제할 수 있는 대기 구독이 없습니다.");
  if (methodId !== undefined) {
    const method = await tx.paymentMethod.findFirst({ where: { id: methodId, tenantId: ctx.tenantId } });
    if (!method) fail(404, "NOT_FOUND", "결제수단을 찾을 수 없습니다.");
    if (method.status !== "active") fail(409, "METHOD_INACTIVE", "해지된 결제수단으로는 결제할 수 없습니다.");
  }
  const existing = await tx.paymentOrder.findFirst({ where: { tenantId: ctx.tenantId, subscriptionId, status: "pending" } });
  if (existing) return dto(existing);
  const row = await tx.paymentOrder.create({ data: { tenantId: ctx.tenantId, subscriptionId, methodId: methodId ?? null, amount: subscription.priceKrw, currency: subscription.currency } });
  await audit(tx, ctx, requestId, "billing.order_created", "paymentOrder", row.id, ["amount", "methodId"], undefined);
  return dto(row);
}
export async function readPaymentOrder(ctx: Context, id: string) {
  if (!roleCan(ctx.member.role, "billing.read")) fail(403, "FORBIDDEN", "결제 정보를 볼 권한이 없습니다.");
  const row = await db.paymentOrder.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
  return dto(row);
}
export async function rejectPaymentReturn(ctx: Context, id: string) {
  billingWrite(ctx);
  const row = await db.paymentOrder.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
  if (row.status === "pending") fail(409, "PAYMENT_UNCONFIRMED", "결제 성공 주소만으로는 결제를 확정할 수 없습니다.");
  return dto(row);
}
function signaturesMatch(secret: string, body: string, signature: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected), right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function applyPaymentEvent(raw: string, signature: string, secret: string | undefined, requestId: string = randomUUID()) {
  if (!secret) fail(503, "PAYMENT_PROVIDER_REQUIRED", "결제 결과 수신 비밀이 설정되지 않았습니다.");
  if (/"cardNumber"|"pan"|"cvc"/i.test(raw)) fail(422, "CARD_DATA_REJECTED", "카드 원문은 받을 수 없습니다.");
  if (!signaturesMatch(secret, raw, signature)) fail(401, "PAYMENT_SIGNATURE_INVALID", "결제 결과 서명을 확인할 수 없습니다.");
  const input = providerEvent.parse(JSON.parse(raw));
  return db.$transaction(async tx => {
    const order = await tx.paymentOrder.findUnique({ where: { id: input.orderId } });
    if (!order) fail(404, "NOT_FOUND", "결제 주문을 찾을 수 없습니다.");
    const existing = await tx.paymentEvent.findUnique({ where: { providerEventId: input.eventId } });
    if (existing) {
      if (existing.orderId !== order.id || existing.outcome !== input.outcome) fail(409, "DUPLICATE_EVENT", "이미 다른 결제 결과가 기록되어 있습니다.");
      const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
      return { ...dto(current), duplicate: true };
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
  });
}
