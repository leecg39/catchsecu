import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/server/db";

const base = "http://127.0.0.1:3168", output = "docs/qa/P10-T04/subscription-authority/";
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const marker = ".local/qa-subscription-authority.json";
type Fixture = { email: string; password: string; userId: string; tenantId: string; memberId: string;
  purchaseKey: string; purchasedId: string; activeId: string; complete: boolean };
const results: { action: string; status: number; code?: string }[] = [];
let cookie = "";
async function request(path: string, method = "GET", input?: unknown, expected: number | number[] = 200, key: string = randomUUID()) {
  const response = await fetch(base + "/api/v1" + path, { method, redirect: "manual",
    headers: { origin: base, cookie, "idempotency-key": key,
      ...(input === undefined ? {} : { "content-type": "application/json" }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.clone().json();
  results.push({ action: method + " " + path, status: response.status, ...(value.error ? { code: value.error.code } : {}) });
  writeFileSync(output + "http-progress.json", JSON.stringify({ results }, null, 2));
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), path + ": " + response.status);
  return response;
}
async function login(fixture: Fixture) {
  const response = await request("/auth/sign-in/email", "POST", { email: fixture.email, password: fixture.password });
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert.ok(cookie);
}
async function fingerprint(fixture: Fixture) {
  const subscriptions = await db.billingSubscription.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" } });
  const events = await db.billingSubscriptionEvent.findMany({ where: { subscription: { tenantId: fixture.tenantId } }, orderBy: { id: "asc" } });
  const audits = await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId, action: { startsWith: "billing." } }, orderBy: { id: "asc" } });
  return { sha256: createHash("sha256").update(JSON.stringify({ subscriptions, events, audits })).digest("hex"),
    counts: { subscriptions: subscriptions.length, events: events.length, audits: audits.length } };
}
async function syntheticPaid(tenantId: string) {
  const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "내부 권한 QA" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month",
    priceKrw: 12000, features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 86400e3) } });
  const pending = await db.billingSubscription.create({ data: { tenantId, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000 } });
  await db.paymentOrder.create({ data: { tenantId, subscriptionId: pending.id, amount: 12000, currency: "KRW", status: "paid" } });
  return db.billingSubscription.update({ where: { id: pending.id }, data: { status: "active", version: 2, activationSource: "payment",
    periodStart: new Date(Date.now() - 86400e3), periodEnd: new Date(Date.now() + 30 * 86400e3) } });
}
const purchase = { planVersionId: "privacy-lifecycle-month-v1" };
try {
  const restart = process.argv.includes("--verify-restart");
  if (restart) {
    const fixture = JSON.parse(readFileSync(marker, "utf8")) as Fixture;
    assert.ok(fixture.complete);
    const prior = JSON.parse(readFileSync(output + "http.json", "utf8"));
    assert.deepEqual(await fingerprint(fixture), prior.fingerprint);
    await login(fixture);
    const replay = await (await request("/subscriptions", "POST", purchase, 202, fixture.purchaseKey)).json();
    assert.equal(replay.status, "cancelled"); assert.equal(replay.id, fixture.purchasedId);
    await request("/subscriptions");
    assert.deepEqual(await fingerprint(fixture), prior.fingerprint);
    await request("/auth/sign-out", "POST", {});
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    writeFileSync(output + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results,
      fingerprint: prior.fingerprint, preserved: true, ownSessionsRemaining: 0 }, null, 2) + "\n");
  } else {
    assert.equal(existsSync(marker), false, "기존 실행 상태를 확인하세요.");
    const fixture: Fixture = { email: "sub-authority-" + randomUUID() + "@catchsecu.test", password: "Authority!" + randomUUID(),
      userId: "", tenantId: "", memberId: "", purchasedId: "", activeId: "", purchaseKey: randomUUID(), complete: false };
    writeFileSync(marker, JSON.stringify(fixture), { mode: 0o600 });
    await request("/auth/sign-up/email", "POST", { email: fixture.email, password: fixture.password, name: "구독 권한 QA" });
    const user = await db.user.update({ where: { email: fixture.email }, data: { emailVerified: true } });
    const owner = await db.user.create({ data: { name: "QA 소유자", email: "sub-owner-" + randomUUID() + "@catchsecu.test", emailVerified: true } });
    const company = await db.company.create({ data: { name: "구독 권한 QA", publicName: "구독 권한 QA", policy: { create: {} },
      memberships: { create: [{ userId: user.id, role: "billing" }, { userId: owner.id, role: "owner" }] } }, include: { memberships: true } });
    fixture.userId = user.id; fixture.tenantId = company.id;
    fixture.memberId = company.memberships.find(row => row.userId === user.id)!.id;
    writeFileSync(marker, JSON.stringify(fixture), { mode: 0o600 });
    await login(fixture); await request("/plans");
    const created = await (await request("/subscriptions", "POST", purchase, 202, fixture.purchaseKey)).json();
    fixture.purchasedId = created.id;
    await request("/subscriptions/" + created.id + "/cancel", "POST", { version: created.version });
    const purchaseReplay = await (await request("/subscriptions", "POST", purchase, 202, fixture.purchaseKey)).json();
    assert.equal(purchaseReplay.status, "cancelled"); assert.equal(purchaseReplay.version, 2);
    const active = await syntheticPaid(company.id); fixture.activeId = active.id;
    const path = "/subscriptions/" + active.id, key = randomUUID();
    const schedule = { version: 2, effectiveAt: new Date(Date.now() + 86400e3).toISOString(), reason: "최초 사유" };
    await request(path + "/schedule-cancel", "POST", schedule, 200, key);
    const mismatch = await (await request(path + "/schedule-cancel", "POST", { ...schedule, reason: "변경 사유" }, 409, key)).json();
    assert.equal(mismatch.error.code, "IDEMPOTENCY_MISMATCH");
    const undoKey = randomUUID();
    await request(path + "/undo-cancel", "POST", { version: 3 }, 200, undoKey);
    const replay = await (await request(path + "/schedule-cancel", "POST", schedule, 200, key)).json();
    assert.equal(replay.cancelAt, null); assert.equal(replay.version, 4);
    await request(path + "/schedule-cancel", "POST", { ...schedule, version: 4 });
    const undoReplay = await (await request(path + "/undo-cancel", "POST", { version: 3 }, 200, undoKey)).json();
    assert.equal(undoReplay.cancelAt, schedule.effectiveAt); assert.equal(undoReplay.version, 5);
    const pair = await Promise.all([request(path + "/undo-cancel", "POST", { version: 5 }, [200, 409]),
      request(path + "/undo-cancel", "POST", { version: 5 }, [200, 409])]);
    assert.deepEqual(pair.map(r => r.status).sort(), [200, 409]);
    assert.equal((await pair.find(r => r.status === 409)!.json()).error.code, "VERSION_CONFLICT");
    await db.membership.update({ where: { id: fixture.memberId }, data: { role: "viewer", version: { increment: 1 } } });
    await request("/subscriptions", "POST", purchase, 403, fixture.purchaseKey);
    await request("/subscriptions", "GET", undefined, 403);
    await db.membership.update({ where: { id: fixture.memberId }, data: { role: "billing", version: { increment: 1 } } });
    await request("/subscriptions");
    const final = await fingerprint(fixture); assert.equal(final.counts.subscriptions, 2);
    await request("/auth/sign-out", "POST", {});
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
    fixture.complete = true; writeFileSync(marker, JSON.stringify(fixture), { mode: 0o600 });
    writeFileSync(output + "http.json", JSON.stringify({ at: new Date().toISOString(), results, fingerprint: final,
      concurrentStatuses: [200, 409], scope: "Isolated test database; synthetic paid fixture, no external payment", ownSessionsRemaining: 0 }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ phase: restart ? "restart" : "initial", requests: results.length, passed: true }));
} finally { await db.$disconnect(); }
