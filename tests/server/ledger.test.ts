import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { postTrustedLedgerTransfer } from "@/server/ledger";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated local test database required");
afterAll(async () => { await db.$disconnect(); });

async function fixture() {
  const tenant = await db.company.create({ data: { id: randomUUID(), name: "원장 시험 회사", publicName: "원장 시험 회사" } });
  const service = await db.service.create({ data: { tenantId: tenant.id, name: "원장 시험 서비스", externalName: "원장 시험 서비스" } });
  return { tenantId: tenant.id, serviceId: service.id };
}
function source() { return randomUUID(); }
async function fund(tenantId: string, amount: bigint, currency = "KRW", sourceId = source()) {
  // Synthetic provider capture is allowed only in the isolated DB test fixture.
  return postTrustedLedgerTransfer({ tenantId, currency, kind: "funding", amount, sourceKind: "pg_capture", sourceId });
}
async function balance(tenantId: string, currency = "KRW") {
  return db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId, currency } } });
}
async function assertBalanced(tenantId: string, currency = "KRW") {
  const transactions = await db.ledgerTransaction.findMany({ where: { tenantId, currency }, include: { entries: true } });
  for (const transaction of transactions) {
    expect(transaction.entries).toHaveLength(2);
    expect(transaction.entries.reduce((sum, entry) => sum + entry.amount, BigInt(0))).toBe(BigInt(0));
    expect(transaction.entries.every(entry => entry.currency === currency)).toBe(true);
  }
  const account = await balance(tenantId, currency);
  const entries = transactions.flatMap(transaction => transaction.entries);
  expect(entries.filter(entry => entry.account === "available").reduce((sum, entry) => sum + entry.amount, BigInt(0))).toBe(account.available);
  expect(entries.filter(entry => entry.account === "held").reduce((sum, entry) => sum + entry.amount, BigInt(0))).toBe(account.held);
}

describe("balanced credit ledger", () => {
  test("same capture source is idempotent and a conflicting replay cannot mint credit", async () => {
    const { tenantId } = await fixture(), sourceId = source();
    const [first, replay] = await Promise.all([fund(tenantId, BigInt(100), "KRW", sourceId), fund(tenantId, BigInt(100), "KRW", sourceId)]);
    expect(first.id).toBe(replay.id);
    expect((await balance(tenantId)).available).toBe(BigInt(100));
    await expect(fund(tenantId, BigInt(101), "KRW", sourceId)).rejects.toMatchObject({ status: 409, code: "LEDGER_SOURCE_CONFLICT" });
    expect(await db.ledgerTransaction.count({ where: { tenantId, kind: "funding" } })).toBe(1);
    await assertBalanced(tenantId);
  });

  test("concurrent reservations cannot overdraw and a failed reservation leaves no event", async () => {
    const { tenantId, serviceId } = await fixture();
    await fund(tenantId, BigInt(100));
    const reserve = (sourceId: string) => postTrustedLedgerTransfer({ tenantId, serviceId, currency: "KRW",
      kind: "reserve", amount: BigInt(80), sourceKind: "usage_request", sourceId });
    const results = await Promise.allSettled([reserve(source()), reserve(source())]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await db.ledgerTransaction.count({ where: { tenantId, kind: "reserve" } })).toBe(1);
    expect(await balance(tenantId)).toMatchObject({ available: BigInt(20), held: BigInt(80) });
    await assertBalanced(tenantId);
  });

  test("partial capture and failure release settle only the original reservation", async () => {
    const { tenantId, serviceId } = await fixture();
    await fund(tenantId, BigInt(100));
    const hold = await postTrustedLedgerTransfer({ tenantId, serviceId, currency: "KRW", kind: "reserve",
      amount: BigInt(80), sourceKind: "usage_request", sourceId: source() });
    const capture = await postTrustedLedgerTransfer({ tenantId, serviceId, currency: "KRW", kind: "capture",
      reservationId: hold.id, amount: BigInt(50), sourceKind: "provider_receipt", sourceId: source() });
    expect((await postTrustedLedgerTransfer({ tenantId, serviceId, currency: "KRW", kind: "capture",
      reservationId: hold.id, amount: BigInt(50), sourceKind: "provider_receipt", sourceId: capture.sourceId })).id).toBe(capture.id);
    await postTrustedLedgerTransfer({ tenantId, serviceId, currency: "KRW", kind: "release",
      reservationId: hold.id, amount: BigInt(30), sourceKind: "provider_failure", sourceId: source() });
    await expect(postTrustedLedgerTransfer({ tenantId, serviceId, currency: "KRW", kind: "capture",
      reservationId: hold.id, amount: BigInt(1), sourceKind: "provider_receipt", sourceId: source() })).rejects.toThrow();
    expect(await balance(tenantId)).toMatchObject({ available: BigInt(50), held: BigInt(0) });
    await assertBalanced(tenantId);
  });

  test("tenant, service and currency cannot be crossed when settling", async () => {
    const first = await fixture(), second = await fixture();
    await fund(first.tenantId, BigInt(100));
    await fund(second.tenantId, BigInt(100));
    const hold = await postTrustedLedgerTransfer({ ...first, currency: "KRW", kind: "reserve", amount: BigInt(40),
      sourceKind: "usage_request", sourceId: source() });
    await expect(postTrustedLedgerTransfer({ ...second, currency: "KRW", kind: "capture", amount: BigInt(40),
      reservationId: hold.id, sourceKind: "provider_receipt", sourceId: source() })).rejects.toThrow();
    await expect(postTrustedLedgerTransfer({ tenantId: first.tenantId, serviceId: second.serviceId, currency: "KRW", kind: "capture",
      amount: BigInt(40), reservationId: hold.id, sourceKind: "provider_receipt", sourceId: source() })).rejects.toThrow();
    await expect(postTrustedLedgerTransfer({ ...first, currency: "USD", kind: "capture", amount: BigInt(40),
      reservationId: hold.id, sourceKind: "provider_receipt", sourceId: source() })).rejects.toThrow();
    expect(await balance(first.tenantId)).toMatchObject({ available: BigInt(60), held: BigInt(40) });
    await assertBalanced(first.tenantId);
    await assertBalanced(second.tenantId);
  });

  test("currency balances remain separate and all stored entries are immutable", async () => {
    const { tenantId } = await fixture();
    const krw = await fund(tenantId, BigInt(100)), usd = await fund(tenantId, BigInt(25), "USD");
    expect((await balance(tenantId, "KRW")).available).toBe(BigInt(100));
    expect((await balance(tenantId, "USD")).available).toBe(BigInt(25));
    await expect(db.creditAccount.update({ where: { tenantId_currency: { tenantId, currency: "KRW" } },
      data: { available: BigInt(999) } })).rejects.toThrow();
    await expect(db.creditAccount.create({ data: { tenantId, currency: "EUR", available: BigInt(999) } })).rejects.toThrow();
    await expect(db.ledgerTransaction.update({ where: { id: krw.id }, data: { amount: BigInt(999) } })).rejects.toThrow();
    await expect(db.ledgerTransaction.delete({ where: { id: usd.id } })).rejects.toThrow();
    const entry = await db.ledgerEntry.findFirstOrThrow({ where: { transactionId: krw.id } });
    await expect(db.ledgerEntry.update({ where: { id: entry.id }, data: { amount: BigInt(999) } })).rejects.toThrow();
    await expect(db.ledgerEntry.create({ data: { transactionId: krw.id, currency: "KRW", account: "spent", amount: BigInt(999) } })).rejects.toThrow();
    await assertBalanced(tenantId, "KRW");
    await assertBalanced(tenantId, "USD");
  });
});
