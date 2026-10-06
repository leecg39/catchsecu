import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/server/db";

const base = "http://127.0.0.1:3167", output = "docs/qa/P10-T04/expiration/";
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const marker = ".local/qa-paid-expiration.json";
type Fixture = { email: string; password: string; userId: string; tenantId: string; ids: string[]; complete: boolean };
const results: { action: string; status: number }[] = [];
let cookie = "";
async function request(path: string, method = "GET", input?: unknown, expected = 200) {
  const response = await fetch(base + "/api/v1" + path, { method, redirect: "manual",
    headers: { origin: base, cookie, ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  results.push({ action: method + " " + path, status: response.status });
  assert.equal(response.status, expected, path);
  return response;
}
async function login(fixture: Fixture) {
  const response = await request("/auth/sign-in/email", "POST", { email: fixture.email, password: fixture.password });
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookie);
}
async function fingerprint(fixture: Fixture) {
  const subscriptions = await db.billingSubscription.findMany({ where: { id: { in: fixture.ids } }, orderBy: { id: "asc" } });
  const events = await db.billingSubscriptionEvent.findMany({ where: { subscriptionId: { in: fixture.ids } }, orderBy: { id: "asc" } });
  const orders = await db.paymentOrder.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" } });
  const audits = await db.auditEvent.findMany({ where: { resourceId: { in: fixture.ids }, action: "billing.expired" }, orderBy: { id: "asc" } });
  return { sha256: createHash("sha256").update(JSON.stringify({ subscriptions, events, orders, audits })).digest("hex"),
    counts: { subscriptions: subscriptions.length, events: events.length, orders: orders.length, expirationAudits: audits.length } };
}
function worker() {
  // 사용자 개발 DB/상주 워커와 분리된 시험 DB에서 이번 작업 함수만 새 프로세스로 실행한다.
  const code = `import { db } from './src/server/db.ts'; import { expireSubscriptions } from './src/server/subscription-worker.ts';
    const u=new URL(process.env.DATABASE_URL); if(u.pathname!=='/catchsecu_test') throw new Error('test DB required');
    try { console.log(JSON.stringify({expired:await expireSubscriptions()})); } finally { await db.$disconnect(); }`;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code],
    { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { expired: number };
}
async function historicalSubscription(tenantId: string, due: boolean) {
  const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "내부 만료 QA" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month",
    priceKrw: 12000, currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 60 * 86400e3) } });
  const pending = await db.billingSubscription.create({ data: { tenantId, planId: plan.id, planVersionId: version.id,
    status: "pending", priceKrw: 12000, events: { create: { version: 1, kind: "purchase_requested", detail: {} } } } });
  const order = await db.paymentOrder.create({ data: { tenantId, subscriptionId: pending.id, amount: 12000, currency: "KRW", status: "paid" } });
  return db.billingSubscription.update({ where: { id: pending.id }, data: { status: "active", version: { increment: 1 },
    periodStart: new Date(Date.now() - 31 * 86400e3), periodEnd: new Date(Date.now() + (due ? -1 : 1) * 86400e3),
    activationSource: "payment", events: { create: { version: 2, kind: "activated", detail: { orderId: order.id } } } } });
}

try {
  const restart = process.argv.includes("--verify-restart");
  if (restart) {
    const fixture = JSON.parse(readFileSync(marker, "utf8")) as Fixture;
    assert.ok(fixture.complete);
    const prior = JSON.parse(readFileSync(output + "http.json", "utf8"));
    assert.deepEqual(await fingerprint(fixture), prior.fingerprint);
    await login(fixture);
    const overview = await (await request("/subscriptions")).json();
    assert.equal(overview.entitlement.active, false);
    for (const id of fixture.ids) assert.equal(overview.subscriptions.find((row: { id: string }) => row.id === id).status, "expired");
    const repeatedWorker = worker();
    assert.equal(repeatedWorker.expired, 0);
    assert.deepEqual(await fingerprint(fixture), prior.fingerprint);
    await request("/auth/sign-out", "POST", {});
    writeFileSync(output + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results,
      repeatedWorker, fingerprintPreserved: true, fingerprint: prior.fingerprint }, null, 2) + "\n");
  } else {
    assert.equal(existsSync(marker), false, "기존 실행을 확인한 뒤 별도 QA 자료로 재시험하세요.");
    const fixture: Fixture = { email: "expiry-" + randomUUID() + "@catchsecu.test", password: "Expiry!" + randomUUID(),
      userId: "", tenantId: "", ids: [], complete: false };
    writeFileSync(marker, JSON.stringify(fixture), { mode: 0o600 });
    await request("/auth/sign-up/email", "POST", { name: "내부 유료 만료 QA", email: fixture.email, password: fixture.password });
    const user = await db.user.update({ where: { email: fixture.email }, data: { emailVerified: true } });
    const company = await db.company.create({ data: { name: "내부 만료 QA", publicName: "내부 만료 QA",
      policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } } } });
    fixture.userId = user.id; fixture.tenantId = company.id;
    const natural = await historicalSubscription(company.id, true), scheduled = await historicalSubscription(company.id, false);
    fixture.ids = [natural.id, scheduled.id];
    writeFileSync(marker, JSON.stringify(fixture), { mode: 0o600 });
    await login(fixture);
    const before = await (await request("/subscriptions")).json();
    assert.equal(before.subscriptions.find((row: { id: string }) => row.id === natural.id).status, "expired");
    assert.equal((await db.billingSubscription.findUniqueOrThrow({ where: { id: natural.id } })).status, "active");
    assert.equal(before.entitlement.active, true);
    const effectiveAt = new Date(Date.now() + 5000).toISOString();
    const response = await (await request("/subscriptions/" + scheduled.id + "/schedule-cancel", "POST", { version: scheduled.version, effectiveAt })).json();
    assert.equal(response.cancelAt, effectiveAt);
    const firstWorker = worker();
    assert.ok(firstWorker.expired >= 1);
    assert.equal((await db.billingSubscription.findUniqueOrThrow({ where: { id: natural.id } })).status, "expired");
    assert.equal((await db.billingSubscription.findUniqueOrThrow({ where: { id: scheduled.id } })).status, "active");
    await db.$executeRaw`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (${new Date(effectiveAt)}::timestamp - (clock_timestamp() AT TIME ZONE 'UTC')))) + 0.05)`;
    const atBoundary = await (await request("/subscriptions/entitlement")).json();
    assert.equal(atBoundary.active, false);
    assert.equal((await db.billingSubscription.findUniqueOrThrow({ where: { id: scheduled.id } })).status, "active");
    const secondWorker = worker(); assert.equal(secondWorker.expired, 1);
    const overview = await (await request("/subscriptions")).json();
    for (const id of fixture.ids) assert.equal(overview.subscriptions.find((row: { id: string }) => row.id === id).status, "expired");
    const final = await fingerprint(fixture);
    assert.equal(final.counts.expirationAudits, 2);
    assert.equal(await db.billingSubscriptionEvent.count({ where: { subscriptionId: { in: fixture.ids }, kind: "expired" } }), 2);
    const kinds = await db.billingSubscriptionEvent.findMany({ where: { subscriptionId: { in: fixture.ids }, kind: "expired" }, select: { detail: true } });
    assert.deepEqual(kinds.map(row => (row.detail as { reason: string }).reason).sort(), ["period_end", "scheduled_cancel"]);
    await request("/auth/sign-out", "POST", {});
    fixture.complete = true; writeFileSync(marker, JSON.stringify(fixture), { mode: 0o600 });
    writeFileSync(output + "http.json", JSON.stringify({ at: new Date().toISOString(), results,
      firstWorker, secondWorker, readBoundaryEnforcedBeforeWorker: true, fingerprint: final,
      fixtureScope: "Isolated test database; synthetic historical paid subscriptions, no external payment" }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ phase: restart ? "restart" : "initial", requests: results.length, passed: true }));
} finally { await db.$disconnect(); }
