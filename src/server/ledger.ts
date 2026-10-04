import { Prisma } from "@/generated/prisma/client";
import type { Context } from "./context";
import type { LedgerOverview, LedgerQuery } from "@/contracts/ledger";
import { db } from "./db";
import { fail } from "./http";
import { roleCan } from "./permissions";
import { audit } from "./audit";

type LedgerKind = "funding" | "reserve" | "capture" | "release";
type Transfer = {
  tenantId: string; serviceId?: string | null; currency: string; kind: LedgerKind;
  amount: bigint; sourceKind: string; sourceId: string; reservationId?: string | null;
};

/**
 * Internal accounting primitive. Funding must be called only after a verified
 * PG capture; there is deliberately no public write route while P10-T02 is open.
 * PostgreSQL owns the balance check, reservation cap and paired ledger entries.
 */
export async function postTrustedLedgerTransfer(input: Transfer) {
  if (!/^[A-Z]{3}$/.test(input.currency) || input.amount <= BigInt(0) || input.amount > BigInt(1000000000000) ||
    !/^[a-z][a-z0-9_:-]{0,63}$/.test(input.sourceKind) || input.sourceId.length < 1 || input.sourceId.length > 128)
    fail(422, "INVALID_LEDGER_SOURCE", "원장 원천과 금액을 확인해주세요.");
  const key = { tenantId: input.tenantId, kind: input.kind, sourceKind: input.sourceKind, sourceId: input.sourceId };
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"ledger-source:" + Object.values(key).join(":")}, 0))`;
    const existing = await tx.ledgerTransaction.findUnique({ where: { tenantId_kind_sourceKind_sourceId: key } });
    if (existing) {
      if (existing.currency !== input.currency || existing.amount !== input.amount ||
        existing.serviceId !== (input.serviceId ?? null) || existing.reservationId !== (input.reservationId ?? null))
        fail(409, "LEDGER_SOURCE_CONFLICT", "같은 원천에 다른 원장 내용이 사용되었습니다.");
      return existing;
    }
    const row = await tx.ledgerTransaction.create({ data: { ...key, currency: input.currency, amount: input.amount,
      serviceId: input.serviceId ?? null, reservationId: input.reservationId ?? null } });
    await audit(tx, { tenantId: input.tenantId, user: { id: null } }, row.id, "billing.ledger_" + input.kind, "ledgerTransaction", row.id, ["balance"], input.serviceId ?? undefined);
    return row;
  }, { timeout: 15000 });
}

export async function ledgerOverview(ctx: Context, query: LedgerQuery): Promise<LedgerOverview> {
  if (!roleCan(ctx.member.role, "billing.read")) fail(403, "FORBIDDEN", "원장을 볼 권한이 없습니다.");
  return db.$transaction(async tx => {
    const clock = await tx.$queryRaw<{ asOf: Date }[]>`SELECT statement_timestamp() AS "asOf"`;
    if (query.serviceId) {
      const service = await tx.service.findFirst({ where: { id: query.serviceId, tenantId: ctx.tenantId }, select: { id: true } });
      if (!service) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    }
    const where = { tenantId: ctx.tenantId, currency: query.currency,
      ...(query.serviceId ? { serviceId: query.serviceId } : {}) };
    const account = await tx.creditAccount.findUnique({ where: { tenantId_currency: { tenantId: ctx.tenantId, currency: query.currency } } });
    const total = await tx.ledgerTransaction.count({ where });
    const rows = await tx.ledgerTransaction.findMany({ where, include: { service: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
    return { asOf: clock[0].asOf.toISOString(), currency: query.currency,
      available: (account?.available ?? BigInt(0)).toString(), held: (account?.held ?? BigInt(0)).toString(),
      items: rows.map(row => ({ id: row.id, serviceId: row.serviceId, serviceName: row.service?.name ?? null,
        kind: row.kind as LedgerKind, amount: row.amount.toString(), createdAt: row.createdAt.toISOString() })),
      total, page: query.page, pageSize: query.pageSize };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
