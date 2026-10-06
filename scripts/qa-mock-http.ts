import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const database = new URL(env.DATABASE_URL), base = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_mock_admin");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.ok(["localhost", "127.0.0.1", "catchsecu-mock.localhost"].includes(new URL(base).hostname));
const networkBase = "http://127.0.0.1:" + new URL(base).port;
const out = "docs/qa/mock-completion/http";
await mkdir(out, { recursive: true });
const checks: { step: string; status: number }[] = [];
let cookie = "";
async function request(step: string, path: string, expected: number, method = "GET", input?: unknown, extra: Record<string, string> = {}) {
  const response = await fetch(networkBase + "/api/v1" + path, { method, headers: { host: new URL(base).host, origin: base, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), redirect: "manual" });
  checks.push({ step, status: response.status });
  assert.equal(response.status, expected, step);
  return response;
}
try {
  await request("health", "/health", 200);
  await request("ready", "/ready", 200);
  await request("anonymous admin blocked", "/admin/plans", 401);
  const email = "mock-http-" + randomUUID() + "@catchsecu.test", password = randomBytes(18).toString("base64url") + "!1aA";
  await request("signup", "/auth/sign-up/email", 200, "POST", { email, password, name: "Mock HTTP" });
  const user = await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin: true } });
  const company = await db.company.create({ data: { name: "Mock HTTP 회사", publicName: "Mock HTTP", policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "Mock 서비스", externalName: "Mock" } } }, include: { services: true } });
  const login = await request("login", "/auth/sign-in/email", 200, "POST", { email, password });
  cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  const planId = "mock-http-" + randomUUID();
  const plan = { id: planId, name: "Mock 상품", version: { number: 1, cycle: "month", priceKrw: 12000, orderable: false } };
  await request("create plan", "/admin/plans", 201, "POST", plan);
  await request("duplicate plan", "/admin/plans", 409, "POST", plan);
  await request("read plan", "/admin/plans/" + planId, 200);
  await request("update plan", "/admin/plans/" + planId, 200, "PATCH", { name: "변경됨" });
  await request("new version", "/admin/plans/" + planId, 200, "PATCH", { version: { ...plan.version, number: 2, priceKrw: 24000 } });
  for (const version of [{ currency: "USD" }, { priceKrw: 2147483648 }, { orderable: true, priceKrw: null }])
    await request("invalid plan input", "/admin/plans", 422, "POST", { ...plan, id: "invalid-" + randomUUID(), version: { ...plan.version, ...version } });
  await request("remove unused plan", "/admin/plans/" + planId, 204, "DELETE");
  await request("removed plan", "/admin/plans/" + planId, 404);
  const key = randomUUID(), ruleInput = { serviceId: company.services[0].id, retentionDays: 30, reason: "Mock 보유기간" };
  const rule = await (await request("create retention rule", "/retention-rules", 201, "POST", ruleInput, { "idempotency-key": key })).json();
  await request("update retention rule", "/retention-rules/" + rule.id, 200, "PATCH", { version: 1, retentionDays: 60 });
  const replay = await (await request("replay current retention", "/retention-rules", 201, "POST", ruleInput, { "idempotency-key": key })).json();
  assert.equal(replay.retentionDays, 60);
  await request("archive retention", "/retention-rules/" + rule.id, 204, "DELETE", undefined, { "if-match": "2" });
  await request("archived replay rejected", "/retention-rules", 410, "POST", ruleInput, { "idempotency-key": key });
  await db.user.update({ where: { id: user.id }, data: { platformAdmin: false } });
  await request("revoked administrator blocked", "/admin/plans", 403);
  await writeFile(".local/mock-http-browser.json", JSON.stringify({ email, password, base, companyId: company.id, userId: user.id }, null, 2), { mode: 0o600 });
  await writeFile(out + "/result.json", JSON.stringify({ checkedAt: new Date().toISOString(), evidenceLevel: "mock", result: "passed", checks, realExternalAcceptance: false }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", checks: checks.length }));
} catch (error) {
  await writeFile(out + "/result.json", JSON.stringify({ checkedAt: new Date().toISOString(), evidenceLevel: "mock", result: "failed", checks }, null, 2) + "\n");
  throw error;
} finally { await db.$disconnect(); }
