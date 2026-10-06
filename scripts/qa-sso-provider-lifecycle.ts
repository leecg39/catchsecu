import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";
import { ssoProviderRecord, ssoProviderCheckedRecord } from "../src/contracts/sso";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3166";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
let targetProviderId = fixture.providerId;
const evidence = "docs/qa/P11-T03/provider-lifecycle/";
const results: { action: string; status: number }[] = [];
let cookie = "";
const hash = (input: string) => createHash("sha256").update(input).digest("hex");
const cookieOf = (response: Response) => response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
async function request(path: string, method = "GET", input?: unknown, expected = 200) {
  const r = await fetch(base + "/api/v1" + path, { method, redirect: "manual", headers: { origin: base, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json" }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  results.push({ action: method + " " + path, status: r.status });
  writeFileSync(evidence + "http-progress.json", JSON.stringify({ results }, null, 2));
  assert.equal(r.status, expected, path);
  return r;
}
async function login() {
  cookie = cookieOf(await request("/auth/sign-in/email", "POST", { email: fixture.email, password: fixture.password }));
  assert.ok(cookie);
}
async function begin(mode: "login" | "link") {
  const response = await request("/auth/sso/" + targetProviderId + "?mode=" + mode, "GET", undefined, 302);
  const url = new URL(response.headers.get("location")!);
  const xml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
  const requestId = /ID="([^"]+)"/.exec(xml)![1], relay = url.searchParams.get("RelayState")!;
  const state = await db.ssoState.findUniqueOrThrow({ where: { stateHash: hash(relay) } });
  const provider = await db.ssoProvider.findUniqueOrThrow({ where: { id: targetProviderId } });
  assert.equal(state.providerVersion, provider.version);
  if (mode === "link") {
    assert.equal(state.userId, fixture.userId);
    assert.ok(state.sessionId);
    assert.equal((await db.session.findUniqueOrThrow({ where: { id: state.sessionId! } })).userId, fixture.userId);
  }
  return { requestId, relay };
}
let key = readFileSync(".local/qa-sso-provider-key.pem", "utf8");
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function assertion(requestId: string, subject: string, mutate: (xml: string) => string = xml => xml) {
  const now = new Date().toISOString(), later = new Date(Date.now() + 60000).toISOString();
  const acs = base + "/api/v1/auth/sso/saml", id = "_" + randomUUID();
  const xml = '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="' + id
    + '" Version="2.0" IssueInstant="' + now + '" Destination="' + acs + '" InResponseTo="' + requestId + '">'
    + '<saml:Issuer>https://qa-idp.example.test</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>'
    + '<saml:Assertion ID="_' + randomUUID() + '" Version="2.0" IssueInstant="' + now + '"><saml:Issuer>https://qa-idp.example.test</saml:Issuer>'
    + '<saml:Subject><saml:NameID>' + escape(subject) + '</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">'
    + '<saml:SubjectConfirmationData InResponseTo="' + requestId + '" NotOnOrAfter="' + later + '" Recipient="' + acs + '"/></saml:SubjectConfirmation></saml:Subject>'
    + '<saml:Conditions NotBefore="' + new Date(Date.now() - 60000).toISOString() + '" NotOnOrAfter="' + later
    + '"><saml:AudienceRestriction><saml:Audience>qa-sp</saml:Audience></saml:AudienceRestriction></saml:Conditions>'
    + '<saml:AuthnStatement AuthnInstant="' + now + '"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>'
    + '<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>' + escape(fixture.email)
    + '</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>';
  const signer = new SignedXml({ privateKey: key, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
  signer.addReference({ xpath: "//*[local-name(.)='Response']", uri: "#" + id, digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] });
  signer.computeSignature(mutate(xml), { location: { reference: "//*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: "after" } });
  return Buffer.from(signer.getSignedXml()).toString("base64");
}
try {
  const marker = ".local/qa-sso-provider-lifecycle.json";
  const original = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const originalAccount = await db.account.findFirstOrThrow({ where: { ssoProviderId: fixture.providerId, userId: fixture.userId } });
  const providerHash = hash(JSON.stringify(original)), accountHash = hash(JSON.stringify(originalAccount));
  const restarting = process.argv.includes("--verify-restart");
  assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
  if (restarting) {
    const prior = JSON.parse(readFileSync(evidence + "http.json", "utf8"));
    assert.equal(providerHash, prior.providerHash); assert.equal(accountHash, prior.accountHash);
    assert.equal(await db.ssoProvider.count({ where: { id: prior.removedProviderId } }), 0);
    assert.equal(await db.account.count({ where: { ssoProviderId: prior.removedProviderId } }), 0);
    await login(); await request("/security/sso"); await request("/auth/sign-out", "POST", {}); cookie = "";
    writeFileSync(evidence + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results, originalProviderAndAccountPreserved: true, ownSessionsRemaining: 0 }, null, 2));
  } else {
    if (existsSync(marker) || existsSync(evidence + "http.json")) throw new Error("Review existing run before repeating");
    await login();
    const created = ssoProviderCheckedRecord.parse(await (await request("/security/sso", "POST", { protocol: "saml", name: "QA lifecycle " + randomUUID(),
      issuer: original.issuer, clientId: original.clientId, authorizationUrl: original.authorizationUrl,
      idpCert: readFileSync(".local/qa-sso-provider-cert.pem", "utf8") }, 201)).json());
    targetProviderId = created.id;
    writeFileSync(marker, JSON.stringify({ phase: "created", targetProviderId }), { mode: 0o600 });
    let provider = ssoProviderRecord.parse(await (await request("/security/sso/" + targetProviderId, "PATCH", { version: created.version, enabled: true })).json());
    // A dedicated SSO-only member demonstrates the last-login guard without changing existing users.
    const restricted = await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: "qa-lifecycle-" + randomUUID() + "@catchsecu.test", name: "QA SSO 전용", emailVerified: true } });
      const member = await tx.membership.create({ data: { tenantId: fixture.tenantId, userId: user.id, role: "viewer" } });
      await tx.account.create({ data: { userId: user.id, providerId: "sso:" + targetProviderId, accountId: "only-provider" } });
      return { userId: user.id, memberId: member.id, memberVersion: member.version };
    });
    writeFileSync(marker, JSON.stringify({ phase: "guarded", targetProviderId, ...restricted }), { mode: 0o600 });
    for (const patch of [{ enabled: false }, { clientSecret: "qa-rotation-input" }, { idpCert: readFileSync(".local/qa-sso-lifecycle-cert.pem", "utf8") }]) {
      const denied = await request("/security/sso/" + targetProviderId, "PATCH", { version: provider.version, ...patch }, 409);
      assert.equal((await denied.json()).error.code, "SSO_PROVIDER_LAST_LOGIN");
    }
    assert.equal((await db.ssoProvider.findUniqueOrThrow({ where: { id: targetProviderId } })).version, provider.version);
    const removeMember = await fetch(base + "/api/v1/members/" + restricted.memberId, { method: "DELETE", headers: { origin: base, cookie, "if-match": String(restricted.memberVersion) } });
    assert.equal(removeMember.status, 204); results.push({ action: "DELETE /members/QA-only", status: 204 });
    const pending = await begin("link");
    provider = ssoProviderRecord.parse(await (await request("/security/sso/" + targetProviderId, "PATCH", { version: provider.version, enabled: false })).json());
    assert.equal(provider.enabled, false);
    await request("/auth/sso/" + targetProviderId + "?mode=login", "GET", undefined, 404);
    const oldCallback = await fetch(base + "/api/v1/auth/sso/saml", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: assertion(pending.requestId, "old-pending"), RelayState: pending.relay }) });
    assert.equal(oldCallback.status, 409); results.push({ action: "POST /auth/sso/saml prior state", status: 409 });
    await request("/me");
    provider = ssoProviderRecord.parse(await (await request("/security/sso/" + targetProviderId, "PATCH", { version: provider.version,
      idpCert: readFileSync(".local/qa-sso-lifecycle-cert.pem", "utf8") })).json());
    assert.equal(provider.enabled, false); assert.equal(provider.preflightOk, false);
    await request("/security/sso/" + targetProviderId, "PATCH", { version: provider.version, enabled: true }, 409);
    const checked = ssoProviderCheckedRecord.parse(await (await request("/security/sso/" + targetProviderId + "/preflight", "POST")).json());
    assert.equal(checked.preflightOk, true); assert.equal(checked.enabled, false);
    provider = ssoProviderRecord.parse(await (await request("/security/sso/" + targetProviderId, "PATCH", { version: checked.version, enabled: true })).json());
    key = readFileSync(".local/qa-sso-lifecycle-key.pem", "utf8");
    const linked = await begin("link");
    const signed = await fetch(base + "/api/v1/auth/sso/saml", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: assertion(linked.requestId, "rotated-key-owner"), RelayState: linked.relay }) });
    assert.equal(signed.status, 302); cookie = cookieOf(signed); results.push({ action: "POST /auth/sso/saml rotated key", status: 302 });
    await request("/me");
    const removed = await request("/security/sso/" + targetProviderId, "DELETE", { version: provider.version });
    assert.deepEqual(await removed.json(), { deleted: true, removedAccounts: 2, endedSessions: 2, signedOut: true });
    cookie = "";
    assert.equal(await db.session.count({ where: { userId: { in: [fixture.userId, restricted.userId] } } }), 0);
    assert.equal(await db.ssoProvider.count({ where: { id: targetProviderId } }), 0);
    assert.equal(hash(JSON.stringify(await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } }))), providerHash);
    assert.equal(hash(JSON.stringify(await db.account.findUniqueOrThrow({ where: { id: originalAccount.id } }))), accountHash);
    writeFileSync(evidence + "http.json", JSON.stringify({ at: new Date().toISOString(), results, providerHash, accountHash, removedProviderId: targetProviderId,
      manualStopGuardVerified: true, existingSessionPreserved: true, newKeySignatureVerified: true, fixturePreparedInDb: true,
      ownSessionsRemaining: 0, browserInteractionVerified: false }, null, 2));
    writeFileSync(marker, JSON.stringify({ phase: "complete", targetProviderId, ...restricted }), { mode: 0o600 });
  }
  console.log(JSON.stringify({ checks: results.length, restart: restarting, ownSessionsRemaining: 0 }));
} finally { await db.$disconnect(); }
