import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const file = ".local/rea-fullstack/sso/ticket-http.json", out = "docs/qa/R07-T04/management-flow/ticket-http.json";
const f = { tag: randomUUID(), email: "", password: randomBytes(24).toString("hex") + "Aa!1", pin: randomBytes(12).toString("hex"), cookie: "", companyId: "", providerId: "" };
const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
const checks: { name: string; status: number; code?: string }[] = [];
async function request(path: string, body: unknown, method = "POST", authenticated = true, key?: string) {
  return fetch(origin + "/api/v1" + path, { method, headers: { origin, "content-type": "application/json", ...(authenticated ? { cookie: f.cookie } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
}
async function check(name: string, response: Response, expected = 200) {
  const body = await response.json(); assert.equal(response.status, expected, body.error?.code);
  checks.push({ name, status: response.status, ...(body.error ? { code: body.error.code } : {}) }); return body;
}
try {
  await mkdir(".local/rea-fullstack/sso", { recursive: true, mode: 0o700 });
  try { await readFile(file); throw Error("Existing ticket HTTP fixture must not be replayed"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  f.email = `rea-org-ticket-${f.tag}@catchsecu.test`; await save();
  await check("synthetic sign-up", await request("/auth/sign-up/email", { email: f.email, password: f.password, name: "REA 티켓 시험" }));
  const user = await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
  f.companyId = (await db.company.create({ data: { name: "REA 티켓 " + f.tag.slice(0, 8), publicName: "REA 티켓", policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId: user.id, role: "owner" } } } })).id; await save();
  const signed = await request("/auth/sign-in/email", { email: f.email, password: f.password }); await check("actual sign-in", signed);
  f.cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); await save();
  const provider = await check("virtual provider create", await request("/security/sso", { tenantId: f.companyId, protocol: "gpki", name: "가상 티켓 시험" }, "POST", true, randomUUID()), 201);
  f.providerId = provider.id; await save();
  const active = await check("virtual provider enable", await request(`/security/sso/${provider.id}`, { version: provider.version, enabled: true }, "PATCH"));
  const path = `/security/sso/${provider.id}/directory`, credentials = { protocol: "gpki", orgCode: "TICKET-" + f.tag.slice(0, 8), employeeNo: "EMP-01", pin: f.pin };
  const member = await check("member create without email", await request(path, { orgCode: credentials.orgCode, employeeNo: credentials.employeeNo, pin: f.pin, name: "티켓 구성원" }, "POST", true, randomUUID()), 201);
  const first = await check("initial ticket issued", await request("/auth/org/login", credentials, "POST", false)); assert.equal(first.status, "email-register");
  assert.equal(await db.ssoState.count({ where: { orgMemberId: member.id } }), 1);
  const updated = await check("directory update revokes ticket", await request(`${path}/${member.id}`, { version: member.version, name: "변경된 구성원" }, "PATCH"));
  await check("old ticket rejected after update", await request("/auth/org/email-register", { ticket: first.ticket, email: "never-created@catchsecu.test", challengeId: randomUUID(), code: "000000" }, "POST", false), 401);
  assert.equal(await db.ssoState.count({ where: { orgMemberId: member.id } }), 0);
  const second = await check("new credentials snapshot issues fresh ticket", await request("/auth/org/login", credentials, "POST", false)); assert.equal(second.status, "email-register");
  await check("directory delete revokes ticket", await request(`${path}/${member.id}`, { version: updated.version }, "DELETE"));
  await check("old ticket rejected after delete", await request("/auth/org/email-register", { ticket: second.ticket, email: "never-created@catchsecu.test", challengeId: randomUUID(), code: "000000" }, "POST", false), 401);
  await check("provider cleanup", await request(`/security/sso/${provider.id}`, { version: active.version }, "DELETE"));
  const pendingStates = await db.ssoState.count({ where: { tenantId: f.companyId } }); assert.equal(pendingStates, 0);
  assert.equal(await db.user.count({ where: { email: "never-created@catchsecu.test" } }), 0);
  const report = { actualHttp: true, syntheticCompanyId: f.companyId, emailVerifiedByFixture: true, count: checks.length, checks, pendingStates, externalInstitutionVerified: false,
    concurrencyEvidence: "docs/qa/R07-T02/core/regression-final.json; this HTTP probe verifies sequential ticket lifecycle on the rebuilt server" };
  await writeFile(out, JSON.stringify(report, null, 2) + "\n"); console.log({ checks: checks.length, pendingStates });
} finally { await db.$disconnect(); }
