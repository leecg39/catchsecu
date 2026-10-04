import type { PaymentMethod } from "@/generated/prisma/client";
import type { PaymentMethodCreate, PaymentMethodListQuery, PaymentMethodRecord, PaymentMethodUpdate } from "@/contracts/payment-methods";
import { db } from "./db";
import type { Context } from "./context";
import { fail, requireVersion } from "./http";
import { audit } from "./audit";
import { roleCan } from "./permissions";
import { decrypt, encrypt, tokenHash } from "./crypto";

const pan = /[0-9]{13,19}/;
const digitRun = (value: string) => value.replace(/[^0-9]/g, "").length;
function dto(row: PaymentMethod): PaymentMethodRecord {
  return { id: row.id, provider: row.provider, kind: row.kind as PaymentMethodRecord["kind"], label: row.label, isDefault: row.isDefault, status: row.status as PaymentMethodRecord["status"], version: row.version, createdAt: row.createdAt.toISOString() };
}
function billingWrite(ctx: Context) { if (!roleCan(ctx.member.role, "billing.write")) fail(403, "FORBIDDEN", "결제수단을 변경할 권한이 없습니다."); }
function billingRead(ctx: Context) { if (!roleCan(ctx.member.role, "billing.read")) fail(403, "FORBIDDEN", "결제수단을 볼 권한이 없습니다."); }
function rejectCardPlaintext(...values: (string | undefined)[]) {
  if (values.some(value => value && (pan.test(value) || digitRun(value) >= 13))) fail(422, "CARD_DATA_REJECTED", "카드 원문은 저장할 수 없습니다. PG 토큰을 등록해주세요.");
}

export async function listPaymentMethods(ctx: Context, query: PaymentMethodListQuery): Promise<PaymentMethodRecord[]> {
  billingRead(ctx);
  const rows = await db.paymentMethod.findMany({ where: { tenantId: ctx.tenantId, ...(query.includeRevoked ? {} : { status: "active" }) }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return rows.map(dto);
}

export async function createPaymentMethod(ctx: Context, input: PaymentMethodCreate, requestId: string): Promise<PaymentMethodRecord> {
  billingWrite(ctx);
  rejectCardPlaintext(input.token, input.label);
  const hash = tokenHash(input.token);
  const row = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${ctx.tenantId} FOR UPDATE`;
    const duplicate = await tx.paymentMethod.findFirst({ where: { tokenHash: hash, status: "active" } });
    if (duplicate) fail(409, "METHOD_EXISTS", "이미 등록된 결제수단입니다.");
    const count = await tx.paymentMethod.count({ where: { tenantId: ctx.tenantId, status: "active" } });
    const makeDefault = input.setDefault || count === 0;
    if (makeDefault) await tx.paymentMethod.updateMany({ where: { tenantId: ctx.tenantId, isDefault: true }, data: { isDefault: false } });
    const created = await tx.paymentMethod.create({ data: { tenantId: ctx.tenantId, tokenHash: hash, tokenCipher: encrypt(input.token), provider: "local", kind: input.kind, label: input.label, isDefault: makeDefault } });
    await audit(tx, ctx, requestId, "billing.method_registered", "paymentMethod", created.id, ["kind", "label", "isDefault"], undefined);
    return created;
  }).catch(error => {
    if ((error as { code?: string }).code === "P2002") fail(409, "METHOD_EXISTS", "이미 등록된 결제수단입니다.");
    throw error;
  });
  return dto(row);
}

export async function updatePaymentMethod(ctx: Context, id: string, input: PaymentMethodUpdate, requestId: string): Promise<PaymentMethodRecord> {
  billingWrite(ctx);
  rejectCardPlaintext(input.label);
  const row = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${ctx.tenantId} FOR UPDATE`;
    const current = await tx.paymentMethod.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current || current.status !== "active") fail(404, "NOT_FOUND", "결제수단을 찾을 수 없습니다.");
    requireVersion(input, current);
    if (input.setDefault) await tx.paymentMethod.updateMany({ where: { tenantId: ctx.tenantId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
    const saved = await tx.paymentMethod.update({ where: { id }, data: { ...(input.label === undefined ? {} : { label: input.label }), ...(input.setDefault === undefined ? {} : { isDefault: input.setDefault }), version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "billing.method_updated", "paymentMethod", id, ["label", "isDefault"], undefined);
    return saved;
  });
  return dto(row);
}

export async function removePaymentMethod(ctx: Context, id: string, version: number, requestId: string): Promise<PaymentMethodRecord> {
  billingWrite(ctx);
  const row = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${ctx.tenantId} FOR UPDATE`;
    const current = await tx.paymentMethod.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current || current.status !== "active") fail(404, "NOT_FOUND", "결제수단을 찾을 수 없습니다.");
    requireVersion({ version }, current);
    const pending = await tx.paymentOrder.count({ where: { tenantId: ctx.tenantId, methodId: id, status: "pending" } });
    if (pending > 0) fail(409, "METHOD_IN_USE", "진행 중인 결제가 있어 삭제할 수 없습니다.");
    const saved = await tx.paymentMethod.update({ where: { id }, data: { status: "revoked", isDefault: false, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "billing.method_revoked", "paymentMethod", id, ["status"], undefined);
    if (current.isDefault) {
      const next = await tx.paymentMethod.findFirst({ where: { tenantId: ctx.tenantId, status: "active" }, orderBy: { createdAt: "asc" } });
      if (next) {
        await tx.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true, version: { increment: 1 } } });
        await audit(tx, ctx, requestId, "billing.method_default_promoted", "paymentMethod", next.id, ["isDefault"], undefined);
      }
    }
    return saved;
  });
  return dto(row);
}

/** provider 승인 경로에서만 토큰 원문을 연다. 응답 DTO에는 절대 포함하지 않는다. */
export async function resolveMethodToken(tenantId: string, methodId: string): Promise<string> {
  const row = await db.paymentMethod.findFirst({ where: { id: methodId, tenantId, status: "active" } });
  if (!row) fail(404, "NOT_FOUND", "결제수단을 찾을 수 없습니다.");
  return decrypt<string>(row.tokenCipher);
}
