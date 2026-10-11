import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:3198";
const output = "docs/qa/R21-T04/current";
const marker = ".local/qa-r21-acceptance.json";
const database = new URL(env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname, "/catchsecu_test");
assert.equal(new URL(base).origin, "http://127.0.0.1:3198");
assert.ok(env.PAYMENT_WEBHOOK_SECRET, "PAYMENT_WEBHOOK_SECRET is required for provider acceptance");

type Actor = { email: string; password: string; userId: string; role: "owner" | "billing" | "admin" };
type Fixture = {
  actors: { owner: Actor; billing: Actor; denied: Actor; foreign: Actor };
  tenantId: string;
  foreignTenantId: string;
  subscriptionId: string;
  orderId: string;
  paidEventId: string;
  refundIds: string[];
  refundEventIds: string[];
  legacyOrderId: string;
};
type Check = { step: string; status: number; code?: string };
const checks: Check[] = [];

const stringify = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
function persist(name: string, value: unknown) { writeFileSync(`${output}/${name}`, stringify(value) + "\n"); }
function cookie(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function http(step: string, path: string, options: { method?: string; body?: unknown; cookie?: string; expected?: number; key?: string } = {}) {
  const method = options.method ?? "GET";
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const response = await fetch(base + "/api/v1" + path, { method, redirect: "manual", headers: {
    ...(options.cookie ? { cookie: options.cookie } : {}), ...(method === "GET" ? {} : { origin: base }),
    ...(body ? { "content-type": "application/json" } : {}), ...(options.key ? { "idempotency-key": options.key } : {}),
  }, body });
  // QA runner validates exact response shapes at each call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = null;
  try { value = await response.clone().json(); } catch {}
  checks.push({ step, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
  persist("http-progress.json", { checks });
  assert.equal(response.status, options.expected ?? 200, `${step}: ${stringify(value)}`);
  return { response, value };
}
async function providerEvent(step: string, input: unknown, expected = 202) {
  const raw = JSON.stringify(input);
  const signature = createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET!).update(raw).digest("hex");
  const response = await fetch(base + "/api/v1/billing/provider-events", {
    method: "POST", headers: { "content-type": "application/json", "x-payment-signature": signature }, body: raw,
  });
  const value = await response.clone().json();
  checks.push({ step, status: response.status, ...(value?.error?.code ? { code: value.error.code } : {}) });
  persist("http-progress.json", { checks });
  assert.equal(response.status, expected, `${step}: ${stringify(value)}`);
  return value;
}
async function register(label: string, role: Actor["role"]): Promise<Actor> {
  const actor = { email: `r21-${label}-${randomUUID().slice(0, 8)}@catchsecu.test`,
    password: randomBytes(24).toString("base64url") + "Aa!1", userId: "", role };
  await http(`${label} 가입`, "/auth/sign-up/email", { method: "POST", body: { name: `R21 ${label}`, email: actor.email, password: actor.password } });
  const user = await db.user.update({ where: { email: actor.email }, data: { emailVerified: true } });
  actor.userId = user.id;
  return actor;
}
async function login(actor: Actor) {
  const result = await http(`${actor.role} 로그인`, "/auth/sign-in/email", { method: "POST", body: { email: actor.email, password: actor.password } });
  const value = cookie(result.response); assert.ok(value); return value;
}
async function fingerprint(fixture: Fixture) {
  const tenantId = fixture.tenantId, orderBy = { id: "asc" as const };
  const rows = {
    subscriptions: await db.billingSubscription.findMany({ where: { tenantId }, orderBy }),
    orders: await db.paymentOrder.findMany({ where: { tenantId }, orderBy }),
    refunds: await db.paymentRefund.findMany({ where: { tenantId }, orderBy }),
    events: await db.paymentEvent.findMany({ where: { order: { tenantId } }, orderBy }),
    ledger: await db.ledgerTransaction.findMany({ where: { tenantId }, include: { entries: { orderBy: { account: "asc" } } }, orderBy }),
    credit: await db.creditAccount.findMany({ where: { tenantId }, orderBy: { currency: "asc" } }),
    audits: await db.auditEvent.findMany({ where: { tenantId, action: { startsWith: "billing." } }, orderBy }),
  };
  const serialized = stringify(rows);
  return { sha256: createHash("sha256").update(serialized).digest("hex"),
    counts: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])) };
}
async function assertLedgerZero(fixture: Fixture) {
  const account = await db.creditAccount.findUniqueOrThrow({ where: { tenantId_currency: { tenantId: fixture.tenantId, currency: "KRW" } } });
  assert.equal(account.available, BigInt(0)); assert.equal(account.held, BigInt(0));
  const transactions = await db.ledgerTransaction.findMany({ where: { tenantId: fixture.tenantId }, include: { entries: true } });
  assert.equal(transactions.filter(row => row.sourceKind === "pg_capture" && row.sourceId === fixture.orderId).length, 1);
  assert.equal(transactions.filter(row => row.sourceKind === "payment_refund").length, 2);
  for (const transaction of transactions) assert.equal(transaction.entries.reduce((sum, entry) => sum + entry.amount, BigInt(0)), BigInt(0));
}

try {
  const restart = process.argv.includes("--restart");
  if (restart) {
    assert.ok(existsSync(marker));
    const fixture = JSON.parse(readFileSync(marker, "utf8")) as Fixture;
    const before = JSON.parse(readFileSync(`${output}/database-before-restart.json`, "utf8")).fingerprint;
    assert.deepEqual(await fingerprint(fixture), before);
    await assertLedgerZero(fixture);
    const ownerCookie = await login(fixture.actors.owner);
    const order = await http("재시작 후 주문 조회", `/billing/orders/${fixture.orderId}`, { cookie: ownerCookie });
    assert.equal(order.value.status, "paid");
    const ledger = await http("재시작 후 원장 조회", "/ledger?currency=KRW&page=1&pageSize=20", { cookie: ownerCookie });
    assert.equal(ledger.value.available, "0"); assert.equal(ledger.value.held, "0");
    assert.equal((await providerEvent("재시작 후 승인 중복", { orderId: fixture.orderId, eventId: fixture.paidEventId, outcome: "paid" })).duplicate, true);
    for (let index = 0; index < fixture.refundIds.length; index += 1)
      assert.equal((await providerEvent(`재시작 후 환불 중복 ${index + 1}`, { orderId: fixture.orderId,
        eventId: fixture.refundEventIds[index], outcome: "refunded", refundId: fixture.refundIds[index] })).duplicate, true);
    assert.deepEqual(await fingerprint(fixture), before);
    persist("database-after-restart.json", { result: "passed", preserved: true, fingerprint: before, checks });
  } else {
    const version = await db.billingPlanVersion.findFirstOrThrow({ where: { orderable: true, priceKrw: { gt: 0 } }, orderBy: { effectiveFrom: "desc" } });
    let fixture: Fixture;
    // The marker is written immediately after isolated setup so a transport-only
    // interruption can resume without duplicating companies or accounts.
    if (existsSync(marker)) {
      fixture = JSON.parse(readFileSync(marker, "utf8")) as Fixture;
      assert.deepEqual(fixture.refundIds, []); assert.equal(fixture.legacyOrderId, "");
      await db.rateLimit.deleteMany();
      await db.apiRateLimit.deleteMany();
    } else {
      const owner = await register("owner", "owner"), billing = await register("billing", "billing"),
        denied = await register("admin", "admin"), foreign = await register("foreign", "owner");
      const company = await db.company.create({ data: { name: "R21 결제 수용 A", publicName: "R21 결제 수용 A",
        policy: { create: { passwordMonths: 0 } }, memberships: { create: [
          { userId: owner.userId, role: "owner" }, { userId: billing.userId, role: "billing" }, { userId: denied.userId, role: "admin" },
        ] } } });
      const foreignCompany = await db.company.create({ data: { name: "R21 결제 수용 B", publicName: "R21 결제 수용 B",
        policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId: foreign.userId, role: "owner" } } } });
      const setupCookie = await login(owner);
      const createdSubscription = await http("구독 요청", "/subscriptions", { method: "POST", cookie: setupCookie,
        key: randomUUID(), body: { planVersionId: version.id }, expected: 202 });
      const createdOrder = await http("주문 생성", "/billing/orders", { method: "POST", cookie: setupCookie,
        key: randomUUID(), body: { subscriptionId: createdSubscription.value.id }, expected: 201 });
      fixture = { actors: { owner, billing, denied, foreign }, tenantId: company.id, foreignTenantId: foreignCompany.id,
        subscriptionId: createdSubscription.value.id, orderId: createdOrder.value.id, paidEventId: randomUUID(), refundIds: [], refundEventIds: [], legacyOrderId: "" };
      writeFileSync(marker, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    }
    const ownerCookie = await login(fixture.actors.owner), billingCookie = await login(fixture.actors.billing),
      deniedCookie = await login(fixture.actors.denied), foreignCookie = await login(fixture.actors.foreign);
    const subscription = { value: await db.billingSubscription.findUniqueOrThrow({ where: { id: fixture.subscriptionId } }) };
    const order = { value: await db.paymentOrder.findUniqueOrThrow({ where: { id: fixture.orderId } }) };

    const forged = await http("임의 success query는 승인하지 않음", `/billing/orders/${fixture.orderId}?result=success`, { cookie: ownerCookie });
    assert.equal(forged.value.status, "pending");
    await http("success return 단독 승인 거부", `/billing/orders/${fixture.orderId}/return`, { method: "POST", cookie: ownerCookie,
      body: { result: "success" }, expected: 409 });
    await http("결제 중 구독 취소 거부", `/subscriptions/${fixture.subscriptionId}/cancel`, { method: "POST", cookie: ownerCookie,
      key: randomUUID(), body: { version: subscription.value.version }, expected: 409 });
    await http("무권한 admin 주문 조회 거부", "/billing/orders", { cookie: deniedCookie, expected: 403 });
    await http("billing 역할 주문 조회 허용", "/billing/orders", { cookie: billingCookie });
    await http("다른 회사 주문 직접 조회 거부", `/billing/orders/${fixture.orderId}`, { cookie: foreignCookie, expected: 404 });
    const foreignOrders = await http("다른 회사 목록 격리", "/billing/orders", { cookie: foreignCookie });
    assert.ok(!foreignOrders.value.items.some((item: { id: string }) => item.id === fixture.orderId));
    await http("미인증 주문 조회 거부", "/billing/orders", { expected: 401 });

    await providerEvent("서명 승인", { orderId: fixture.orderId, eventId: fixture.paidEventId, outcome: "paid" });
    assert.equal((await providerEvent("승인 중복", { orderId: fixture.orderId, eventId: fixture.paidEventId, outcome: "paid" })).duplicate, true);
    await providerEvent("늦은 실패 거부", { orderId: fixture.orderId, eventId: randomUUID(), outcome: "failed" }, 409);
    const amount = order.value.amount as number, partial = Math.min(3000, amount - 1), remaining = amount - partial;
    for (const [index, refundAmount] of [partial, remaining].entries()) {
      const requested = await http(`환불 요청 ${index + 1}`, `/billing/orders/${fixture.orderId}/refunds`, { method: "POST", cookie: ownerCookie,
        key: randomUUID(), body: { amount: refundAmount, reason: index ? "잔액 전액 환불" : "부분 환불" }, expected: 201 });
      const eventId = randomUUID(); fixture.refundIds.push(requested.value.id); fixture.refundEventIds.push(eventId);
      await providerEvent(`환불 승인 ${index + 1}`, { orderId: fixture.orderId, eventId, outcome: "refunded", refundId: requested.value.id });
      assert.equal((await providerEvent(`환불 중복 ${index + 1}`, { orderId: fixture.orderId, eventId,
        outcome: "refunded", refundId: requested.value.id })).duplicate, true);
    }
    const refunds = await http("환불 누계 조회", `/billing/orders/${fixture.orderId}/refunds`, { cookie: ownerCookie });
    assert.equal(refunds.value.refundedTotal, amount); assert.equal(refunds.value.refundable, 0);
    await http("초과 환불 거부", `/billing/orders/${fixture.orderId}/refunds`, { method: "POST", cookie: ownerCookie,
      key: randomUUID(), body: { amount: 1, reason: "초과" }, expected: 409 });
    await assertLedgerZero(fixture);

    const legacy = await db.billingSubscription.create({ data: { tenantId: fixture.tenantId, planId: version.planId,
      planVersionId: version.id, status: "pending", priceKrw: version.priceKrw, currency: version.currency } });
    const legacyOrder = await db.paymentOrder.create({ data: { tenantId: fixture.tenantId, subscriptionId: legacy.id,
      amount: version.priceKrw!, currency: version.currency } }); fixture.legacyOrderId = legacyOrder.id;
    await db.billingSubscription.update({ where: { id: legacy.id }, data: { status: "cancelled", version: 2 } });
    const ledgerBefore = await db.ledgerTransaction.count({ where: { tenantId: fixture.tenantId } });
    await providerEvent("과거 취소 구독 승인 거부", { orderId: legacyOrder.id, eventId: randomUUID(), outcome: "paid" }, 409);
    assert.equal(await db.ledgerTransaction.count({ where: { tenantId: fixture.tenantId } }), ledgerBefore);

    writeFileSync(marker, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    const finalFingerprint = await fingerprint(fixture);
    persist("database-before-restart.json", { result: "passed", fingerprint: finalFingerprint, checks, ledgerZero: true,
      realExternalProvider: false, localSignedProvider: true });
  }
  console.log(JSON.stringify({ result: "passed", restart, checks: checks.length }));
} finally {
  await db.$disconnect();
}
