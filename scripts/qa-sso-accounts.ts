import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3161";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
const evidence = "docs/qa/P11-T03/accounts/";
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
  const response = await request("/auth/sso/" + fixture.providerId + "?mode=" + mode, "GET", undefined, 302);
  const url = new URL(response.headers.get("location")!);
  const xml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
  const requestId = /ID="([^"]+)"/.exec(xml)![1], relay = url.searchParams.get("RelayState")!;
  const state = await db.ssoState.findUniqueOrThrow({ where: { stateHash: hash(relay) } });
  const provider = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
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
  const provider = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const original = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + fixture.providerId, userId: fixture.userId } });
  const providerHash = hash(JSON.stringify(provider)), accountHash = hash(JSON.stringify(original));
  assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
  const restarting = process.argv.includes("--verify-restart");
  if (!restarting && existsSync(evidence + "http.json")) throw new Error("Existing evidence must be preserved");
  if (restarting) {
    const previous = JSON.parse(readFileSync(evidence + "http.json", "utf8"));
    assert.equal(providerHash, previous.providerHash); assert.equal(accountHash, previous.accountHash);
    assert.equal(await db.account.count({ where: { id: previous.removedAccountId } }), 0);
    await login();
    const items = await (await request("/me/sso-accounts")).json();
    assert.ok(items.items.some((a: { id: string }) => a.id === original.id));
    assert.ok(!items.items.some((a: { id: string }) => a.id === previous.removedAccountId));
    await request("/auth/sign-out", "POST", {}); cookie = "";
    writeFileSync(evidence + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results, providerHash, accountHash, ownSessionsRemaining: 0 }, null, 2));
  } else {
    await request("/me/sso-accounts", "GET", undefined, 401);
    await login();
    const page = await fetch(base + "/link/oauth2", { headers: { cookie }, redirect: "manual" });
    assert.equal(page.status, 200); assert.ok((await page.text()).includes("내 SSO 연결 계정"));
    results.push({ action: "GET /link/oauth2 HTML", status: page.status });
    const flow = await begin("link"), subject = "qa-unlink-" + randomUUID();
    const response = await fetch(base + "/api/v1/auth/sso/saml", { method: "POST", redirect: "manual", headers: {
      "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams({ SAMLResponse: assertion(flow.requestId, subject), RelayState: flow.relay }) });
    assert.equal(response.status, 302); assert.equal(response.headers.get("location"), "/link/oauth2/verified");
    results.push({ action: "POST /auth/sso/saml link", status: response.status });
    cookie = cookieOf(response);
    const linked = await db.account.findUniqueOrThrow({ where: { providerId_accountId: { providerId: "sso:" + fixture.providerId, accountId: provider.issuer + "|" + subject } } });
    assert.equal(linked.userId, fixture.userId);
    const listing = await (await request("/me/sso-accounts")).json();
    const target = listing.items.find((a: { id: string }) => a.id === linked.id);
    assert.ok(target?.canUnlink); assert.ok(!JSON.stringify(listing).includes(subject));
    await request("/auth/unlink-account", "POST", { accountId: linked.id }, 403);
    await request("/me/sso-accounts/" + linked.id, "DELETE", { updatedAt: new Date(0).toISOString(), confirm: true }, 409);
    const removed = await request("/me/sso-accounts/" + linked.id, "DELETE", { updatedAt: target.updatedAt, confirm: true });
    assert.equal(removed.headers.getSetCookie().length, 2);
    assert.equal(await db.account.count({ where: { id: linked.id } }), 0);
    const events = await db.auditEvent.findMany({ where: { requestId: removed.headers.get("x-request-id")! } });
    assert.equal(events.filter(e => e.action === "sso.account_unlinked").length, 1);
    assert.ok(events.filter(e => e.action === "session.ended").length >= 2);
    await request("/me/sso-accounts", "GET", undefined, 401); cookie = "";
    await login(); await request("/me/sso-accounts"); await request("/auth/sign-out", "POST", {}); cookie = "";
    assert.equal(hash(JSON.stringify(await db.account.findUniqueOrThrow({ where: { id: original.id } }))), accountHash);
    assert.equal(hash(JSON.stringify(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } }))), providerHash);
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    writeFileSync(evidence + "http.json", JSON.stringify({ at: new Date().toISOString(), results, providerHash, accountHash,
      removedAccountId: linked.id, ownSessionsRemaining: 0, browserInteractionVerified: false }, null, 2));
  }
  console.log(JSON.stringify({ checks: results.length, restart: restarting, ownSessionsRemaining: 0 }));
} finally { await db.$disconnect(); }
