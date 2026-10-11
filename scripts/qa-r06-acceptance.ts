import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { policyDefaults, policySettings } from "../src/contracts/security";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3121"); assert.equal(database.pathname, "/catchsecu_dev");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = "docs/qa/R06-T04/current";
const securityFile = ".local/rea-fullstack/security/fixture.json", entitlementFile = ".local/rea-fullstack/security-entitlements/fixture.json";
type Person = { userId: string; email: string; password: string; cookie: string };
type SecurityFixture = { people: Record<string, Person>; tenantId: string; secret: string; idleSessionIds: string[] };
type EntitlementFixture = { owner: Person; admin: Person; secret: string; companies: Record<string, { id: string; subscriptionId?: string }> };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => value.startsWith("better-auth.session_token=")).join("; ");
const checks: { label: string; status: number; errorCode?: string }[] = [];
async function request(actor: Person, path: string, method = "GET", body?: unknown, base = origin) {
  return fetch(base + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie: actor.cookie, "content-type": "application/json", "idempotency-key": randomUUID(), ...(base === origin ? {} : { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function check(response: Response, expected: number, label: string, errorCode?: string) {
  const body = await response.json(); assert.equal(response.status, expected, label + ": " + body.error?.code);
  if (errorCode) assert.equal(body.error?.code, errorCode, label);
  checks.push({ label, status: response.status, errorCode: body.error?.code }); return body;
}
async function login(actor: Person, label: string, secret?: string) {
  const response = await request(actor, "/auth/sign-in/email", "POST", { email: actor.email, password: actor.password });
  const body = await check(response, 200, label + " fresh login");
  if (secret) {
    assert.equal(body.twoFactorRedirect, true);
    const challenge = { ...actor, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
    const verified = await request(challenge, "/auth/two-factor/verify-totp", "POST", { code: await createOTP(secret, { digits: 6, period: 30 }).totp() });
    await check(verified, 200, label + " real TOTP challenge"); actor.cookie = cookieOf(verified);
  } else actor.cookie = cookieOf(response);
  assert.ok(actor.cookie);
}
try {
  const tag = process.argv[2]; assert.ok(tag === "baseline" || tag === "after-restart");
  const security: SecurityFixture = JSON.parse(await readFile(securityFile, "utf8"));
  const entitlement: EntitlementFixture = JSON.parse(await readFile(entitlementFile, "utf8"));
  if (tag === "baseline") {
    await login(security.people.owner, "security owner", new TextDecoder().decode(base32.decode(security.secret)));
    for (const label of ["member", "viewer", "foreign"]) await login(security.people[label], label);
    await login(entitlement.owner, "entitlement owner", entitlement.secret);
    await login(entitlement.admin, "unenrolled admin");
    await writeFile(securityFile, JSON.stringify(security, null, 2) + "\n", { mode: 0o600 });
    await writeFile(entitlementFile, JSON.stringify(entitlement, null, 2) + "\n", { mode: 0o600 });
  }
  const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: security.tenantId } });
  assert.deepEqual(Object.fromEntries(Object.keys(policySettings.shape).map(key => [key, policy[key as keyof typeof policy]])), policyDefaults);
  assert.deepEqual([policy.version, policy.passwordRevision, policy.approvalRevision], [5, 3, 3]);
  const ip = await db.ipAccessPolicy.findUniqueOrThrow({ where: { tenantId: security.tenantId } }); assert.equal(ip.enabled, true); assert.equal(ip.version, 1);
  const rules = await db.ipRule.findMany({ where: { tenantId: security.tenantId }, orderBy: { id: "asc" } }); assert.equal(rules.length, 1);
  assert.deepEqual([rules[0].cidr, rules[0].description, rules[0].enabled, rules[0].version], ["127.0.0.1/32", "REA 검증된 관리자 허용", true, 3]);
  assert.equal(await db.session.count({ where: { id: { in: security.idleSessionIds } } }), 0);
  assert.equal(await db.twoFactor.count({ where: { userId: security.people.owner.userId } }), 1);
  for (const [actor, path, status] of [["owner", "/security/policy", 200], ["owner", "/security/ip-rules", 200], ["owner", "/security/mfa-policy", 200], ["owner", "/security/status", 200], ["member", "/security/policy", 200], ["admin", "/security/policy", 401], ["viewer", "/security/ip-rules", 403], ["foreign", "/security/ip-rules/" + rules[0].id, 404]] as const)
    await check(await request(security.people[actor], path), status, actor + " " + path);
  const included = entitlement.companies.included;
  await check(await request(entitlement.owner, "/context", "POST", { companyId: included.id }), 200, "select expired included company");
  for (const path of ["/security/policy", "/security/ip-rules", "/security/mfa-policy"]) {
    const body = await check(await request(entitlement.owner, path), 200, "expired read " + path);
    const access = path === "/security/policy" ? body.entitlements["security.company_policy"] : body.policy.entitlement;
    assert.equal(access.state, "expired"); assert.equal(path === "/security/policy" ? body.canManage : body.policy.canManage, false);
  }
  await check(await request(entitlement.owner, "/security/ip-rules", "POST", { tenantId: included.id, cidr: "192.0.2.242", description: "R06 만료 후 변경 거부 검증", enabled: false }), 402, "expired write denied", "SUBSCRIPTION_REQUIRED");
  // Context selection is allowed so the UI can show the company's MFA enrolment requirement.
  const selected = await request(entitlement.admin, "/context", "POST", { companyId: included.id });
  await check(selected, 200, "unenrolled admin context selection");
  await check(await request(entitlement.admin, "/services"), 403, "expired subscription keeps MFA enforcement", "MFA_REQUIRED");
  if (process.argv.includes("--ipv6")) {
    for (const [label, actor] of [["security", security.people.owner], ["expired entitlement", entitlement.owner]] as const)
      await check(await request(actor, "/security/policy", "GET", undefined, "http://[::1]:3122"), 403, label + " actual IPv6 socket with forged IPv4 headers", "IP_NOT_ALLOWED");
  }
  const companyIds = [security.tenantId, ...Object.values(entitlement.companies).map(value => value.id)];
  const policies = await db.securityPolicy.findMany({ where: { tenantId: { in: companyIds } }, orderBy: { tenantId: "asc" } });
  const ips = await db.ipAccessPolicy.findMany({ where: { tenantId: { in: companyIds } }, orderBy: { tenantId: "asc" } });
  const allRules = await db.ipRule.findMany({ where: { tenantId: { in: companyIds } }, orderBy: { id: "asc" } });
  assert.equal(allRules.length, 2); assert.equal(ips.find(row => row.tenantId === included.id)?.enabled, true); assert.equal(policies.find(row => row.tenantId === included.id)?.requireMfa, true);
  const exceptions = await db.mfaException.count({ where: { tenantId: { in: companyIds } } }); assert.equal(exceptions, 0);
  const subscriptions = await db.billingSubscription.findMany({ where: { tenantId: { in: companyIds } }, orderBy: { id: "asc" } });
  const idempotency = await db.idempotencyRecord.findMany({ where: { tenantId: security.tenantId, resourceType: { in: ["ip-rule", "mfa-exception"] } }, select: { resourceId: true, resourceType: true, invalidatedAt: true, responseCipher: true, requestHash: true }, orderBy: { resourceId: "asc" } });
  for (const row of idempotency) if (row.resourceId !== rules[0].id) { assert.equal(row.responseCipher, null); assert.equal(row.requestHash, null); assert.ok(row.invalidatedAt); }
  const actions = ["policy.updated", "policy.reset", "ip_rule.created", "ip_rule.updated", "ip_rule.deleted", "mfa_exception.created", "mfa_exception.updated", "mfa_exception.deleted", "ip_access.updated", "mfa_policy.updated"];
  const audits = await db.auditEvent.findMany({ where: { tenantId: { in: companyIds }, action: { in: actions } }, select: { id: true, tenantId: true, action: true, resourceId: true }, orderBy: { id: "asc" } });
  for (const action of actions.slice(0, 8)) assert.ok(audits.some(row => row.action === action), action);
  const state = { policies, ips, rules: allRules, exceptions, subscriptions, idempotency: idempotency.map(({ resourceId, resourceType, invalidatedAt }) => ({ resourceId, resourceType, invalidatedAt })), audits };
  const stateHash = hash(state); await mkdir(directory, { recursive: true });
  if (tag === "after-restart") assert.equal(stateHash, JSON.parse(await readFile(directory + "/baseline.json", "utf8")).stateHash);
  await writeFile(directory + "/" + tag + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", checks, stateHash, state, fingerprintScope: "7 synthetic companies' security settings, rules, subscriptions, invalidated CRUD cache references and explicitly listed configuration mutation audits; authentication/navigation/context events excluded", localProviderOnly: true }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", checks: checks.length, stateHash, companies: companyIds.length, rules: allRules.length, exceptions, audits: audits.length }));
} finally { await db.$disconnect(); }
