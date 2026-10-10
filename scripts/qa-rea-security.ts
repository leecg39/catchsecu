import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { roleCapabilities } from "../src/server/permissions";
import { policyDefaults, policySettings } from "../src/contracts/security";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const privateDirectory = ".local/rea-fullstack/security", privateFile = privateDirectory + "/fixture.json", directory = "docs/qa/R06-T04/security-flow";
type Person = { userId: string; memberId?: string; email: string; password: string; cookie: string };
type Fixture = { tag: string; preparedAt: string; ready: boolean; people: Record<string, Person>; tenantId: string; otherTenantId: string; serviceId: string; secret?: string; otp?: string; ipPageIds?: string[]; ipPageHistory?: string[][]; idleSessionIds?: string[] };
async function save(fixture: Fixture) { await writeFile(privateFile, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 }); }
async function request(path: string, method = "GET", body?: unknown, cookie = "", headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { Origin: origin, "User-Agent": "REA R06 independent HTTP", ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
try {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 }); await mkdir(directory, { recursive: true });
  const command = process.argv[2];
  if (command === "prepare") {
    try { await readFile(privateFile); throw new Error("Existing fixture must not be replaced"); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
    const fixture: Fixture = { tag: randomUUID(), preparedAt: new Date().toISOString(), ready: false, people: {}, tenantId: "", otherTenantId: "", serviceId: "" }; await save(fixture);
    for (const label of ["owner", "admin", "member", "viewer", "foreign"]) {
      const actor = { userId: "", email: "rea-security-" + label + "-" + fixture.tag + "@catchsecu.test", password: randomBytes(24).toString("hex") + "Aa!1", cookie: "" };
      fixture.people[label] = actor; await save(fixture);
      const registered = await request("/auth/sign-up/email", "POST", { email: actor.email, password: actor.password, name: "REA 보안 " + label }); assert.equal(registered.status, 200);
      const user = await db.user.findUniqueOrThrow({ where: { email: actor.email } }); assert.ok(user.createdAt.getTime() >= new Date(fixture.preparedAt).getTime()); actor.userId = user.id;
      // Explicit setup only: verification and memberships are separately tested in R02/R04.
      await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
      const logged = await request("/auth/sign-in/email", "POST", { email: actor.email, password: actor.password }); assert.equal(logged.status, 200);
      actor.cookie = logged.headers.getSetCookie().map(x => x.split(";")[0]).filter(x => x.startsWith("better-auth.session_token=")).join("; "); assert.ok(actor.cookie); await save(fixture);
    }
    for (const label of ["owner", "foreign"]) {
      const response = await request("/companies", "POST", { name: "REA 보안 " + label + " " + fixture.tag.slice(0, 8), publicName: "REA 합성 보안 회사" }, fixture.people[label].cookie); assert.equal(response.status, 201);
      const company = await response.json(); if (label === "owner") fixture.tenantId = company.id; else fixture.otherTenantId = company.id; await save(fixture);
    }
    fixture.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: fixture.tenantId } })).id;
    for (const [label, role] of [["admin", "admin"], ["member", "security"], ["viewer", "viewer"]] as const) {
      const actor = fixture.people[label], member = await db.membership.create({ data: { tenantId: fixture.tenantId, userId: actor.userId, role } }); actor.memberId = member.id;
      await db.serviceGrant.create({ data: { tenantId: fixture.tenantId, memberId: member.id, serviceId: fixture.serviceId, capabilities: [...roleCapabilities(role)] } }); await save(fixture);
    }
    fixture.ready = true; await save(fixture);
    const report = { fixtureSetupOnly: true, identitiesVerifiedDirectlyForFixture: true, membershipsSeeded: true, tenantId: fixture.tenantId, otherTenantId: fixture.otherTenantId, serviceId: fixture.serviceId, people: Object.fromEntries(Object.entries(fixture.people).map(([label, actor]) => [label, { userId: actor.userId, memberId: actor.memberId }])) };
    await writeFile(directory + "/prepared.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } else {
    const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8")); assert.equal(fixture.ready, true);
    if (command === "verify") {
      const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } });
      const settings = Object.fromEntries(Object.keys(policySettings.shape).map(key => [key, policy[key as keyof typeof policy]]));
      assert.deepEqual(settings, policyDefaults); assert.deepEqual([policy.version, policy.passwordRevision, policy.approvalRevision], [5, 3, 3]);
      const ipPolicy = await db.ipAccessPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } }); assert.equal(ipPolicy.enabled, true); assert.equal(ipPolicy.version, 1);
      const rules = await db.ipRule.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" } }); assert.equal(rules.length, 1);
      assert.deepEqual([rules[0].cidr, rules[0].description, rules[0].enabled, rules[0].version], ["127.0.0.1/32", "REA 검증된 관리자 허용", true, 3]);
      assert.equal(await db.mfaException.count({ where: { tenantId: fixture.tenantId } }), 0);
      assert.equal(await db.session.count({ where: { id: { in: fixture.idleSessionIds! } } }), 0);
      const users = await db.user.findMany({ where: { id: { in: Object.values(fixture.people).map(x => x.userId) } }, select: { id: true, status: true, twoFactorEnabled: true }, orderBy: { id: "asc" } });
      for (const user of users) { assert.equal(user.status, "active"); assert.equal(user.twoFactorEnabled, user.id === fixture.people.owner.userId); }
      assert.equal(await db.twoFactor.count({ where: { userId: fixture.people.owner.userId } }), 1);
      const idempotency = await db.idempotencyRecord.findMany({ where: { tenantId: fixture.tenantId, resourceType: { in: ["ip-rule", "mfa-exception"] } }, select: { resourceId: true, resourceType: true, invalidatedAt: true, responseCipher: true, requestHash: true }, orderBy: { resourceId: "asc" } });
      for (const row of idempotency) if (row.resourceId !== rules[0].id) { assert.equal(row.responseCipher, null); assert.equal(row.requestHash, null); assert.ok(row.invalidatedAt); }
      const audits = await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, action: true, resourceId: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      for (const action of ["policy.updated", "policy.reset", "ip_rule.created", "ip_rule.updated", "ip_rule.deleted", "mfa_exception.created", "mfa_exception.updated", "mfa_exception.deleted"])
        assert.ok(audits.some(row => row.action === action), action);
      const checks = [];
      for (const [label, path, actor, expected] of [["owner policy", "/security/policy", "owner", 200], ["owner IP", "/security/ip-rules", "owner", 200], ["owner MFA", "/security/mfa-policy", "owner", 200], ["security overview", "/security/status", "owner", 200], ["reset opens member", "/security/policy", "member", 200], ["idle old admin stays revoked", "/security/policy", "admin", 401], ["viewer cannot read", "/security/ip-rules", "viewer", 403], ["foreign rule hidden", "/security/ip-rules/" + rules[0].id, "foreign", 404]] as const) {
        const response = await request(path, "GET", undefined, fixture.people[actor].cookie), body = await response.json(); assert.equal(response.status, expected, label); checks.push({ label, status: response.status, errorCode: body.error?.code });
      }
      const state = { policy, ipPolicy, rules, exceptions: 0, users, expiredSessionIds: fixture.idleSessionIds, idempotency: idempotency.map(({ resourceId, resourceType, invalidatedAt }) => ({ resourceId, resourceType, invalidatedAt })), audits };
      const stateHash = createHash("sha256").update(JSON.stringify(state)).digest("hex"), label = process.argv[3] ?? "verified"; assert.match(label, /^[a-z0-9-]+$/);
      if (label !== "verified") assert.equal(stateHash, JSON.parse(await readFile(directory + "/verified.json", "utf8")).stateHash);
      const report = { checkedAt: new Date().toISOString(), checks, state, stateHash, sourceFidelity: "partial", entitlementMatrixVerified: false, externalProviderVerified: false };
      await writeFile(directory + "/" + label + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ checks: checks.length, rules: rules.length, audits: audits.length, stateHash }));
    } else if (command === "login-owner") {
      const actor = fixture.people.owner;
      const response = await request("/auth/sign-in/email", "POST", { email: actor.email, password: actor.password }); assert.equal(response.status, 200);
      const data = await response.json(); assert.equal(data.twoFactorRedirect, true); assert.ok(fixture.secret);
      const challenge = response.headers.getSetCookie().map(x => x.split(";")[0]).join("; ");
      const code = await createOTP(new TextDecoder().decode(base32.decode(fixture.secret)), { digits: 6, period: 30 }).totp();
      const verified = await request("/auth/two-factor/verify-totp", "POST", { code }, challenge); assert.equal(verified.status, 200);
      actor.cookie = verified.headers.getSetCookie().map(x => x.split(";")[0]).filter(x => x.startsWith("better-auth.session_token=")).join("; "); assert.ok(actor.cookie); await save(fixture); console.log(JSON.stringify({ authenticated: true, actualTotpChallenge: true }));
    } else if (command === "concurrent-ip") {
      const row = await db.ipRule.findFirstOrThrow({ where: { tenantId: fixture.tenantId, cidr: "127.0.0.1/32" } });
      assert.equal(row.version, 1);
      const response = await request("/security/ip-rules/" + row.id, "PATCH", { tenantId: fixture.tenantId, cidr: row.cidr, enabled: row.enabled, description: "REA HTTP 동시 수정", version: row.version }, fixture.people.owner.cookie); assert.equal(response.status, 200);
      const report = { status: response.status, row: await response.json() }; await writeFile(directory + "/ip-concurrent.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "prepare-ip-pages") {
      if (fixture.ipPageIds) {
        assert.equal(await db.ipRule.count({ where: { id: { in: fixture.ipPageIds } } }), 0);
        fixture.ipPageHistory = [...(fixture.ipPageHistory ?? []), fixture.ipPageIds];
      }
      fixture.ipPageIds = []; await save(fixture);
      for (let index = 1; index <= 20; index++) {
        const response = await request("/security/ip-rules", "POST", { tenantId: fixture.tenantId, cidr: "192.0.2." + index, description: "REA 페이지 시험 " + String(index).padStart(2, "0"), enabled: false }, fixture.people.owner.cookie, { "Idempotency-Key": randomUUID() }); assert.equal(response.status, 201);
        fixture.ipPageIds.push((await response.json()).id); await save(fixture);
      }
      const report = { listFixtureSetupThroughHttp: true, count: fixture.ipPageIds.length, ids: fixture.ipPageIds }; await writeFile(directory + "/ip-pages-setup" + (fixture.ipPageHistory?.length ? "-" + (fixture.ipPageHistory.length + 1) : "") + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "cleanup-ip-pages") {
      assert.equal(fixture.ipPageIds?.length, 20); let count = 0;
      for (const id of fixture.ipPageIds!) {
        const row = await db.ipRule.findUnique({ where: { id } }); if (!row) continue;
        assert.equal(row.tenantId, fixture.tenantId); assert.ok(row.description.startsWith("REA 페이지 시험"));
        const response = await request("/security/ip-rules/" + id, "DELETE", { tenantId: fixture.tenantId, version: row.version }, fixture.people.owner.cookie); assert.equal(response.status, 204); count++;
      }
      await writeFile(directory + "/ip-pages-cleanup" + (fixture.ipPageHistory?.length ? "-" + (fixture.ipPageHistory.length + 1) : "") + ".json", JSON.stringify({ removedByHttp: count }, null, 2) + "\n"); console.log(JSON.stringify({ removedByHttp: count }));
    } else if (command === "prepare-idle") {
      const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } }); assert.equal(policy.sessionMinutes, 90);
      const rows = await db.session.findMany({ where: { userId: fixture.people.admin.userId } }); assert.ok(rows.length);
      fixture.idleSessionIds = rows.map(row => row.id);
      // Explicit synthetic clock setup, never applied to other accounts or frozen checkpoints.
      await db.session.updateMany({ where: { id: { in: fixture.idleSessionIds }, userId: fixture.people.admin.userId }, data: { updatedAt: new Date(Date.now() - 31 * 60000) } }); await save(fixture);
      const report = { fixtureClockSetupOnly: true, sessionIds: fixture.idleSessionIds, idleMinutes: 31, beforePolicyMinutes: policy.sessionMinutes };
      await writeFile(directory + "/idle-setup.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "concurrent-policy") {
      const current = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } }); assert.equal(current.version, 2);
      const response = await request("/security/policy", "PATCH", { ...policySettings.parse(Object.fromEntries(Object.keys(policySettings.shape).map(key => [key, current[key as keyof typeof current]]))), sessionMinutes: 60, tenantId: fixture.tenantId, version: current.version, password: fixture.people.owner.password }, fixture.people.owner.cookie); assert.equal(response.status, 200);
      const report = { status: response.status, row: await response.json() }; await writeFile(directory + "/policy-concurrent.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "concurrent-mfa") {
      const row = await db.mfaException.findUniqueOrThrow({ where: { tenantId_memberId: { tenantId: fixture.tenantId, memberId: fixture.people.admin.memberId! } } }); assert.equal(row.version, 1);
      const cases = [];
      for (const [actor, status, code] of [["admin", 200, undefined], ["member", 403, "MFA_REQUIRED"]] as const) {
        const response = await request("/security/policy", "GET", undefined, fixture.people[actor].cookie), data = await response.json(); assert.equal(response.status, status); if (code) assert.equal(data.error.code, code); cases.push({ actor, status, code });
      }
      const response = await request("/security/mfa-policy/exceptions/" + row.id, "PATCH", { tenantId: fixture.tenantId, version: row.version, reason: "REA HTTP 예외 동시 수정", expiresAt: new Date(Date.now() + 7200000).toISOString(), password: fixture.people.owner.password }, fixture.people.owner.cookie); assert.equal(response.status, 200);
      const report = { existingSessionEnforcement: cases, concurrent: { status: response.status, row: await response.json() } }; await writeFile(directory + "/mfa-concurrent.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "mfa-expiry") {
      const cases: { label: string; status: number; code?: string }[] = [];
      async function check(label: string, response: Response, status: number) { const data = await response.json().catch(() => null); assert.equal(response.status, status, label); cases.push({ label, status, code: data?.error?.code ?? data?.code }); return data; }
      const owner = fixture.people.owner;
      assert.equal((await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } })).requireMfa, true);
      await check("unregistered existing member session denied", await request("/security/policy", "GET", undefined, fixture.people.member.cookie), 403);
      const input = { tenantId: fixture.tenantId, memberId: fixture.people.member.memberId!, reason: "REA 실제 시계 만료 검증", expiresAt: new Date(Date.now() + 8000).toISOString(), password: owner.password }, key = randomUUID();
      const row = await check("short real exception created", await request("/security/mfa-policy/exceptions", "POST", input, owner.cookie, { "Idempotency-Key": key }), 201);
      await check("same request returns same exception", await request("/security/mfa-policy/exceptions", "POST", input, owner.cookie, { "Idempotency-Key": key }), 201);
      const admin = await db.mfaException.findUniqueOrThrow({ where: { tenantId_memberId: { tenantId: fixture.tenantId, memberId: fixture.people.admin.memberId! } } });
      await check("foreign exception hidden", await request("/security/mfa-policy/exceptions/" + admin.id, "GET", undefined, fixture.people.foreign.cookie), 404);
      await check("live exception opens same session", await request("/security/policy", "GET", undefined, fixture.people.member.cookie), 200);
      const before = await db.auditEvent.count({ where: { tenantId: fixture.tenantId } });
      await new Promise(resolve => setTimeout(resolve, Math.max(0, new Date(row.expiresAt).getTime() - Date.now()) + 200));
      await check("natural deadline denies same session without cleanup", await request("/security/policy", "GET", undefined, fixture.people.member.cookie), 403);
      assert.equal(await db.auditEvent.count({ where: { tenantId: fixture.tenantId } }), before);
      await check("expired creation replay is gone", await request("/security/mfa-policy/exceptions", "POST", input, owner.cookie, { "Idempotency-Key": key }), 410);
      await check("required owner cannot disable MFA", await request("/auth/two-factor/disable", "POST", { password: owner.password }, owner.cookie), 403);
      const report = { checkedAt: new Date().toISOString(), expiryUsedRealClock: true, noExpiryDatabaseMutation: true, row, cases }; await writeFile(directory + "/mfa-expiry.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "ip-boundaries") {
      const cases: { label: string; status: number; code?: string }[] = [];
      async function check(label: string, response: Response, expected: number, code?: string) {
        const data = await response.json().catch(() => null); assert.equal(response.status, expected, label); if (code) assert.equal(data?.error?.code, code, label); cases.push({ label, status: response.status, code: data?.error?.code }); return data;
      }
      const owner = fixture.people.owner.cookie, rule = await db.ipRule.findFirstOrThrow({ where: { tenantId: fixture.tenantId, cidr: "127.0.0.1/32" } });
      assert.equal((await db.ipAccessPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } })).enabled, true);
      await check("IPv4 owner existing session allowed", await request("/security/ip-rules", "GET", undefined, owner), 200);
      for (const path of ["/security/policy", "/security/ip-rules", "/members", "/forms", "/files?submissionId=" + randomUUID(), "/exports"]) {
        const response = await fetch("http://[::1]:3110/api/v1" + path, { headers: { cookie: owner, Origin: origin, Host: "localhost:3100", "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1", "x-catchsecu-client-ip": "127.0.0.1", "x-catchsecu-ip-proof": "forged" } });
        await check("Real IPv6 socket with forged IPv4 headers denied " + path, response, 403, "IP_NOT_ALLOWED");
      }
      await check("unauthenticated list", await request("/security/ip-rules"), 401);
      await check("viewer list denied", await request("/security/ip-rules", "GET", undefined, fixture.people.viewer.cookie), 403);
      const input = { tenantId: fixture.tenantId, cidr: "2001:db8:0:1::abcd/64", description: "REA HTTP IPv6 CRUD", enabled: false }, key = randomUUID();
      await check("admin cannot create", await request("/security/ip-rules", "POST", input, fixture.people.admin.cookie, { "Idempotency-Key": randomUUID() }), 403);
      await check("foreign rule hidden", await request("/security/ip-rules/" + rule.id, "GET", undefined, fixture.people.foreign.cookie), 404);
      await check("invalid CIDR rejected", await request("/security/ip-rules", "POST", { ...input, cidr: "192.0.2.7/99" }, owner, { "Idempotency-Key": randomUUID() }), 422, "INVALID_CIDR");
      const created = await check("IPv6 normalized create", await request("/security/ip-rules", "POST", input, owner, { "Idempotency-Key": key }), 201); assert.equal(created.cidr, "2001:db8:0:1::/64");
      const updated = await check("IPv6 update", await request("/security/ip-rules/" + created.id, "PATCH", { ...input, version: 1, description: "REA HTTP IPv6 수정" }, owner), 200); assert.equal(updated.version, 2);
      await check("stale update rejected", await request("/security/ip-rules/" + created.id, "PATCH", { ...input, version: 1 }, owner), 409, "VERSION_CONFLICT");
      const replay = await check("idempotent replay returns current version", await request("/security/ip-rules", "POST", input, owner, { "Idempotency-Key": key }), 201); assert.equal(replay.id, created.id); assert.equal(replay.version, 2);
      await check("delete IPv6 rule", await request("/security/ip-rules/" + created.id, "DELETE", { tenantId: fixture.tenantId, version: 2 }, owner), 204);
      await check("deleted rule hidden", await request("/security/ip-rules/" + created.id, "GET", undefined, owner), 404);
      await check("deleted create replay gone", await request("/security/ip-rules", "POST", input, owner, { "Idempotency-Key": key }), 410);
      await check("last allowed rule cannot be deleted", await request("/security/ip-rules/" + rule.id, "DELETE", { tenantId: fixture.tenantId, version: rule.version }, owner), 409, "IP_LOCKOUT");
      const report = { checkedAt: new Date().toISOString(), realTransport: "Two local custom-server listeners, IPv4 127.0.0.1:3100 and IPv6 [::1]:3110, each signs its actual socket peer; same existing owner session; no trusted proxies", cases };
      await writeFile(directory + "/ip-boundaries.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (command === "otp") {
      assert.ok(fixture.secret); const secret = new TextDecoder().decode(base32.decode(fixture.secret)); fixture.otp = await createOTP(secret, { digits: 6, period: 30 }).totp(); await save(fixture); console.log(JSON.stringify({ generated: true }));
    } else if (command === "state") {
      const report = { policy: await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } }), ipPolicy: await db.ipAccessPolicy.findUnique({ where: { tenantId: fixture.tenantId } }), ipRules: await db.ipRule.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" } }),
        exceptions: await db.mfaException.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, memberId: true, expiresAt: true, version: true, createdAt: true }, orderBy: { id: "asc" } }),
        users: await db.user.findMany({ where: { id: { in: Object.values(fixture.people).map(x => x.userId) } }, select: { id: true, status: true, twoFactorEnabled: true }, orderBy: { id: "asc" } }),
        audits: await db.auditEvent.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, action: true, resourceId: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) };
      const label = process.argv[3] ?? "state"; assert.match(label, /^[a-z0-9-]+$/); await writeFile(directory + "/" + label + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else throw new Error("Unknown command");
  }
} finally { await db.$disconnect(); }
