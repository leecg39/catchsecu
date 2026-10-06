import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3159";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
const evidence = "docs/qa/P11-T03/saml-validation/";
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
async function callback(flow: Awaited<ReturnType<typeof begin>>, subject: string, expected: number) {
  // 실제 cross-site SAML POST와 같이 기존 로그인 쿠키 없이 검증한다.
  const response = await fetch(base + "/api/v1/auth/sso/saml", { method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SAMLResponse: assertion(flow.requestId, subject), RelayState: flow.relay }) });
  assert.equal(response.status, expected, "SAML callback");
  results.push({ action: "POST /auth/sso/saml", status: response.status });
  return response;
}
try {
  const provider = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const account = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + fixture.providerId, userId: fixture.userId } });
  const subject = account.accountId.slice(provider.issuer.length + 1);
  if (process.argv.includes("--verify-restart")) {
    const previous = JSON.parse(readFileSync(evidence + "http.json", "utf8")) as { providerHash: string; accountId: string };
    assert.equal(hash(JSON.stringify(provider)), previous.providerHash); assert.equal(account.id, previous.accountId);
    await login(); await request("/security/sso"); await request("/auth/sign-out", "POST", {});
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    writeFileSync(evidence + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results, hashesMatch: true, ownSessionsRemaining: 0 }, null, 2));
    console.log(JSON.stringify({ phase: "restart", checks: results.length, hashesMatch: true }));
  } else {
    if (existsSync(evidence + "http.json")) throw new Error("Protocol QA already recorded; use --verify-restart");
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    const acs = base + "/api/v1/auth/sso/saml";
    // Sign each malformed document with the trusted QA IdP key.
    const cases: [string, (xml: string) => string][] = [
      ["recipient single quote mismatch", xml => xml.replace(`Recipient="${acs}"`, "Recipient='https://wrong.example.test/acs'")],
      ["missing recipient", xml => xml.replace(` Recipient="${acs}"`, "")],
      ["missing subject", xml => xml.replace(/<saml:NameID>.*?<\/saml:NameID>/, "")],
      ["missing status", xml => xml.replace(/<samlp:Status>.*?<\/samlp:Status>/, "")],
    ];
    const states: string[] = [];
    for (const [label, mutate] of cases) {
      const flow = await begin("login"); states.push(hash(flow.relay));
      const encoded = assertion(flow.requestId, subject, mutate);
      const r = await fetch(acs, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ SAMLResponse: encoded, RelayState: flow.relay }) });
      assert.equal(r.status, 401, label); results.push({ action: label, status: r.status });
      assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    }
    const oversized = await fetch(acs, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "SAMLResponse=" + "A".repeat(1000001) });
    assert.equal(oversized.status, 413); results.push({ action: "oversized body", status: 413 });
    const duplicate = await fetch(acs, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "RelayState=a&RelayState=b&SAMLResponse=YQ==" });
    assert.equal(duplicate.status, 422); results.push({ action: "duplicate relay", status: 422 });
    const valid = await begin("login"); cookie = cookieOf(await callback(valid, subject, 302));
    const me = await (await request("/me")).json(); assert.equal(me.email ?? me.user?.email, fixture.email);
    await request("/auth/sign-out", "POST", {}); cookie = "";
    await callback(valid, subject, 401);
    await db.ssoState.deleteMany({ where: { providerId: fixture.providerId, stateHash: { in: states } } });
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    writeFileSync(evidence + "http.json", JSON.stringify({ at: new Date().toISOString(), results, providerHash: hash(JSON.stringify(provider)),
      accountId: account.id, ownSessionsRemaining: 0, malformedFieldsSignedWithTrustedKey: true,
      signedMalformedFieldsTestedInPostgresSuite: true, browserVerified: false, externalIdpVerified: false }, null, 2));
    console.log(JSON.stringify({ phase: "protocol", checks: results.length, ownSessionsRemaining: 0 }));
  }
} finally { await db.$disconnect(); }
