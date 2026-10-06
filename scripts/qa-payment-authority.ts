import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/server/db";
const base = "http://127.0.0.1:3169", output = "docs/qa/P10-T02/current-authority/", marker = ".local/qa-payment-authority.json";
const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.pathname, "/catchsecu_test"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
type Fixture = { email: string; password: string; userId: string; tenantId: string; memberId: string; subscriptionId: string; orderId: string; methodId: string; key: string; complete: boolean };
const results: { action: string; status: number; code?: string }[] = [];
let cookie = "";
async function request(path: string, method = "GET", input?: unknown, expected: number | number[] = 200, key: string = randomUUID(), extra: Record<string, string> = {}) {
  const response = await fetch(base + "/api/v1" + path, { method, redirect: "manual", headers: { origin: base, cookie, "idempotency-key": key, ...(input === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.clone().json(); results.push({ action: method + " " + path, status: response.status, ...(value.error ? { code: value.error.code } : {}) });
  writeFileSync(output + "http-progress.json", JSON.stringify({ results }, null, 2));
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), path + ": " + response.status);
  return response;
}
async function login(f: Fixture) {
  const response = await request("/auth/sign-in/email", "POST", { email: f.email, password: f.password });
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert.ok(cookie);
}
async function fingerprint(f: Fixture) {
  const methods = await db.paymentMethod.findMany({ where: { tenantId: f.tenantId }, orderBy: { id: "asc" } });
  const orders = await db.paymentOrder.findMany({ where: { tenantId: f.tenantId }, orderBy: { id: "asc" } });
  const audits = await db.auditEvent.findMany({ where: { tenantId: f.tenantId, action: { startsWith: "billing." } }, orderBy: { id: "asc" } });
  return { sha256: createHash("sha256").update(JSON.stringify({ methods, orders, audits })).digest("hex"), counts: { methods: methods.length, orders: orders.length, audits: audits.length } };
}
const token = () => "pm_" + randomUUID().replace(/[0-9]/g, digit => String.fromCharCode(107 + Number(digit)));
try {
  const restart = process.argv.includes("--verify-restart");
  if (restart) {
    const f = JSON.parse(readFileSync(marker, "utf8")) as Fixture; assert.ok(f.complete);
    const prior = JSON.parse(readFileSync(output + "http.json", "utf8")); assert.deepEqual(await fingerprint(f), prior.fingerprint);
    await login(f);
    const replay = await (await request("/billing/orders", "POST", { subscriptionId: f.subscriptionId, methodId: f.methodId }, 201, f.key)).json();
    assert.equal(replay.id, f.orderId); assert.equal(replay.status, "paid");
    await request("/billing/methods?includeRevoked=true");
    assert.deepEqual(await fingerprint(f), prior.fingerprint);
    await request("/auth/sign-out", "POST", {}); assert.equal(await db.session.count({ where: { userId: f.userId } }), 0);
    writeFileSync(output + "http-restart.json", JSON.stringify({ results, fingerprint: prior.fingerprint, preserved: true, ownSessionsRemaining: 0 }, null, 2));
  } else {
    assert.equal(existsSync(marker), false, "기존 실행 상태를 확인하세요");
    const f: Fixture = { email: "pay-authority-" + randomUUID() + "@catchsecu.test", password: "Payment!" + randomUUID(), userId: "", tenantId: "", memberId: "", subscriptionId: "", orderId: "", methodId: "", key: randomUUID(), complete: false };
    writeFileSync(marker, JSON.stringify(f), { mode: 0o600 });
    await request("/auth/sign-up/email", "POST", { email: f.email, password: f.password, name: "결제 권한 QA" });
    const user = await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const owner = await db.user.create({ data: { name: "QA 소유자", email: randomUUID() + "@catchsecu.test", emailVerified: true } });
    const company = await db.company.create({ data: { name: "결제 내부 QA", publicName: "결제 내부 QA", policy: { create: {} }, memberships: { create: [{ userId: user.id, role: "billing" }, { userId: owner.id, role: "owner" }] } }, include: { memberships: true } });
    f.userId = user.id; f.tenantId = company.id; f.memberId = company.memberships.find(row => row.userId === user.id)!.id;
    writeFileSync(marker, JSON.stringify(f), { mode: 0o600 });
    await login(f);
    const first = await (await request("/billing/methods", "POST", { token: token(), kind: "card", label: "첫째" }, 201)).json();
    const second = await (await request("/billing/methods", "POST", { token: token(), kind: "card", label: "둘째", setDefault: true }, 201)).json();
    f.methodId = second.id;
    const methods = await (await request("/billing/methods")).json();
    assert.equal(methods.find((row: { id: string }) => row.id === first.id).version, 2);
    assert.ok(!JSON.stringify(methods).match(/tokenCipher|tokenHash|pm_/));
    await request("/billing/methods/" + first.id, "PATCH", { version: 1, label: "옛 변경" }, 409);
    await request("/billing/methods/" + first.id, "PATCH", { version: 2, label: "수정 이름" });
    const pair = await Promise.all([request("/billing/methods/" + first.id, "PATCH", { version: 3, label: "동시 가" }, [200, 409]), request("/billing/methods/" + first.id, "PATCH", { version: 3, label: "동시 나" }, [200, 409])]);
    assert.deepEqual(pair.map(response => response.status).sort(), [200, 409]);
    await request("/billing/methods/" + first.id, "DELETE", { version: 4 });
    const subscription = await (await request("/subscriptions", "POST", { planVersionId: "privacy-lifecycle-month-v1" }, 202)).json(); f.subscriptionId = subscription.id;
    const input = { subscriptionId: f.subscriptionId, methodId: f.methodId };
    const created = await (await request("/billing/orders", "POST", input, 201, f.key)).json(); f.orderId = created.id;
    await request("/billing/orders", "POST", { subscriptionId: f.subscriptionId }, 409);
    await request("/billing/methods/" + second.id, "DELETE", { version: 1 }, 409);
    await request("/billing/orders/" + created.id + "/return", "POST", { result: "success" }, 409);
    const payload = { orderId: created.id, eventId: randomUUID(), outcome: "paid" };
    const secret = process.env.PAYMENT_WEBHOOK_SECRET; assert.ok(secret);
    await request("/billing/provider-events", "POST", payload, 202, randomUUID(), { "x-payment-signature": createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex") });
    const replay = await (await request("/billing/orders", "POST", input, 201, f.key)).json(); assert.equal(replay.status, "paid"); assert.equal(replay.version, 2);
    await db.membership.update({ where: { id: f.memberId }, data: { role: "viewer", version: { increment: 1 } } });
    await request("/billing/orders", "POST", input, 403, f.key); await request("/billing/methods", "GET", undefined, 403);
    await db.membership.update({ where: { id: f.memberId }, data: { role: "billing", version: { increment: 1 } } });
    await request("/billing/orders");
    const final = await fingerprint(f);
    await request("/auth/sign-out", "POST", {}); assert.equal(await db.session.count({ where: { userId: f.userId } }), 0);
    f.complete = true; writeFileSync(marker, JSON.stringify(f), { mode: 0o600 });
    writeFileSync(output + "http.json", JSON.stringify({ results, fingerprint: final, ownSessionsRemaining: 0, provider: "synthetic signed local event; no real PG" }, null, 2));
  }
  console.log(JSON.stringify({ passed: results.length, restart }));
} finally { await db.$disconnect(); }
