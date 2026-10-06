import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { POST as createCompany } from "@/app/api/v1/companies/route";
import { GET as getPlans } from "@/app/api/v1/plans/route";
import { GET as getAssets } from "@/app/api/v1/assets/route";
import { GET as getEntitlements } from "@/app/api/v1/entitlements/route";
import { GET as getSubscriptions, POST as postSubscription } from "@/app/api/v1/subscriptions/[[...segments]]/route";
import { GET as getBillingHistory } from "@/app/api/v1/billing-history/route";
import { GET as getLedger } from "@/app/api/v1/ledger/route";
import { POST as postService } from "@/app/api/v1/services/route";
import { POST as createOrder } from "@/app/api/v1/billing/orders/route";
import { applyPaymentEvent } from "@/server/payments";
import { assertQuota } from "@/server/entitlements";
import { expireSubscriptions } from "@/server/subscription-worker";
import { subjectHashes } from "@/server/subject-identity";
import { encrypt } from "@/server/crypto";
import { postTrustedLedgerTransfer } from "@/server/ledger";
import type { AssetOverview, BillingOverview, EntitlementRecord, PlanRecord, SubscriptionRecord } from "@/contracts/subscriptions";
import type { BillingHistoryList } from "@/contracts/billing-history";
import type { LedgerOverview } from "@/contracts/ledger";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
const origin = env.BETTER_AUTH_URL, cookies: Record<string, string> = {}, companies: Record<string, string> = {};
function req(path: string, method = "GET", who = "owner", input?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "",
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function answer<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status);
  return response.json();
}
async function signup(name: string) {
  const email = `${name}-${randomUUID()}@billing.local.test`, password = "Synthetic-billing-2026-password!";
  await answer(await auth.handler(req("/auth/sign-up/email", "POST", name, { name, email, password })));
  await db.user.update({ where: { email }, data: { emailVerified: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", name, { email, password }));
  expect(login.status).toBe(200); cookies[name] = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "SubjectAccessRequest" CASCADE');
  for (const name of ["owner", "foreign", "admin"]) await signup(name);
  for (const name of ["owner", "foreign"]) {
    const row = await answer<{ id: string }>(await createCompany(req("/companies", "POST", name,
      { name: `합성 회사 ${name}`, publicName: `합성 회사 ${name}` })), 201);
    companies[name] = row.id;
  }
  const admin = await db.user.findFirstOrThrow({ where: { name: "admin" } });
  await db.membership.create({ data: { tenantId: companies.owner, userId: admin.id, role: "admin" } });
});
afterAll(async () => { await db.$disconnect(); });

describe("subscription and catalog boundary", () => {
  test("ledger API scopes company, service and currency without exposing source IDs", async () => {
    const service = await db.service.findFirstOrThrow({ where: { tenantId: companies.owner } });
    const sourceId = randomUUID();
    await postTrustedLedgerTransfer({ tenantId: companies.owner, currency: "KRW", kind: "funding",
      amount: BigInt(100), sourceKind: "pg_capture", sourceId });
    await postTrustedLedgerTransfer({ tenantId: companies.owner, serviceId: service.id, currency: "KRW", kind: "reserve",
      amount: BigInt(20), sourceKind: "usage_request", sourceId: randomUUID() });
    const owner = await answer<LedgerOverview>(await getLedger(req("/ledger")));
    expect(owner).toMatchObject({ currency: "KRW", available: "80", held: "20", total: 2 });
    expect(owner.items.map(item => item.kind)).toContain("reserve");
    expect(JSON.stringify(owner)).not.toContain(sourceId);
    const filtered = await answer<LedgerOverview>(await getLedger(req("/ledger?serviceId=" + service.id)));
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({ serviceId: service.id, kind: "reserve", amount: "20" });
    expect((await answer<LedgerOverview>(await getLedger(req("/ledger?currency=USD")))).total).toBe(0);
    expect((await answer<LedgerOverview>(await getLedger(req("/ledger", "GET", "foreign")))).total).toBe(0);
    await answer(await getLedger(req("/ledger?serviceId=" + service.id, "GET", "foreign")), 404);
    await answer(await getLedger(req("/ledger", "GET", "admin")), 403);
    await answer(await getLedger(req("/ledger", "GET", "anonymous")), 401);
    await answer(await getLedger(req("/ledger?pageSize=1000")), 422);
  });
  test("billing history shows only real tenant trial events, with Korean month filters", async () => {
    const ownTrial = (await answer<BillingOverview>(await getSubscriptions(req("/subscriptions")))).subscriptions[0];
    const currentMonth = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    const [year, month] = currentMonth.split("-").map(Number);
    const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    const list = await answer<BillingHistoryList>(await getBillingHistory(req("/billing-history?fromMonth=" + currentMonth + "&toMonth=" + currentMonth)));
    expect(list).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(list.items[0]).toMatchObject({ id: ownTrial.id, kind: "trial_started", amountKrw: 0, method: "none", planName: "무료 체험" });
    expect((await answer<BillingHistoryList>(await getBillingHistory(req("/billing-history?toMonth=" + previousMonth)))).total).toBe(0);
    expect((await answer<BillingHistoryList>(await getBillingHistory(req("/billing-history", "GET", "foreign")))).items[0].id).not.toBe(ownTrial.id);
    await answer(await getBillingHistory(req("/billing-history", "GET", "admin")), 403);
    await answer(await getBillingHistory(req("/billing-history", "GET", "anonymous")), 401);
    await answer(await getBillingHistory(req("/billing-history?fromMonth=" + currentMonth + "&toMonth=" + previousMonth)), 422);
    await answer(await getBillingHistory(req("/billing-history?fromMonth=0000-01")), 422);
    await answer(await getBillingHistory(req("/billing-history?pageSize=1000")), 422);
  });
  test("company registration grants a seven-day trial and tenant-scoped usage", async () => {
    const overview = await answer<BillingOverview>(await getSubscriptions(req("/subscriptions")));
    expect(overview.subscriptions).toHaveLength(1);
    expect(overview.subscriptions[0]).toMatchObject({ planId: "trial", status: "trialing", priceKrw: 0 });
    expect(new Date(overview.subscriptions[0].periodEnd!).getTime() - new Date(overview.subscriptions[0].periodStart!).getTime()).toBe(7 * 86400000);
    expect(overview.entitlement).toMatchObject({ active: true, usage: { services: 1, members: 2, subjects: 0, forms: 0 } });
    const foreign = await answer<BillingOverview>(await getSubscriptions(req("/subscriptions", "GET", "foreign")));
    expect(foreign.subscriptions[0].id).not.toBe(overview.subscriptions[0].id);
    await answer(await getSubscriptions(req("/subscriptions", "GET", "admin")), 403);
  });
  test("asset usage comes from company data and rejects other roles", async () => {
    await answer(await getAssets(req("/assets", "GET", "anonymous")), 401);
    await answer(await getAssets(req("/assets", "GET", "admin")), 403);
    await answer(await getEntitlements(req("/entitlements", "GET", "admin")), 403);
    const before = await answer<AssetOverview>(await getAssets(req("/assets")));
    expect(before.services).toHaveLength(1);
    const foreign = await answer<AssetOverview>(await getAssets(req("/assets", "GET", "foreign")));
    expect(foreign.services.map(service => service.id)).not.toContain(before.services[0].id);
    const owner = await db.user.findFirstOrThrow({ where: { name: "owner" } });
    const identity = subjectHashes("합성 자산", `asset-${randomUUID()}@example.test`);
    const subject = await db.dataSubject.create({ data: { tenantId: companies.owner, serviceId: before.services[0].id,
      identityHash: identity.identityHash, nameHash: identity.nameHash, emailHash: identity.emailHash,
      contactCipher: encrypt(identity.normalized) } });
    const form = await db.form.create({ data: { tenantId: companies.owner, serviceId: before.services[0].id,
      ownerId: owner.id, title: "합성 자산 검증" } });
    try {
      const after = await answer<AssetOverview>(await getAssets(req("/assets")));
      expect(after.services[0]).toMatchObject({ subjects: 1, forms: 1 });
      expect(after.entitlement.usage).toMatchObject({ subjects: 1, forms: 1 });
      expect(await answer<EntitlementRecord>(await getEntitlements(req("/entitlements")))).toEqual(after.entitlement);
      expect((await answer<AssetOverview>(await getAssets(req("/assets", "GET", "foreign")))).services[0]).toMatchObject({ subjects: 0, forms: 0 });
    } finally {
      await db.form.delete({ where: { id: form.id } });
      await db.dataSubject.delete({ where: { id: subject.id } });
    }
  });
  test("server owns price, yearly unverified version is unavailable, and paid state cannot be forged", async () => {
    const plans = await answer<PlanRecord[]>(await getPlans(req("/plans")));
    const monthly = plans.find(p => p.id === "privacy_lifecycle")!.versions.find(v => v.cycle === "month")!;
    const yearly = plans.find(p => p.id === "privacy_lifecycle")!.versions.find(v => v.cycle === "year")!;
    expect(monthly).toMatchObject({ priceKrw: 50000, orderable: true });
    expect(yearly).toMatchObject({ priceKrw: null, orderable: false });
    await answer(await postSubscription(req("/subscriptions", "POST", "owner", { planVersionId: monthly.id, priceKrw: 1 }, { "idempotency-key": randomUUID() })), 422);
    await answer(await postSubscription(req("/subscriptions", "POST", "owner", { planVersionId: yearly.id }, { "idempotency-key": randomUUID() })), 409);
    await expect(db.billingPlanVersion.update({ where: { id: monthly.id }, data: { priceKrw: 1 } })).rejects.toThrow();
    await expect(db.billingSubscription.create({ data: { tenantId: companies.owner, planId: "privacy_lifecycle", planVersionId: monthly.id,
      status: "active", priceKrw: 50000 } })).rejects.toThrow();
  });
  test("purchase request is idempotent, pending only, and cancellable with version", async () => {
    const payload = { planVersionId: "privacy-lifecycle-month-v1" }, key = randomUUID();
    const [a, b] = await Promise.all([1, 2].map(() => postSubscription(req("/subscriptions", "POST", "owner", payload, { "idempotency-key": key })).then(r => answer<SubscriptionRecord>(r, 202))));
    expect(a.id).toBe(b.id); expect(a).toMatchObject({ status: "pending", priceKrw: 50000, version: 1 });
    await answer(await postSubscription(req("/subscriptions", "POST", "owner", payload, { "idempotency-key": randomUUID() })), 409);
    await answer(await postSubscription(req("/subscriptions", "POST", "owner", { planVersionId: "policy-management-month-v1" }, { "idempotency-key": key })), 409);
    const before = await answer<BillingOverview>(await getSubscriptions(req("/subscriptions")));
    expect(before.entitlement.active).toBe(true); expect(before.subscriptions.find(s => s.id === a.id)?.status).toBe("pending");
    const history = await answer<BillingHistoryList>(await getBillingHistory(req("/billing-history")));
    expect(history.total).toBe(1);
    expect(history.items.some(item => item.id === a.id)).toBe(false);
    await answer(await postSubscription(req(`/subscriptions/${a.id}/cancel`, "POST", "foreign", { version: 1 }, { "idempotency-key": randomUUID() })), 404);
    await answer(await postSubscription(req(`/subscriptions/${a.id}/cancel`, "POST", "owner", { version: 999 }, { "idempotency-key": randomUUID() })), 409);
    const cancelled = await answer<SubscriptionRecord>(await postSubscription(req(`/subscriptions/${a.id}/cancel`, "POST", "owner", { version: 1 }, { "idempotency-key": randomUUID() })));
    expect(cancelled).toMatchObject({ status: "cancelled", version: 2, priceKrw: 50000 });
    const events = await db.billingSubscriptionEvent.findMany({ where: { subscriptionId: a.id }, orderBy: { version: "asc" } });
    expect(events.map(e => e.kind)).toEqual(["purchase_requested", "request_cancelled"]);
    await expect(db.billingSubscriptionEvent.update({ where: { id: events[0].id }, data: { kind: "request_cancelled" } })).rejects.toThrow();
  });
  test("schedules and revokes early trial termination with tenant scope, version and server cutoff", async () => {
    const trial = (await answer<BillingOverview>(await getSubscriptions(req("/subscriptions")))).subscriptions.find(row => row.planId === "trial")!;
    const effectiveAt = new Date(Date.now() + 3600000).toISOString(), key = randomUUID();
    await answer(await postSubscription(req(`/subscriptions/${trial.id}/schedule-cancel`, "POST", "foreign",
      { version: trial.version, effectiveAt }, { "idempotency-key": randomUUID() })), 404);
    await answer(await postSubscription(req(`/subscriptions/${trial.id}/schedule-cancel`, "POST", "owner",
      { version: trial.version, effectiveAt: new Date(Date.now() + 8 * 86400000).toISOString() }, { "idempotency-key": randomUUID() })), 422);
    const scheduled = await answer<SubscriptionRecord>(await postSubscription(req(`/subscriptions/${trial.id}/schedule-cancel`, "POST", "owner",
      { version: trial.version, effectiveAt }, { "idempotency-key": key })));
    expect(scheduled).toMatchObject({ status: "trialing", cancelAt: effectiveAt, version: trial.version + 1 });
    const replay = await answer<SubscriptionRecord>(await postSubscription(req(`/subscriptions/${trial.id}/schedule-cancel`, "POST", "owner",
      { version: trial.version, effectiveAt }, { "idempotency-key": key })));
    expect(replay.id).toBe(scheduled.id);
    const overview = await answer<BillingOverview>(await getSubscriptions(req("/subscriptions")));
    expect(overview.entitlement.periodEnd).toBe(effectiveAt);
    await answer(await postSubscription(req(`/subscriptions/${trial.id}/undo-cancel`, "POST", "owner",
      { version: trial.version }, { "idempotency-key": randomUUID() })), 409);
    const undone = await answer<SubscriptionRecord>(await postSubscription(req(`/subscriptions/${trial.id}/undo-cancel`, "POST", "owner",
      { version: scheduled.version }, { "idempotency-key": randomUUID() })));
    expect(undone).toMatchObject({ cancelAt: null, version: scheduled.version + 1 });
    await expect(db.billingSubscription.update({ where: { id: trial.id }, data: { status: "expired", version: { increment: 1 } } })).rejects.toThrow();
    const events = await db.billingSubscriptionEvent.findMany({ where: { subscriptionId: trial.id }, orderBy: { version: "asc" } });
    expect(events.map(event => event.kind)).toEqual(["trial_started", "trial_cancel_scheduled", "trial_cancel_revoked"]);
  });
  test("cuts off access at the scheduled instant and expires once under two workers", async () => {
    const tenantId = randomUUID(), start = new Date(Date.now() - 2 * 86400000), cancelAt = new Date(Date.now() - 3600000);
    await db.company.create({ data: { id: tenantId, name: "만료 경계", publicName: "만료 경계" } });
    const trial = await db.billingSubscription.create({ data: { tenantId, planId: "trial", planVersionId: "trial-v1", status: "trialing",
      priceKrw: 0, activationSource: "trial", periodStart: start, periodEnd: new Date(start.getTime() + 7 * 86400000), cancelAt,
      events: { create: { version: 1, kind: "trial_started", detail: {} } } } });
    await expect(db.$transaction(tx => assertQuota(tx, tenantId, "services"))).rejects.toMatchObject({ status: 402 });
    const results = await Promise.all([expireSubscriptions(), expireSubscriptions()]);
    expect(results.sort()).toEqual([0, 1]);
    const stored = await db.billingSubscription.findUniqueOrThrow({ where: { id: trial.id }, include: { events: true } });
    expect(stored).toMatchObject({ status: "expired", version: 2 });
    expect(stored.events.map(event => event.kind).sort()).toEqual(["trial_expired", "trial_started"]);
    expect(await expireSubscriptions()).toBe(0);
  });
  test("serializes concurrent service creation at the trial limit", async () => {
    const create = (name: string) => postService(req("/services", "POST", "owner", { name, externalName: name }));
    for (let i = 1; i < 9; i++) await answer(await create(`합성 서비스 ${i}`), 201);
    const pair = await Promise.all([create("경쟁 서비스 A"), create("경쟁 서비스 B")]);
    expect(pair.map(r => r.status).sort()).toEqual([201, 409]);
    const overview = await answer<BillingOverview>(await getSubscriptions(req("/subscriptions")));
    expect(overview.entitlement.usage.services).toBe(10);
  });
  test("무제한 한도는 자원 생성을 막지 않고 가격 개정은 기존 청구를 바꾸지 않는다", async () => {
    const tenantId = randomUUID(), secret = "sub-limit-secret-0123456789";
    await db.company.create({ data: { id: tenantId, name: "무제한 회사", publicName: "무제한" } });
    const plan = await db.billingPlan.create({ data: { id: "unlimited-" + randomUUID(), name: "무제한 상품" } });
    // v1: 무제한 한도 77,000원 — v2: 유한 한도 150,000원을 나중에 발행한다
    const v1 = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 77000, currency: "KRW",
      serviceLimit: null, memberLimit: null, subjectLimit: null, formLimit: null, features: {}, orderable: true, effectiveFrom: new Date("2026-01-01") } });
    const pending = await db.billingSubscription.create({ data: { tenantId, planId: plan.id, planVersionId: v1.id, status: "pending",
      priceKrw: 77000, currency: "KRW", events: { create: { version: 1, kind: "purchase_requested", detail: {} } } } });
    // 대기 구독은 권한을 주지 않는다 — 결제 전 생성이 거부된다
    await expect(db.$transaction(tx => assertQuota(tx, tenantId, "services"))).rejects.toMatchObject({ status: 402 });
    // 같은 플랜에 더 비싼 신버전을 발행해도 대기 중인 청구는 v1 가격에 고정된다
    await db.billingPlanVersion.create({ data: { planId: plan.id, number: 2, cycle: "month", priceKrw: 150000, currency: "KRW",
      serviceLimit: 1, memberLimit: 1, subjectLimit: 1, formLimit: 1, features: {}, orderable: true, effectiveFrom: new Date("2026-06-01") } });
    expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: pending.id } }))).toMatchObject({ priceKrw: 77000, planVersionId: v1.id });
    const order = await db.paymentOrder.create({ data: { tenantId, subscriptionId: pending.id, amount: 77000, currency: "KRW", status: "pending" } });
    const paid = JSON.stringify({ orderId: order.id, eventId: "ev-unlim-" + randomUUID().slice(0, 8), outcome: "paid" });
    await applyPaymentEvent(paid, createHmac("sha256", secret).update(paid).digest("hex"), secret);
    const settled = await db.billingSubscription.findUniqueOrThrow({ where: { id: pending.id } });
    expect(settled).toMatchObject({ status: "active", priceKrw: 77000, planVersionId: v1.id });
    expect((await db.ledgerTransaction.findFirstOrThrow({ where: { tenantId, kind: "funding", sourceId: order.id } })).amount).toBe(BigInt(77000));
    // 서버가 주문 금액을 대기 구독의 핀 가격에서 뽑는다 — API 경로로도 확인한다
    const ownerSub = await db.billingSubscription.create({ data: { tenantId: companies.owner, planId: plan.id, planVersionId: v1.id,
      status: "pending", priceKrw: 77000, currency: "KRW", events: { create: { version: 1, kind: "purchase_requested", detail: {} } } } });
    const created = await answer<{ id: string; amount: number }>(await createOrder(req("/billing/orders", "POST", "owner",
      { subscriptionId: ownerSub.id }, { "idempotency-key": randomUUID() })), 201);
    expect(created.amount).toBe(77000);
    // 활성화된 무제한 구독은 네 자원 모두 한도 없이 허용한다 — 유한 시드 한도(10)를 넘겨 검증한다
    for (const resource of ["services", "members", "subjects", "forms"] as const)
      await db.$transaction(tx => assertQuota(tx, tenantId, resource));
    for (let i = 0; i < 12; i++) await db.service.create({ data: { tenantId, name: "무제한 서비스 " + i, externalName: "s" + i } });
    await db.$transaction(tx => assertQuota(tx, tenantId, "services"));
  });
  test("expired trial never grants an entitlement", async () => {
    const expired = randomUUID(), start = new Date(Date.now() - 8 * 86400000);
    await db.company.create({ data: { id: expired, name: "만료 회사", publicName: "만료 회사" } });
    await db.billingSubscription.create({ data: { tenantId: expired, planId: "trial", planVersionId: "trial-v1",
      status: "expired", priceKrw: 0, activationSource: "trial", periodStart: start,
      periodEnd: new Date(start.getTime() + 7 * 86400000) } });
    await expect(db.$transaction(tx => assertQuota(tx, expired, "services"))).rejects.toMatchObject({ status: 402, code: "SUBSCRIPTION_REQUIRED" });
  });
});
