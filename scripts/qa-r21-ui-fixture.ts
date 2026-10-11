import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { encrypt, tokenHash } from "../src/server/crypto";
import { postTrustedLedgerTransfer } from "../src/server/ledger";

const marker = ".local/qa-r21-ui.json";
const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:3180";
const database = new URL(env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["http://127.0.0.1:3180", "http://localhost:3180"].includes(new URL(base).origin));

type Fixture = {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
  serviceId: string;
  orderId: string;
};

async function createFixture(): Promise<Fixture> {
  const email = `r21-ui-${randomUUID().slice(0, 8)}@catchsecu.test`;
  const password = randomBytes(24).toString("base64url") + "Aa!1";
  const signup = await fetch(base + "/api/v1/auth/sign-up/email", {
    method: "POST",
    redirect: "manual",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ name: "R21 결제 UI 검증", email, password }),
  });
  assert.equal(signup.status, 200, "R21 UI fixture signup failed");
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const trial = await db.billingPlanVersion.findFirstOrThrow({ where: { planId: "trial" }, orderBy: { effectiveFrom: "desc" } });
  const paidVersion = await db.billingPlanVersion.findFirstOrThrow({ where: { orderable: true, priceKrw: { gt: 0 } }, orderBy: { effectiveFrom: "desc" } });
  const paidPlan = await db.billingPlan.findUniqueOrThrow({ where: { id: paidVersion.planId } });
  const now = new Date();
  const result = await db.$transaction(async tx => {
    const company = await tx.company.create({
      data: {
        name: "R21 결제 UI 검증 회사",
        publicName: "R21 결제 UI 검증",
        policy: { create: { passwordMonths: 0 } },
        memberships: { create: { userId: user.id, role: "owner" } },
      },
    });
    const service = await tx.service.create({ data: { tenantId: company.id, name: "R21 문자·인증 서비스", externalName: "r21-payment-ui" } });
    await tx.billingSubscription.create({ data: {
      tenantId: company.id, planId: trial.planId, planVersionId: trial.id, status: "trialing",
      activationSource: "trial", priceKrw: 0, periodStart: now, periodEnd: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    } });
    const subscription = await tx.billingSubscription.create({ data: {
      tenantId: company.id, planId: paidPlan.id, planVersionId: paidVersion.id, status: "pending",
      priceKrw: paidVersion.priceKrw, currency: paidVersion.currency,
    } });
    const paymentToken = "pm_r21_" + randomBytes(18).toString("hex");
    const method = await tx.paymentMethod.create({ data: {
      tenantId: company.id, tokenHash: tokenHash(paymentToken), tokenCipher: encrypt(paymentToken),
      provider: "local", kind: "card", label: "R21 QA 카드", isDefault: true,
    } });
    const order = await tx.paymentOrder.create({ data: {
      tenantId: company.id, subscriptionId: subscription.id, methodId: method.id,
      amount: paidVersion.priceKrw!, currency: paidVersion.currency,
    } });
    return { tenantId: company.id, serviceId: service.id, orderId: order.id };
  });

  const login = await fetch(base + "/api/v1/auth/sign-in/email", {
    method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, "R21 UI fixture login failed");
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const headers = { origin: base, cookie, "content-type": "application/json", "idempotency-key": randomUUID() };
  const checkout = await fetch(`${base}/api/v1/billing/orders/${result.orderId}/virtual-checkout`, {
    method: "POST", headers, body: JSON.stringify({ outcome: "paid" }),
  });
  assert.equal(checkout.status, 200, "R21 UI virtual checkout failed");
  const refund = await fetch(`${base}/api/v1/billing/orders/${result.orderId}/refunds`, {
    method: "POST", headers: { ...headers, "idempotency-key": randomUUID() },
    body: JSON.stringify({ amount: Math.min(2000, paidVersion.priceKrw!), reason: "R21 화면 환불 대기" }),
  });
  assert.equal(refund.status, 201, "R21 UI refund fixture failed");

  await postTrustedLedgerTransfer({ tenantId: result.tenantId, currency: "KRW", kind: "funding", amount: BigInt(50000),
    sourceKind: "pg_capture", sourceId: "r21-ui-funding" });
  const messageReserve = await postTrustedLedgerTransfer({ tenantId: result.tenantId, serviceId: result.serviceId,
    currency: "KRW", kind: "reserve", amount: BigInt(300), sourceKind: "campaign_delivery", sourceId: "r21-ui-message-reserve" });
  await postTrustedLedgerTransfer({ tenantId: result.tenantId, serviceId: result.serviceId, currency: "KRW", kind: "capture",
    amount: BigInt(300), sourceKind: "campaign_delivery", sourceId: "r21-ui-message-capture", reservationId: messageReserve.id });
  const identityReserve = await postTrustedLedgerTransfer({ tenantId: result.tenantId, serviceId: result.serviceId,
    currency: "KRW", kind: "reserve", amount: BigInt(700), sourceKind: "identity_verification", sourceId: "r21-ui-identity-reserve" });
  await postTrustedLedgerTransfer({ tenantId: result.tenantId, serviceId: result.serviceId, currency: "KRW", kind: "capture",
    amount: BigInt(700), sourceKind: "identity_verification", sourceId: "r21-ui-identity-capture", reservationId: identityReserve.id });
  return { email, password, userId: user.id, ...result };
}

try {
  let fixture: Fixture;
  if (existsSync(marker)) {
    fixture = JSON.parse(readFileSync(marker, "utf8")) as Fixture;
    assert.ok(await db.user.count({ where: { id: fixture.userId, email: fixture.email } }));
    assert.ok(await db.company.count({ where: { id: fixture.tenantId } }));
  } else {
    fixture = await createFixture();
    writeFileSync(marker, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  const [orders, refunds, messageEvents, identityEvents] = await Promise.all([
    db.paymentOrder.count({ where: { tenantId: fixture.tenantId } }),
    db.paymentRefund.count({ where: { tenantId: fixture.tenantId } }),
    db.ledgerTransaction.count({ where: { tenantId: fixture.tenantId, sourceKind: "campaign_delivery" } }),
    db.ledgerTransaction.count({ where: { tenantId: fixture.tenantId, sourceKind: "identity_verification" } }),
  ]);
  console.log(JSON.stringify({ result: "passed", tenantIsolated: true, orders, refunds, messageEvents, identityEvents,
    credentials: marker }));
} finally {
  await db.$disconnect();
}
