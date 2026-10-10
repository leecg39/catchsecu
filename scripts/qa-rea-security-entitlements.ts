import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { securityCapabilities } from "../src/contracts/feature-entitlements";
const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const privateDir = ".local/rea-fullstack/security-entitlements", file = privateDir + "/fixture.json", out = "docs/qa/R06-T04/security-entitlements";
type Person = { email: string; password: string; cookie: string; userId: string };
type Fixture = { tag: string; owner: Person; admin: Person; secret: string; otp?: string; ready: boolean; companies: Record<string, { id: string; serviceId: string; subscriptionId?: string }>; ruleId?: string; exceptionId?: string; expiresAt?: string };
const save = (f: Fixture) => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
async function request(actor: Person, path: string, method = "GET", body?: unknown, key?: string) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie: actor.cookie,
    ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function answer(response: Response, expected = 200) { const body = await response.json(); assert.equal(response.status, expected, body.error?.code); return body; }
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
async function select(f: Fixture, name: string, actor = f.owner) { await answer(await request(actor, "/context", "POST", { companyId: f.companies[name].id })); }
try {
  await mkdir(privateDir, { recursive: true, mode: 0o700 }); await mkdir(out, { recursive: true });
  const command = process.argv[2];
  if (command === "prepare") {
    try { await readFile(file); throw Error("Existing fixture must not be replaced"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const person = (): Person => ({ email: "", password: randomBytes(24).toString("hex") + "Aa!1", cookie: "", userId: "" });
    const f: Fixture = { tag: randomUUID(), owner: person(), admin: person(), ready: false, companies: {}, secret: "" }; await save(f);
    for (const label of ["owner", "admin"] as const) {
      const p = f[label]; p.email = `rea-entitlement-${label}-${f.tag}@catchsecu.test`; await save(f);
      await answer(await request(p, "/auth/sign-up/email", "POST", { email: p.email, password: p.password, name: "REA 기능 권한 " + label }));
      const user = await db.user.update({ where: { email: p.email }, data: { emailVerified: true } }); p.userId = user.id;
      const signed = await request(p, "/auth/sign-in/email", "POST", { email: p.email, password: p.password }); await answer(signed); p.cookie = cookieOf(signed); await save(f);
    }
    const enabled = await request(f.owner, "/auth/two-factor/enable", "POST", { password: f.owner.password }); const payload = await answer(enabled);
    f.owner.cookie = cookieOf(enabled) || f.owner.cookie; f.secret = new TextDecoder().decode(base32.decode(new URL(payload.totpURI).searchParams.get("secret")!)); await save(f);
    const verified = await request(f.owner, "/auth/two-factor/verify-totp", "POST", { code: await createOTP(f.secret, { digits: 6, period: 30 }).totp() }); await answer(verified); f.owner.cookie = cookieOf(verified) || f.owner.cookie; await save(f);
    for (const label of ["included", "not_included", "expired", "pending", "unsubscribed", "mfa_only"]) {
      // Explicit synthetic setup: real local DB constraints remain enabled; no original-service data changes.
      const company = await db.company.create({ data: { name: `REA 권한 ${label} ${f.tag.slice(0, 8)}`, publicName: "REA 합성 기능 회사",
        policy: { create: { passwordMonths: 0 } }, services: { create: { name: "기능 검증", externalName: "기능 검증" } },
        memberships: { create: [{ userId: f.owner.userId, role: "owner" }, { userId: f.admin.userId, role: "admin" }] } }, include: { services: true } });
      f.companies[label] = { id: company.id, serviceId: company.services[0].id }; await save(f);
      if (label === "unsubscribed") continue;
      const version = await db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000) + 100,
        cycle: "trial", priceKrw: 0, features: { fixture: f.tag }, capabilities: label === "not_included" ? [] : label === "mfa_only" ? ["security.mfa_management"] : [...securityCapabilities] } });
      const periodStart = new Date(Date.now() + (label === "expired" ? -8 : label === "pending" ? 1 : 0) * 86400000);
      const sub = await db.billingSubscription.create({ data: { tenantId: company.id, planId: "trial", planVersionId: version.id,
        status: "trialing", activationSource: "trial", priceKrw: 0, periodStart, periodEnd: new Date(periodStart.getTime() + 7 * 86400000) } });
      f.companies[label].subscriptionId = sub.id; await save(f);
    }
    f.ready = true; await save(f); await select(f, "included");
    const report = { fixtureSetupOnly: true, emailVerifiedByFixture: true, ownerMfaEnrolledViaRealHttp: true, syntheticTrialVersions: true, companies: f.companies };
    await writeFile(out + "/prepared.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } else {
    const f: Fixture = JSON.parse(await readFile(file, "utf8")); assert.equal(f.ready, true);
    if (command === "otp") { f.otp = await createOTP(f.secret, { digits: 6, period: 30 }).totp(); await save(f); console.log("Private OTP refreshed"); }
    else if (command === "http") {
      const checks = [];
      for (const label of Object.keys(f.companies)) {
        await select(f, label);
        for (const path of ["/security/policy", "/security/ip-rules", "/security/mfa-policy"]) {
          const body = await answer(await request(f.owner, path));
          const entitlement = path.endsWith("policy") && path === "/security/policy" ? body.entitlements["security.company_policy"] : body.policy.entitlement;
          const expected = label === "mfa_only" ? path === "/security/mfa-policy" ? "included" : "not_included" : label;
          assert.equal(entitlement.state, expected); checks.push({ company: label, path, status: 200, entitlement, canManage: path === "/security/policy" ? body.canManage : body.policy.canManage });
        }
        if (!["included"].includes(label)) {
          const denied = await request(f.owner, "/security/ip-rules", "POST", { tenantId: f.companies[label].id, cidr: "192.0.2.1", enabled: true, description: "차단 시험" }, randomUUID());
          const body = await answer(denied, 402); checks.push({ company: label, path: "/security/ip-rules", status: 402, code: body.error.code });
        }
      }
      await select(f, "included");
      await writeFile(out + "/http-matrix.json", JSON.stringify({ checks, count: checks.length }, null, 2) + "\n"); console.log({ checks: checks.length });
    } else if (command === "expire") {
      await select(f, "included"); const company = f.companies.included;
      const sub = await db.billingSubscription.findUniqueOrThrow({ where: { id: company.subscriptionId } }); assert.equal(sub.cancelAt, null);
      const expiresAt = new Date(Date.now() + 12000).toISOString();
      await answer(await request(f.owner, "/subscriptions/" + sub.id + "/schedule-cancel", "POST", { version: sub.version, effectiveAt: expiresAt }, randomUUID()));
      f.expiresAt = expiresAt; await save(f); console.log({ expiresAt });
    } else if (command === "expiry-http") {
      assert.ok(f.expiresAt && new Date(f.expiresAt) < new Date());
      const checks = [];
      for (const path of ["/security/policy", "/security/ip-rules", "/security/mfa-policy"]) {
        const body = await answer(await request(f.owner, path));
        const policy = path === "/security/policy" ? body : body.policy;
        assert.equal(policy.canManage, false); checks.push({ path, status: 200, canManage: policy.canManage });
      }
      const denied = await request(f.owner, "/security/ip-rules", "POST", { tenantId: f.companies.included.id, cidr: "192.0.2.2", description: "만료 후 차단", enabled: true }, randomUUID());
      const deniedBody = await answer(denied, 402); assert.equal(deniedBody.error.code, "SUBSCRIPTION_REQUIRED"); checks.push({ path: "/security/ip-rules", method: "POST", status: 402, code: deniedBody.error.code });
      const mfa = await answer(await request(f.admin, "/services"), 403); assert.equal(mfa.error.code, "MFA_REQUIRED"); checks.push({ path: "/services", actor: "unenrolled admin", status: 403, code: mfa.error.code });
      const ipv6 = await fetch("http://[::1]:3110/api/v1/security/policy", { headers: { cookie: f.owner.cookie } });
      const ip = await answer(ipv6, 403); assert.equal(ip.error.code, "IP_NOT_ALLOWED"); checks.push({ path: "/security/policy", actualSocket: "::1", status: 403, code: ip.error.code });
      await writeFile(out + "/expiry-http.json", JSON.stringify({ actualTimeExpiry: true, expiresAt: f.expiresAt, checkedAt: new Date().toISOString(), checks }, null, 2) + "\n"); console.log({ checks: checks.length });
    } else if (command === "verify") {
      const companies = Object.values(f.companies).map(c => c.id), label = process.argv[3] ?? "verified";
      const state = { policies: await db.securityPolicy.findMany({ where: { tenantId: { in: companies } }, orderBy: { tenantId: "asc" } }),
        rules: await db.ipRule.findMany({ where: { tenantId: { in: companies } }, orderBy: { id: "asc" } }),
        ips: await db.ipAccessPolicy.findMany({ where: { tenantId: { in: companies } }, orderBy: { tenantId: "asc" } }),
        exceptions: await db.mfaException.findMany({ where: { tenantId: { in: companies } }, select: { id: true, tenantId: true, version: true, expiresAt: true }, orderBy: { id: "asc" } }),
        subscriptions: await db.billingSubscription.findMany({ where: { tenantId: { in: companies } }, orderBy: { id: "asc" } }),
        audits: await db.auditEvent.findMany({ where: { tenantId: { in: companies } }, select: { id: true, action: true, resourceId: true }, orderBy: { id: "asc" } }) };
      const hash = createHash("sha256").update(JSON.stringify(state)).digest("hex");
      if (label !== "verified") assert.equal(hash, JSON.parse(await readFile(out + "/verified.json", "utf8")).stateHash);
      const body = await answer(await request(f.owner, "/security/ip-rules")); assert.equal(body.policy.entitlement.state, "expired"); assert.equal(body.policy.canManage, false); assert.equal(body.policy.enabled, true);
      assert.equal(state.rules.filter(r => r.tenantId === f.companies.included.id).length, 1);
      assert.equal(state.policies.find(p => p.tenantId === f.companies.included.id)?.requireMfa, true);
      const report = { verifiedAt: new Date().toISOString(), stateHash: hash, state, licenseExpiryDoesNotDisableProtection: true, sourceFidelity: "partial", externalProviderVerified: false };
      await writeFile(out + "/" + label + ".json", JSON.stringify(report, null, 2) + "\n"); console.log({ label, stateHash: hash });
    } else throw Error("Unknown command");
  }
} finally { await db.$disconnect(); }
