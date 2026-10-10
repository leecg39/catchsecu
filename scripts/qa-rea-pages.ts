import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const origin = new URL(env.BETTER_AUTH_URL).origin;
const database = new URL(env.DATABASE_URL);
assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100");
assert.equal(env.MAIL_TRANSPORT, "local", "QA must never send external email");
const local = ".local/rea-fullstack", evidence = "docs/qa/R16-T04/route-connection";
await mkdir(local, { recursive: true }); await mkdir(evidence, { recursive: true });
type Actor = { email: string; password: string; userId: string; companyId: string; serviceId: string };
type Fixture = { origin: string; owner: Actor; other: Actor; viewer: Actor; ruleId?: string };
const checks: Array<{ name: string; status: number; code?: string }> = [];
async function request(path: string, cookie: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }), redirect: "manual" });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}
async function login(actor: Pick<Actor, "email" | "password">) {
  const result = await request("/auth/sign-in/email", "", "POST", { email: actor.email, password: actor.password });
  assert.equal(result.response.status, 200, "fixture login");
  return result.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
async function account(label: string, tenant?: Actor): Promise<Actor> {
  const email = `rea-${label}-${randomUUID()}@catchsecu.test`, password = randomBytes(24).toString("hex") + "Aa!";
  const signed = await request("/auth/sign-up/email", "", "POST", { email, password, name: "REA " + label });
  assert.equal(signed.response.status, 200, "local fixture signup");
  // Only this newly created, local-only QA account is verified directly.
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const cookie = await login({ email, password });
  if (tenant) {
    await db.membership.create({ data: { tenantId: tenant.companyId, userId: user.id, role: "viewer" } });
    return { email, password, userId: user.id, companyId: tenant.companyId, serviceId: tenant.serviceId };
  }
  const company = await request("/companies", cookie, "POST", { name: "REA QA " + label + " " + new Date().toISOString(), publicName: "REA 시험 회사" });
  assert.equal(company.response.status, 201, "fixture company API");
  const services = await request("/services", cookie);
  assert.equal(services.response.status, 200);
  return { email, password, userId: user.id, companyId: company.body.id, serviceId: services.body.items[0].id };
}
let fixture: Fixture;
try { fixture = JSON.parse(await readFile(local + "/fixture.json", "utf8")); }
catch (cause) {
  if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  const owner = await account("owner"), other = await account("other"), viewer = await account("viewer", owner);
  fixture = { origin, owner, other, viewer };
  await writeFile(local + "/fixture.json", JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
}
assert.equal(fixture.origin, origin);
assert.ok(fixture.owner.email.startsWith("rea-owner-"));
const ownerCookie = await login(fixture.owner), otherCookie = await login(fixture.other), viewerCookie = await login(fixture.viewer);
async function check(name: string, path: string, cookie: string, status: number, method = "GET", body?: unknown, headers?: Record<string, string>) {
  const result = await request(path, cookie, method, body, headers);
  checks.push({ name, status: result.response.status, code: result.body?.error?.code });
  assert.equal(result.response.status, status, name + ": " + JSON.stringify(result.body));
  return result.body;
}
try {
  const input = { serviceId: fixture.owner.serviceId, retentionDays: 30, reason: "REA API 보유기간 검증" };
  const existing = await db.retentionRule.findUnique({ where: { tenantId_serviceId: { tenantId: fixture.owner.companyId, serviceId: fixture.owner.serviceId } } });
  if (existing?.status === "active") await check("prepare-own-rule-archive", "/retention-rules/" + existing.id, ownerCookie, 204, "DELETE", undefined, { "If-Match": String(existing.version) });
  await check("anonymous-read-denied", "/retention-rules", "", 401);
  await check("viewer-read-denied", "/retention-rules", viewerCookie, 403);
  await check("viewer-create-denied", "/retention-rules", viewerCookie, 403, "POST", input);
  await check("invalid-days-rejected", "/retention-rules", ownerCookie, 422, "POST", { ...input, retentionDays: 0 });
  await check("missing-idempotency-key-rejected", "/retention-rules", ownerCookie, 400, "POST", input);
  await check("cross-company-create-denied", "/retention-rules", ownerCookie, 404, "POST", { ...input, serviceId: fixture.other.serviceId }, { "Idempotency-Key": randomUUID() });
  const key = randomUUID();
  const created = await check("create", "/retention-rules", ownerCookie, 201, "POST", input, { "Idempotency-Key": key });
  fixture.ruleId = created.id;
  const replay = await check("create-idempotent", "/retention-rules", ownerCookie, 201, "POST", input, { "Idempotency-Key": key });
  assert.equal(replay.id, created.id);
  await check("duplicate-service-rule-conflict", "/retention-rules", ownerCookie, 409, "POST", input, { "Idempotency-Key": randomUUID() });
  const current = await check("detail", "/retention-rules/" + created.id, ownerCookie, 200);
  assert.equal(current.retentionDays, 30);
  const list = await check("service-filter-pagination", "/retention-rules?serviceId=" + fixture.owner.serviceId + "&pageSize=1", ownerCookie, 200);
  assert.equal(list.total, 1); assert.equal(list.items[0].id, created.id);
  await check("cross-company-read-denied", "/retention-rules/" + created.id, otherCookie, 404);
  await check("cross-company-update-denied", "/retention-rules/" + created.id, otherCookie, 404, "PATCH", { version: current.version, retentionDays: 90 });
  await check("cross-company-delete-denied", "/retention-rules/" + created.id, otherCookie, 404, "DELETE", undefined, { "If-Match": String(current.version) });
  const updated = await check("update", "/retention-rules/" + created.id, ownerCookie, 200, "PATCH", { version: current.version, retentionDays: 60, reason: "REA 수정 검증" });
  assert.equal(updated.version, current.version + 1);
  await check("stale-update-conflict", "/retention-rules/" + created.id, ownerCookie, 409, "PATCH", { version: current.version, retentionDays: 90 });
  await check("stale-delete-conflict", "/retention-rules/" + created.id, ownerCookie, 409, "DELETE", undefined, { "If-Match": String(current.version) });
  const stored = await db.retentionRule.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.tenantId, fixture.owner.companyId); assert.equal(stored.retentionDays, 60);
  assert.equal(stored.version, updated.version);
  await check("archive", "/retention-rules/" + created.id, ownerCookie, 204, "DELETE", undefined, { "If-Match": String(updated.version) });
  const archived = await check("archived-filter", "/retention-rules?status=archived&serviceId=" + fixture.owner.serviceId, ownerCookie, 200);
  assert.equal(archived.items[0].id, created.id);
  await check("archived-update-conflict", "/retention-rules/" + created.id, ownerCookie, 409, "PATCH", { version: updated.version + 1, reason: "불허 수정" });
  await check("old-create-key-cannot-restore", "/retention-rules", ownerCookie, 410, "POST", input, { "Idempotency-Key": key });
  const audits = await db.auditEvent.findMany({ where: { tenantId: fixture.owner.companyId, resourceId: created.id }, select: { action: true } });
  assert.ok(audits.some(row => row.action === "retention_rule.created"));
  assert.ok(audits.some(row => row.action === "retention_rule.updated"));
  assert.ok(audits.some(row => row.action === "retention_rule.archived"));
  await writeFile(local + "/fixture.json", JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  await writeFile(evidence + "/http-db.json", JSON.stringify({ result: "passed", checkedAt: new Date().toISOString(),
    fixture: { companyId: fixture.owner.companyId, serviceId: fixture.owner.serviceId, ruleId: created.id }, checks,
    independentDb: { retentionDays: stored.retentionDays, version: stored.version, auditActions: audits.map(row => row.action) },
    externalProviderAcceptance: false }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", checks: checks.length, independentDbVerified: true }));
} catch (cause) {
  await writeFile(evidence + "/http-db-failure.json", JSON.stringify({ result: "failed", checks, error: String(cause) }, null, 2) + "\n");
  throw cause;
} finally { await db.$disconnect(); }
