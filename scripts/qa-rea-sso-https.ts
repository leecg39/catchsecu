import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";

const directory = resolve(".local/rea-fullstack/sso/https"), output = "docs/qa/R07-T04/https-flow";
const environment = JSON.parse(await readFile(directory + "/environment.json", "utf8")) as {
  appOrigin: string; idpOrigin: string; email: string; password: string; clientId: string; clientSecret: string; samlClientId: string; subject: string;
};
const mode = process.argv[2], origin = environment.appOrigin, fixtureFile = directory + "/fixture.json";
assert.equal(origin, "https://localhost:3443"); assert.equal(process.env.NODE_EXTRA_CA_CERTS, directory + "/ca.pem");
assert.equal(process.env.BETTER_AUTH_URL, origin); assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
type Fixture = { companyId: string; userId: string; oidcId: string; samlId: string; cookies: [string, string][]; hash?: string };
const checks: { action: string; status: number; code?: string }[] = [];
let fixture: Fixture = { companyId: "", userId: "", oidcId: "", samlId: "", cookies: [] };
const jar = new Map<string, string>();
const save = async () => { fixture.cookies = [...jar]; await writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 }); };
function capture(response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0], at = pair.indexOf("=");
    if (/max-age=0(?:;|$)/i.test(cookie)) jar.delete(pair.slice(0, at)); else jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
}
async function request(action: string, path: string, expected: number, input?: unknown, method = input === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
    ...(input === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.clone().json().catch(() => null);
  checks.push({ action, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, action + " code=" + (value?.error?.code ?? "none")); capture(response); return { response, value };
}
function form(html: string) {
  const decode = (v: string) => v.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1]; assert(action);
  return { action: decode(action), body: new URLSearchParams([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(m => [m[1], decode(m[2])])) };
}
async function begin(protocol: "oidc" | "saml", flowMode: "login" | "link", scenario = "valid") {
  const start = await request(protocol + " " + flowMode + " " + scenario + " start", "/api/v1/auth/sso/" + (protocol === "oidc" ? fixture.oidcId : fixture.samlId) + "?mode=" + flowMode, 302);
  const binding = start.response.headers.getSetCookie().find(v => v.startsWith("__Host-catchsecu-sso-browser-"));
  assert(binding && /; Secure/.test(binding) && /; HttpOnly/.test(binding) && /; SameSite=None/.test(binding) && /; Path=\//.test(binding));
  const destination = new URL(start.response.headers.get("location")!); assert.equal(destination.origin, environment.idpOrigin);
  destination.searchParams.set("qa_case", scenario);
  const idp = await fetch(destination, { redirect: "manual" }); assert.equal(idp.status, 200);
  const consent = form(await idp.text());
  if (protocol === "saml") { assert.equal(consent.action, origin + "/api/v1/auth/sso/saml"); return { url: consent.action, body: consent.body, protocol }; }
  assert.equal(consent.action, environment.idpOrigin + "/approve");
  const approved = await fetch(consent.action, { method: "POST", body: consent.body, redirect: "manual" }); assert.equal(approved.status, 303);
  const callback = approved.headers.get("location")!; assert.equal(new URL(callback).origin, origin);
  return { url: callback, protocol };
}
async function complete(flow: Awaited<ReturnType<typeof begin>>, expected: number, action: string, omitBinding = false) {
  // SAML cross-site POST sends the browser binding, without relying on the Lax login cookie.
  const cookies = [...jar].filter(([name]) => omitBinding ? !name.startsWith("__Host-catchsecu-sso-browser-")
    : flow.protocol === "saml" ? name.startsWith("__Host-catchsecu-sso-browser-") : true);
  const response = await fetch(flow.url, { method: flow.body ? "POST" : "GET", redirect: "manual",
    headers: { cookie: cookies.map(([k, v]) => k + "=" + v).join("; "), ...(flow.body ? { origin: environment.idpOrigin } : {}) }, body: flow.body });
  const value = await response.clone().json().catch(() => null);
  checks.push({ action, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, action + " code=" + (value?.error?.code ?? "none")); capture(response);
  if (expected === 302) {
    assert(response.headers.getSetCookie().some(c => c.startsWith("__Secure-better-auth.session_token=") && c.includes("; Secure")));
    const me = (await request(action + " authenticated me", "/api/v1/me", 200)).value;
    assert.equal(me.email ?? me.user?.email, environment.email);
  }
  return value;
}
async function snapshot() {
  return db.$transaction(async tx => ({
    company: await tx.company.findUniqueOrThrow({ where: { id: fixture.companyId } }),
    providers: await tx.ssoProvider.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
    accounts: await tx.account.findMany({ where: { userId: fixture.userId }, orderBy: { id: "asc" } }),
    sessions: await tx.session.findMany({ where: { userId: fixture.userId }, orderBy: { id: "asc" }, select: { id: true, userId: true, activeCompanyId: true, activeServiceId: true, expiresAt: true } }),
    proofs: await tx.ssoSessionProof.findMany({ where: { userId: fixture.userId }, orderBy: { sessionId: "asc" } }),
    states: await tx.ssoState.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
try {
  if (mode === "http") {
    assert(!await access(fixtureFile).then(() => true, () => false), "Use a fresh fixture only"); await save();
    await request("fresh owner signup over HTTPS", "/api/v1/auth/sign-up/email", 200, { name: "HTTPS 인증 QA", email: environment.email, password: environment.password });
    fixture.userId = (await db.user.update({ where: { email: environment.email }, data: { emailVerified: true } })).id;
    fixture.companyId = (await db.company.create({ data: { name: "REA HTTPS 인증 검증", publicName: "HTTPS QA", policy: { create: { passwordMonths: 0, sessionMinutes: 240 } }, memberships: { create: { userId: fixture.userId, role: "owner" } } } })).id; await save();
    await request("HTTPS owner login", "/api/v1/auth/sign-in/email", 200, { email: environment.email, password: environment.password }); await save();
    const oidc = (await request("OIDC create and real HTTPS JWKS preflight", "/api/v1/security/sso", 201, { tenantId: fixture.companyId, name: "로컬 HTTPS OIDC", protocol: "oidc", issuer: environment.idpOrigin,
      clientId: environment.clientId, clientSecret: environment.clientSecret, authorizationUrl: environment.idpOrigin + "/authorize", tokenUrl: environment.idpOrigin + "/token", jwksUrl: environment.idpOrigin + "/jwks", scopes: "openid email" })).value;
    assert.equal(oidc.preflightOk, true); fixture.oidcId = oidc.id; await save();
    const saml = (await request("SAML create and certificate preflight", "/api/v1/security/sso", 201, { tenantId: fixture.companyId, name: "로컬 HTTPS SAML", protocol: "saml", issuer: environment.idpOrigin,
      clientId: environment.samlClientId, authorizationUrl: environment.idpOrigin + "/saml", idpCert: await readFile(directory + "/server.pem", "utf8") })).value;
    assert.equal(saml.preflightOk, true); fixture.samlId = saml.id; await save();
    for (const provider of [oidc, saml]) await request("enable " + provider.protocol, "/api/v1/security/sso/" + provider.id, 200, { version: provider.version, enabled: true }, "PATCH");
    for (const protocol of ["oidc", "saml"] as const) {
      const linked = await begin(protocol, "link"); await complete(linked, 302, protocol + " account link");
      await complete(linked, 401, protocol + " consumed callback rejected");
      await complete(await begin(protocol, "login"), 302, protocol + " linked account login");
      const missing = await begin(protocol, "login"); const missingResult = await complete(missing, 401, protocol + " missing browser binding rejected", true);
      assert.equal(missingResult.error.code, "SSO_BROWSER_MISMATCH");
      await complete(missing, 302, protocol + " original browser binding succeeds");
      for (const scenario of protocol === "oidc" ? ["nonce", "issuer", "audience", "expired", "signature"] : ["recipient", "issuer", "audience", "expired", "signature"]) {
        const before = await db.session.count({ where: { userId: fixture.userId } });
        await complete(await begin(protocol, "login", scenario), 401, protocol + " malformed " + scenario);
        assert.equal(await db.session.count({ where: { userId: fixture.userId } }), before);
      }
      await save();
    }
    const rows = await snapshot();
    assert.equal(rows.accounts.filter(a => a.providerId.startsWith("sso:")).length, 2);
    assert.equal(rows.proofs.length, 6); assert(rows.proofs.every(p => p.identityProvider === "OTHER"));
    const events = JSON.parse(await readFile(output + "/idp-events.json", "utf8")) as { events: { action: string; passed?: boolean }[] };
    assert(events.events.filter(e => e.action === "token").every(e => e.passed));
    await writeFile(output + "/http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks, actualHttpChecks: checks.length,
      linkedAccounts: 2, proofs: rows.proofs.length, sessions: rows.sessions.length, audits: rows.audits.length,
      setup: "Fresh owner email verification/company explicitly inserted. Real HTTPS app, IdP consent, token/JWKS and signed SAML POST requests.",
      nodeTrust: "NODE_EXTRA_CA_CERTS scoped to QA processes; CA and hostname verification enabled", browserVerified: false, externalIdpVerified: false }, null, 2) + "\n");
    console.log(JSON.stringify({ actualHttpChecks: checks.length, linkedAccounts: 2, proofs: rows.proofs.length, passed: true }));
  } else {
    fixture = JSON.parse(await readFile(fixtureFile, "utf8")) as Fixture; for (const [k, v] of fixture.cookies) jar.set(k, v);
    if (mode === "browser") {
      const browser = JSON.parse(await readFile(directory + "/browser-cookie.json", "utf8")) as { cookie: string };
      jar.clear(); const at = browser.cookie.indexOf("="); jar.set(browser.cookie.slice(0, at), browser.cookie.slice(at + 1));
      const current = (await request("Ego HTTPS session signature validated", "/api/v1/auth/get-session", 200)).value;
      assert.equal(current.user.id, fixture.userId); assert.equal(current.session.activeCompanyId, fixture.companyId);
      const proof = await db.ssoSessionProof.findUniqueOrThrow({ where: { sessionId: current.session.id } });
      assert.equal(proof.providerId, fixture.samlId); assert.equal(proof.identityProvider, "OTHER");
      const rows = await snapshot();
      await writeFile(output + "/browser-db.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks,
        currentBrowserSessionHasSamlProof: true, identityProvider: proof.identityProvider,
        linkedAccounts: rows.accounts.filter(a => a.providerId.startsWith("sso:")).length,
        sessions: rows.sessions.length, proofs: rows.proofs.length, audits: rows.audits.length,
        allProofsAreLocal: rows.proofs.every(p => p.identityProvider === "OTHER") }, null, 2) + "\n");
      console.log(JSON.stringify({ currentBrowserSessionHasSamlProof: true, sessions: rows.sessions.length, proofs: rows.proofs.length }));
    } else {
    assert(["freeze", "verify", "restart"].includes(mode)); assert(!fixture.hash || mode !== "freeze", "Never replace a frozen baseline");
    if (mode === "restart") await request("HTTPS restart authenticated me", "/api/v1/me", 200);
    const rows = await snapshot(), hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    if (mode === "freeze") { fixture.hash = hash; await save(); }
    let readAuditDelta = 0;
    if (hash !== fixture.hash) {
      // The browser restart opens the dashboard, whose reads append audit events.
      // Accept only the two independently recorded rows; never move the frozen baseline.
      const delta = JSON.parse(await readFile(directory + "/browser-audit-delta.json", "utf8")) as {
        baselineHash: string; fullHash: string; addedAudits: { id: string; hash: string }[];
      };
      assert.equal(delta.baselineHash, fixture.hash); assert.equal(hash, delta.fullHash);
      assert.equal(delta.addedAudits.length, 2); assert.equal(new Set(delta.addedAudits.map(a => a.id)).size, 2);
      for (const expected of delta.addedAudits) {
        const row = rows.audits.find(a => a.id === expected.id); assert(row);
        assert.equal(createHash("sha256").update(JSON.stringify(row)).digest("hex"), expected.hash);
      }
      const original = { ...rows, audits: rows.audits.filter(a => !delta.addedAudits.some(d => d.id === a.id)) };
      assert.equal(createHash("sha256").update(JSON.stringify(original)).digest("hex"), fixture.hash);
      readAuditDelta = 2;
    } else assert.equal(hash, fixture.hash);
    await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), hash, baselineHash: fixture.hash, readAuditDelta, matched: true, providers: rows.providers.length,
      accounts: rows.accounts.length, sessions: rows.sessions.length, proofs: rows.proofs.length, states: rows.states.length, audits: rows.audits.length, checks }, null, 2) + "\n");
    console.log(JSON.stringify({ mode, matched: true, hash }));
    }
  }
} catch (error) {
  await writeFile(output + "/failed-" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), checks, message: error instanceof Error ? error.message : "failed" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
