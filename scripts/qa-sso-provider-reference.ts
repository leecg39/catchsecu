import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";
import { ssoProviderRecord, ssoProviderCheckedRecord, ownSsoAccounts } from "../src/contracts/sso";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3164";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
let targetProviderId = fixture.providerId;
const evidence = "docs/qa/P11-T03/provider-reference/";
const results: { action: string; status: number }[] = [];
let cookie = "";
const hash = (input: string) => createHash("sha256").update(input).digest("hex");
const cookieOf = (response: Response) => response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
async function request(path: string, method = "GET", input?: unknown, expected = 200) {
  const r = await fetch(base + "/api/v1" + path, { method, redirect: "manual", headers: { origin: base, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json" }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert.equal(r.status, expected, path);
  results.push({ action: method + " " + path, status: r.status });
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
const key = readFileSync(".local/qa-sso-provider-key.pem", "utf8");
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
  const original = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const originalAccount = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + fixture.providerId, userId: fixture.userId } });
  const providerHash = hash(JSON.stringify(original)), accountHash = hash(JSON.stringify(originalAccount));
  const restarting = process.argv.includes("--verify-restart");
  assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
  if (restarting) {
    const previous = JSON.parse(readFileSync(evidence + "http.json", "utf8"));
    assert.equal(providerHash, previous.providerHash); assert.equal(accountHash, previous.accountHash);
    assert.equal(await db.ssoProvider.count({ where: { id: previous.removedProviderId } }), 0);
    assert.equal(await db.account.count({ where: { providerId: "sso:" + previous.removedProviderId } }), 0);
    await login(); ownSsoAccounts.parse(await (await request("/me/sso-accounts")).json()); await request("/auth/sign-out", "POST", {}); cookie = "";
    writeFileSync(evidence + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results, preservedHashes: true, ownSessionsRemaining: 0 }, null, 2));
  } else {
    if (existsSync(evidence + "http.json") || existsSync(".local/qa-sso-provider-reference.json")) throw new Error("Review existing run before repeating");
    await login();
    const created = await (await request("/security/sso", "POST", { protocol: "saml", name: "QA reference " + randomUUID(),
      issuer: original.issuer, clientId: original.clientId, authorizationUrl: original.authorizationUrl,
      idpCert: readFileSync(".local/qa-sso-provider-cert.pem", "utf8") }, 201)).json();
    ssoProviderCheckedRecord.parse(created);
    assert.equal(created.preflightOk, true); targetProviderId = created.id;
    writeFileSync(".local/qa-sso-provider-reference.json", JSON.stringify({ targetProviderId, phase: "created" }));
    ssoProviderRecord.parse(await (await request("/security/sso/" + targetProviderId, "PATCH", { version: created.version, enabled: true })).json());
    const providers = await (await request("/security/sso")).json();
    for (const item of providers.items) ssoProviderRecord.parse(item);
    const flow = await begin("link"), subject = "qa-provider-reference-" + randomUUID();
    const response = await fetch(base + "/api/v1/auth/sso/saml", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: assertion(flow.requestId, subject), RelayState: flow.relay }) });
    assert.equal(response.status, 302); cookie = cookieOf(response);
    results.push({ action: "POST /auth/sso/saml link", status: response.status });
    const account = await db.account.findUniqueOrThrow({ where: { providerId_accountId: { providerId: "sso:" + targetProviderId, accountId: original.issuer + "|" + subject } } });
    assert.equal(account.userId, fixture.userId);
    assert.equal(account.ssoProviderId, targetProviderId);
    const own = ownSsoAccounts.parse(await (await request("/me/sso-accounts")).json());
    assert.ok(own.items.some(item => item.id === account.id && item.providerId === targetProviderId));
    await begin("login");
    await request("/security/sso/" + targetProviderId, "DELETE", { version: 1 }, 409);
    const deleted = await request("/security/sso/" + targetProviderId, "DELETE", { version: 2 });
    assert.deepEqual(await deleted.json(), { deleted: true, removedAccounts: 1, endedSessions: 2, signedOut: true });
    assert.equal(await db.ssoProvider.count({ where: { id: targetProviderId } }), 0);
    assert.equal(await db.account.count({ where: { providerId: "sso:" + targetProviderId } }), 0);
    assert.equal(await db.ssoState.count({ where: { providerId: targetProviderId } }), 0);
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    const audit = await db.auditEvent.findMany({ where: { requestId: deleted.headers.get("x-request-id")! } });
    assert.equal(audit.filter(e => e.action === "sso.provider_deleted").length, 1);
    assert.equal(audit.filter(e => e.action === "sso.account_removed_with_provider").length, 1);
    assert.equal(audit.filter(e => e.action === "session.ended").length, 2);
    await request("/me", "GET", undefined, 401); cookie = "";
    await login(); ownSsoAccounts.parse(await (await request("/me/sso-accounts")).json()); await request("/auth/sign-out", "POST", {}); cookie = "";
    assert.equal(hash(JSON.stringify(await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } }))), providerHash);
    assert.equal(hash(JSON.stringify(await db.account.findUniqueOrThrow({ where: { id: originalAccount.id } }))), accountHash);
    writeFileSync(evidence + "http.json", JSON.stringify({ at: new Date().toISOString(), results, providerHash, accountHash,
      removedProviderId: targetProviderId, ownSessionsRemaining: 0, browserInteractionVerified: false, derivedProviderReferenceVerified: true, responseContractsVerified: true }, null, 2));
    writeFileSync(".local/qa-sso-provider-reference.json", JSON.stringify({ targetProviderId, phase: "complete" }));
  }
  console.log(JSON.stringify({ checks: results.length, restart: restarting, ownSessionsRemaining: 0 }));
} finally { await db.$disconnect(); }
