import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const file = ".local/rea-fullstack/sso/session-proof-http.json", out = "docs/qa/R07-T04/session-evidence";
type Fixture = { tag: string; email: string; password: string; pin: string; cookie: string; userId: string; companyId: string; providerId: string; secret: string; backup: string[]; hash?: string };
let f: Fixture;
const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
const checks: { name: string; status: number }[] = [];
async function call(path: string, input?: unknown, method = "POST", cookie = f.cookie, key?: string) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie, "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function check(name: string, response: Response, expected = 200) {
  const data = await response.json(); assert.equal(response.status, expected, data.error?.code); checks.push({ name, status: response.status }); return data;
}
const cookies = (r: Response) => r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
async function currentSession() {
  const value = f.cookie.split("; ").find(v => v.startsWith("better-auth.session_token="))?.slice("better-auth.session_token=".length);
  assert.ok(value); return db.session.findUniqueOrThrow({ where: { token: decodeURIComponent(value).split(".")[0] } });
}
async function snapshot() {
  const providers = await db.ssoProvider.findMany({ where: { tenantId: f.companyId }, select: { id: true, protocol: true, enabled: true, version: true }, orderBy: { id: "asc" } });
  const proofs = await db.ssoSessionProof.findMany({ where: { tenantId: f.companyId }, orderBy: { sessionId: "asc" } });
  const accounts = await db.account.findMany({ where: { userId: f.userId }, select: { id: true, providerId: true, ssoProviderId: true }, orderBy: { id: "asc" } });
  const audits = await db.auditEvent.findMany({ where: { tenantId: f.companyId }, select: { id: true, action: true, resourceId: true }, orderBy: { id: "asc" } });
  const state = { providers, proofs, accounts, audits }; return { ...state, hash: createHash("sha256").update(JSON.stringify(state)).digest("hex") };
}
try {
  await mkdir(out, { recursive: true });
  const mode = process.argv[2];
  if (mode === "http") {
    assert.equal((await fetch(origin + "/login", { redirect: "manual" })).status, 200, "Server must be ready before preparing the consuming fixture");
    try { await readFile(file); throw Error("Existing consumed HTTP fixture must not be replayed"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    f = { tag: randomUUID(), email: "", password: randomBytes(24).toString("hex") + "Aa!1", pin: randomBytes(12).toString("hex"), cookie: "", userId: "", companyId: "", providerId: "", secret: "", backup: [] };
    f.email = `rea-sso-proof-${f.tag}@catchsecu.test`; await save();
    await check("actual sign-up", await call("/auth/sign-up/email", { email: f.email, password: f.password, name: "REA 세션 근거" }));
    f.userId = (await db.user.update({ where: { email: f.email }, data: { emailVerified: true } })).id;
    f.companyId = (await db.company.create({ data: { name: "REA 인증 근거 " + f.tag.slice(0, 8), publicName: "인증 근거", policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId: f.userId, role: "owner" } } } })).id; await save();
    const signed = await call("/auth/sign-in/email", { email: f.email, password: f.password }); await check("password login", signed); f.cookie = cookies(signed); await save();
    assert.equal(await db.ssoSessionProof.count({ where: { userId: f.userId } }), 0);
    const provider = await check("virtual provider create", await call("/security/sso", { tenantId: f.companyId, protocol: "gpki", name: "인증 근거 가상 기관" }, "POST", f.cookie, randomUUID()), 201);
    f.providerId = provider.id; await save();
    await check("provider enable", await call(`/security/sso/${provider.id}`, { version: provider.version, enabled: true }, "PATCH"));
    const credentials = { protocol: "gpki", orgCode: "PROOF-" + f.tag.slice(0, 8), employeeNo: "OWNER-01", pin: f.pin };
    await check("directory create", await call(`/security/sso/${provider.id}/directory`, { orgCode: credentials.orgCode, employeeNo: credentials.employeeNo, name: "합성 구성원", email: f.email, pin: f.pin }, "POST", f.cookie, randomUUID()), 201);
    const started = await call(`/auth/sso/${provider.id}?mode=link`, undefined, "GET"); assert.equal(started.status, 302); checks.push({ name: "link state issued", status: started.status });
    const target = new URL(started.headers.get("location")!, origin), state = target.searchParams.get("state"); assert.ok(state);
    const linked = await call("/auth/org/login", { ...credentials, state }); await check("actual virtual authentication and account link", linked); f.cookie = cookies(linked); await save();
    const initial = await currentSession(), proof = await db.ssoSessionProof.findUniqueOrThrow({ where: { sessionId: initial.id } });
    assert.equal(proof.identityProvider, "OTHER"); assert.equal(proof.providerId, provider.id);
    const setup = await call("/auth/two-factor/enable", { password: f.password }); const setupData = await check("MFA setup", setup);
    f.cookie = cookies(setup) || f.cookie; f.secret = new TextDecoder().decode(base32.decode(new URL(setupData.totpURI).searchParams.get("secret")!)); f.backup = setupData.backupCodes; await save();
    const verified = await call("/auth/two-factor/verify-totp", { code: await createOTP(f.secret, { digits: 6, period: 30 }).totp() }); await check("MFA confirmation rotates session", verified); f.cookie = cookies(verified) || f.cookie; await save();
    const rotated = await currentSession(), rotatedProof = await db.ssoSessionProof.findUniqueOrThrow({ where: { sessionId: rotated.id } });
    assert.notEqual(rotated.id, initial.id); assert.equal(rotatedProof.authenticatedAt.toISOString(), proof.authenticatedAt.toISOString());
    assert.equal(await db.ssoSessionProof.count({ where: { sessionId: initial.id } }), 0);
    await check("logout removes proof", await call("/auth/sign-out", {})); assert.equal(await db.ssoSessionProof.count({ where: { userId: f.userId } }), 0); f.cookie = ""; await save();
    const passwordLogin = await call("/auth/sign-in/email", { email: f.email, password: f.password }); const pending = await check("password login requires factor", passwordLogin); assert.equal(pending.twoFactorRedirect, true); f.cookie = cookies(passwordLogin);
    const passwordMfa = await call("/auth/two-factor/verify-backup-code", { code: f.backup.shift() }); await check("password MFA cannot inherit SSO proof", passwordMfa); f.cookie = cookies(passwordMfa); await save();
    assert.equal(await db.ssoSessionProof.count({ where: { sessionId: (await currentSession()).id } }), 0);
    const sso = await call("/auth/org/login", credentials, "POST", ""); await check("SSO login produces factor challenge", sso); f.cookie = cookies(sso);
    const ssoMfa = await call("/auth/two-factor/verify-backup-code", { code: f.backup.shift() }); await check("SSO MFA persists bound provider proof", ssoMfa); f.cookie = cookies(ssoMfa); await save();
    const final = await currentSession(); assert.equal(final.activeCompanyId, f.companyId);
    assert.equal((await db.ssoSessionProof.findUniqueOrThrow({ where: { sessionId: final.id } })).identityProvider, "OTHER");
    await check("authenticated profile", await call("/me", undefined, "GET"));
    const result = await snapshot(); f.hash = result.hash; await save();
    await writeFile(out + "/http.json", JSON.stringify({ actualHttp: true, syntheticFixture: true, emailVerifiedByFixture: true, count: checks.length, checks,
      proofCount: result.proofs.length, originalAuthenticationTimePreserved: true, passwordAndPasswordMfaProofCount: 0, stateHash: result.hash,
      externalInstitutionVerified: false, externalGoogleMicrosoftVerified: false }, null, 2) + "\n");
    console.log({ checks: checks.length, proofCount: result.proofs.length, hash: result.hash });
  } else if (mode === "verify") {
    f = JSON.parse(await readFile(file, "utf8")); const result = await snapshot(); assert.equal(result.hash, f.hash);
    assert.equal(result.proofs.length, 1); assert.equal(result.proofs[0].identityProvider, "OTHER");
    const response = await call("/me", undefined, "GET"); assert.equal(response.status, 200);
    await writeFile(out + "/verified-after-restart.json", JSON.stringify({ actualHttp: true, stateHash: result.hash, matched: true, profileStatus: response.status,
      proofCount: result.proofs.length, providers: result.providers.length, accounts: result.accounts.length, audits: result.audits.length }, null, 2) + "\n");
    console.log({ matched: true, proofCount: result.proofs.length });
  } else throw Error("Use http or verify");
} finally { await db.$disconnect(); }
