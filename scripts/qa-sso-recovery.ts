import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3160";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
const evidence = "docs/qa/P11-T03/recovery/";
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
const states: string[] = [];
async function browser(path: string, expected: number, location?: string, body?: URLSearchParams) {
  const response = await fetch(base + path, { method: body ? "POST" : "GET", redirect: "manual", headers: {
    accept: "text/html", "sec-fetch-dest": "document",
    ...(body ? { "content-type": "application/x-www-form-urlencoded", origin: "https://qa-idp.example.test" } : {}),
  }, ...(body ? { body } : {}) });
  assert.equal(response.status, expected, path);
  if (location) assert.equal(response.headers.get("location"), location);
  if (path.startsWith("/api/")) {
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  results.push({ action: (body ? "POST " : "GET ") + path.split("?")[0], status: response.status });
  return response;
}
try {
  const provider = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const account = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + fixture.providerId, userId: fixture.userId } });
  const providerHash = hash(JSON.stringify(provider));
  assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
  const restarting = process.argv.includes("--verify-restart");
  if (!restarting && existsSync(evidence + "http.json")) throw new Error("Existing evidence must be preserved");
  if (restarting) {
    const previous = JSON.parse(readFileSync(evidence + "http.json", "utf8"));
    assert.equal(providerHash, previous.providerHash); assert.equal(account.id, previous.linkedAccountId);
  }
  for (const page of ["/login/oauth2", "/login/saml", "/login/saml/start"]) {
    const html = await (await browser(page, 200)).text();
    assert.ok(html.includes("ssoAddress"));
  }
  // 실패 콜백이 입력의 민감값이나 외부 returnTo를 전달하지 않는지 실제 서버에서 확인한다.
  const failed = await browser("/api/v1/auth/sso/callback?error=access_denied&error_description=PRIVATE&returnTo=https://evil.test", 303, "/login?error=SSO_FAILED");
  assert.equal(failed.headers.get("set-cookie"), null);
  assert.ok(!(await failed.text()).includes("PRIVATE"));
  const failedHtml = await (await browser("/login?error=SSO_FAILED", 200)).text();
  assert.ok(failedHtml.includes("회사 SSO 로그인 다시 시작"));
  await browser("/api/v1/auth/sso/invalid", 303, "/login?error=SSO_FAILED");
  const invalid = await browser("/api/v1/auth/sso/saml", 303, "/login?error=SSO_FAILED", new URLSearchParams({ RelayState: "missing" }));
  assert.equal(invalid.headers.get("set-cookie"), null);
  await request("/auth/sso/callback?error=access_denied&error_description=PRIVATE", "GET", undefined, 422);
  const expired = await begin("login"); states.push(hash(expired.relay));
  await db.ssoState.update({ where: { stateHash: hash(expired.relay) }, data: { expiresAt: new Date(0) } });
  await browser("/api/v1/auth/sso/saml", 303, "/login?error=SSO_EXPIRED", new URLSearchParams({ RelayState: expired.relay, SAMLResponse: "invalid" }));
  const flow = await begin("login"); states.push(hash(flow.relay));
  const signed = assertion(flow.requestId, account.accountId.slice(provider.issuer.length + 1));
  const success = await browser("/api/v1/auth/sso/saml", 302, "/dashboard", new URLSearchParams({ RelayState: flow.relay, SAMLResponse: signed }));
  cookie = cookieOf(success); assert.ok(cookie);
  const me = await (await request("/me")).json(); assert.equal(me.email ?? me.user?.email, fixture.email);
  await request("/auth/sign-out", "POST", {}); cookie = "";
  await browser("/api/v1/auth/sso/saml", 303, "/login?error=SSO_EXPIRED", new URLSearchParams({ RelayState: flow.relay, SAMLResponse: signed }));
  assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
  assert.equal(hash(JSON.stringify(await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } }))), providerHash);
  writeFileSync(evidence + (restarting ? "http-restart.json" : "http.json"), JSON.stringify({ at: new Date().toISOString(), results,
    providerHash, linkedAccountId: account.id, ownSessionsRemaining: 0, browserInteractionVerified: false }, null, 2));
  console.log(JSON.stringify({ checks: results.length, restart: restarting, ownSessionsRemaining: 0 }));
} finally {
  // 이번 실행에서 만든 state만 정리한다.
  await db.ssoState.deleteMany({ where: { providerId: fixture.providerId, stateHash: { in: states } } });
  await db.$disconnect();
}
