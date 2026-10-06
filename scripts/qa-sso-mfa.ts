import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { decrypt } from "../src/server/crypto";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3158";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
const evidence = "docs/qa/P11-T03/mfa/";
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
function assertion(requestId: string, subject: string) {
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
  signer.computeSignature(xml, { location: { reference: "//*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: "after" } });
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
const privateProof = ".local/qa-sso-mfa-challenge.json";
try {
  const account = await db.account.findFirstOrThrow({ where: { userId: fixture.userId, providerId: "sso:" + fixture.providerId } });
  const provider = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const subject = account.accountId.slice(provider.issuer.length + 1);
  if (!process.argv.includes("--verify-restart")) {
    if (existsSync(privateProof)) throw new Error("Existing MFA QA challenge; inspect it before rerunning");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: fixture.userId } })).twoFactorEnabled, false);
    await login();
    const setup = await (await request("/auth/two-factor/enable", "POST", { password: fixture.password })).json();
    const secret = new TextDecoder().decode(base32.decode(new URL(setup.totpURI).searchParams.get("secret")!));
    // 실패 복구에 필요한 합성 QA 계정의 인증 정보만 비공개 파일로 저장한다.
    writeFileSync(privateProof, JSON.stringify({ secret, phase: "enrolling" }), { mode: 0o600 });
    cookie = cookieOf(await request("/auth/two-factor/verify-totp", "POST", { code: await createOTP(secret, { digits: 6, period: 30 }).totp() }));
    await request("/auth/sign-out", "POST", {}); cookie = "";
    const flow = await begin("login");
    const challenged = await callback(flow, subject, 302);
    assert.equal(challenged.headers.get("location"), "/login-otp?returnTo=%2Fdashboard");
    cookie = cookieOf(challenged);
    await request("/me", "GET", undefined, 401);
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    writeFileSync(privateProof, JSON.stringify({ secret, phase: "pending", cookie, providerHash: hash(JSON.stringify(provider)) }), { mode: 0o600 });
    writeFileSync(evidence + "http-before-restart.json", JSON.stringify({ at: new Date().toISOString(), results,
      mfaEnrolledThroughApi: true, sessionsBeforeFactor: 0, redirect: challenged.headers.get("location"), browserVerified: false, externalIdpVerified: false }, null, 2));
    console.log(JSON.stringify({ phase: "pending-mfa", checks: results.length, sessions: 0 }));
  } else {
    const proof = JSON.parse(readFileSync(privateProof, "utf8")) as { secret: string; phase: string; cookie: string; providerHash: string };
    assert.equal(proof.phase, "pending");
    assert.equal(hash(JSON.stringify(provider)), proof.providerHash);
    cookie = proof.cookie;
    await request("/me", "GET", undefined, 401);
    const verified = await request("/auth/two-factor/verify-totp", "POST", { code: await createOTP(proof.secret, { digits: 6, period: 30 }).totp() });
    cookie = cookieOf(verified);
    const me = await (await request("/me")).json(); assert.equal(me.email ?? me.user?.email, fixture.email);
    const session = await db.session.findFirstOrThrow({ where: { userId: fixture.userId } }); assert.equal(session.activeCompanyId, fixture.tenantId);
    assert.equal(await db.auditEvent.count({ where: { action: "session.created", resourceId: session.id } }), 1);
    await request("/auth/sign-out", "POST", {});
    cookie = proof.cookie;
    await request("/auth/two-factor/verify-totp", "POST", { code: await createOTP(proof.secret, { digits: 6, period: 30 }).totp() }, 401);
    cookie = "";
    const next = await callback(await begin("login"), subject, 302); cookie = cookieOf(next);
    await request("/auth/two-factor/send-otp", "POST", {});
    const queued = await db.auditEvent.findFirstOrThrow({ where: { actorId: fixture.userId,
      action: "auth.factor_code_queued", resource: "job" }, orderBy: { createdAt: "desc" } });
    const job = await db.job.findUniqueOrThrow({ where: { id: queued.resourceId! } });
    const mail = decrypt<{ to: string; subject: string; text: string }>(job.payloadCipher);
    assert.equal(mail.to, fixture.email); assert.equal(mail.subject, "로그인 인증코드");
    const code = /인증코드: ([0-9]{6})/.exec(mail.text)![1];
    cookie = cookieOf(await request("/auth/two-factor/verify-otp", "POST", { code }));
    const disabled = await request("/auth/two-factor/disable", "POST", { password: fixture.password });
    cookie = cookieOf(disabled) || cookie;
    await request("/auth/sign-out", "POST", {});
    assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: fixture.userId } })).twoFactorEnabled, false);
    writeFileSync(privateProof, JSON.stringify({ phase: "complete" }), { mode: 0o600 });
    writeFileSync(evidence + "http-after-restart.json", JSON.stringify({ at: new Date().toISOString(), results,
      pendingChallengeSurvivedRestart: true, tenantMatches: true, sessionCreatedAudit: true, emailCodeSource: "local encrypted outbox",
      ownSessionsRemaining: 0, fixtureMfaRestored: true, browserVerified: false, externalIdpVerified: false }, null, 2));
    console.log(JSON.stringify({ phase: "verified-and-restored", checks: results.length, sessions: 0 }));
  }
} finally { await db.$disconnect(); }
