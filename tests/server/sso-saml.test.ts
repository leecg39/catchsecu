import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeEach, expect, test } from "vitest";
import { SignedXml } from "xml-crypto";
import { auth } from "@/server/auth";
import { tokenHash } from "@/server/crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Saml-owner!12345";
const acs = origin + "/api/v1/auth/sso/saml";
const IDP_ENTITY = "http://127.0.0.1:3999/idp";
const SP_ENTITY = "catchsecu-sp";

// 실제 X.509 인증서 + RSA 개인키를 openssl로 생성하고 xml-crypto로 실제 XML-DSig 서명한다.
const dir = mkdtempSync(join(tmpdir(), "saml-idp-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(dir, "key.pem"),
  "-out", join(dir, "cert.pem"), "-days", "2", "-nodes", "-subj", "/CN=test-saml-idp"], { stdio: "pipe" });
const idpKey = readFileSync(join(dir, "key.pem"), "utf8");
const idpCert = readFileSync(join(dir, "cert.pem"), "utf8");
const otherDir = mkdtempSync(join(tmpdir(), "saml-evil-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(otherDir, "key.pem"),
  "-out", join(otherDir, "cert.pem"), "-days", "2", "-nodes", "-subj", "/CN=evil-idp"], { stdio: "pipe" });
const evilKey = readFileSync(join(otherDir, "key.pem"), "utf8");

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");

function samlResponse(options: {
  inResponseTo: string; email?: string; nameId?: string; issuer?: string; audience?: string;
  recipient?: string; notOnOrAfter?: string; notBefore?: string; status?: string; responseId?: string;
}) {
  const o = { email: "sso-saml@catchsecu.test", nameId: "saml-sub-1", issuer: IDP_ENTITY, audience: SP_ENTITY,
    recipient: acs, notOnOrAfter: iso(300000), notBefore: iso(-60000), status: "urn:oasis:names:tc:SAML:2.0:status:Success",
    responseId: `_r${randomUUID().replaceAll("-", "")}`, ...options };
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${o.responseId}" Version="2.0" IssueInstant="${iso()}" Destination="${acs}" InResponseTo="${o.inResponseTo}"><saml:Issuer>${o.issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${o.status}"/></samlp:Status><saml:Assertion ID="_a${randomUUID().replaceAll("-", "")}" Version="2.0" IssueInstant="${iso()}"><saml:Issuer>${o.issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${o.notOnOrAfter}" Recipient="${o.recipient}" InResponseTo="${o.inResponseTo}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${o.notBefore}" NotOnOrAfter="${o.notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${o.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${o.email}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="name"><saml:AttributeValue>SAML 사용자</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
}

function sign(xml: string, key = idpKey) {
  const sig = new SignedXml({ privateKey: key,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
  const responseId = /ID="([^"]+)"/.exec(xml)![1];
  sig.addReference({ xpath: "//*[local-name(.)='Response']", uri: "#" + responseId,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: "after" } });
  return Buffer.from(sig.getSignedXml()).toString("base64");
}

function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ownerCookie() {
  const email = "saml-" + randomUUID() + "@catchsecu.test";
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "소유자", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "SAML 회사", publicName: "SAML", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } } } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  return { cookie: login.headers.getSetCookie().map(v => v.split(";")[0]).join("; "), company, user };
}
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SsoProvider" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });

async function routes() {
  const { GET: startRoute } = await import("@/app/api/v1/auth/sso/[providerId]/route");
  const { POST: samlRoute } = await import("@/app/api/v1/auth/sso/saml/route");
  const { POST: createProvider } = await import("@/app/api/v1/security/sso/route");
  const { PATCH: patchProvider } = await import("@/app/api/v1/security/sso/[id]/route");
  return { startRoute, samlRoute, createProvider, patchProvider };
}
async function makeProvider(cookie: string) {
  const { createProvider, patchProvider } = await routes();
  const created = await createProvider(req("/security/sso", cookie, "POST", { name: "SAML IdP", protocol: "saml",
    issuer: IDP_ENTITY, clientId: SP_ENTITY, authorizationUrl: IDP_ENTITY + "/sso", idpCert }, randomUUID()));
  const provider = await created.json();
  return { provider, created, patchProvider };
}
// 시작 요청 → SAMLRequest 디코딩 → IdP가 서명한 응답 POST까지의 정상 흐름
async function begin(cookie: string, providerId: string, invitationId?: string) {
  const { startRoute } = await routes();
  const started = await startRoute(req(`/auth/sso/${providerId}?mode=${invitationId ? "invite" : "login"}${invitationId ? `&invitation=${invitationId}` : ""}`, cookie));
  const url = new URL(started.headers.get("location")!);
  const requestXml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
  const requestId = /ID="([^"]+)"/.exec(requestXml)![1];
  return { started, url, requestXml, requestId, relayState: url.searchParams.get("RelayState")! };
}
function postSaml(samlResponseB64: string, relayState: string) {
  const body = new URLSearchParams({ SAMLResponse: samlResponseB64, RelayState: relayState });
  return new Request(origin + "/api/v1/auth/sso/saml", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body });
}

test("SAML 제공자 CRUD·인증서 사전검사·활성화", async () => {
  const { cookie } = await ownerCookie();
  const { createProvider, patchProvider } = await routes();
  const { provider, created } = await makeProvider(cookie);
  expect(created.status).toBe(201);
  expect(provider.protocol).toBe("saml");
  expect(provider.preflightOk).toBe(true);
  expect(provider.preflightDetail).toContain("test-saml-idp");
  expect(provider.hasCert).toBe(true);
  expect(JSON.stringify(provider)).not.toContain(idpKey.slice(30, 60));
  const enabled = await patchProvider(req(`/security/sso/${provider.id}`, cookie, "PATCH", { version: provider.version, enabled: true }));
  expect((await enabled.json()).enabled).toBe(true);
  // 인증서 없이 SAML 생성 → 422, OIDC 필드 누락 → 422, 손상 PEM → 사전검사 실패
  expect((await createProvider(req("/security/sso", cookie, "POST", { name: "무인증서", protocol: "saml",
    issuer: IDP_ENTITY, clientId: SP_ENTITY, authorizationUrl: IDP_ENTITY + "/sso" }, randomUUID()))).status).toBe(422);
  expect((await createProvider(req("/security/sso", cookie, "POST", { name: "OIDC 누락", issuer: IDP_ENTITY,
    clientId: "x", authorizationUrl: IDP_ENTITY + "/sso" }, randomUUID()))).status).toBe(422);
  const badCert = await createProvider(req("/security/sso", cookie, "POST", { name: "손상인증서", protocol: "saml",
    issuer: IDP_ENTITY, clientId: SP_ENTITY, authorizationUrl: IDP_ENTITY + "/sso",
    idpCert: "-----BEGIN CERTIFICATE-----\n" + "QUJD".repeat(40) + "\n-----END CERTIFICATE-----" }, randomUUID()));
  expect(badCert.status).toBe(201);
  expect((await badCert.json()).preflightOk).toBe(false);
  // http 비루프백 IdP SSO URL 거부
  expect((await createProvider(req("/security/sso", cookie, "POST", { name: "약한 SAML", protocol: "saml",
    issuer: IDP_ENTITY, clientId: SP_ENTITY, authorizationUrl: "http://idp.example.com/sso", idpCert }, randomUUID()))).status).toBe(422);
});

test("실제 SAML 로그인: AuthnRequest→서명검증→세션발급→JIT 프로비저닝→재전송 차단", async () => {
  const { cookie, company } = await ownerCookie();
  const { provider } = await makeProvider(cookie);
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const { url, requestXml, requestId, relayState } = await begin(cookie, provider.id);
  // AuthnRequest가 실제 IdP SSO URL로 향하고 ACS·Destination·ID가 올바른지 확인
  expect(url.origin + "/idp").toBe(IDP_ENTITY);
  expect(requestXml).toContain(`AssertionConsumerServiceURL="${acs}"`);
  expect(requestXml).toContain(`Destination="${IDP_ENTITY}/sso"`);
  const first = await routes().then(r => r.samlRoute(postSaml(sign(samlResponse({ inResponseTo: requestId })), relayState)));
  expect(first.status).toBe(302);
  expect(first.headers.get("location")).toBe("/dashboard");
  const sessionCookie = first.headers.get("set-cookie")!;
  expect(sessionCookie).toContain("better-auth.session_token=");
  const { GET: meRoute } = await import("@/app/api/v1/me/route");
  const me = await meRoute(req("/me", sessionCookie.split(";")[0]));
  expect(me.status).toBe(200);
  const meBody = await me.json();
  expect(meBody.email ?? meBody.user?.email).toBe("sso-saml@catchsecu.test");
  const user = await db.user.findUniqueOrThrow({ where: { email: "sso-saml@catchsecu.test" } });
  const member = await db.membership.findFirstOrThrow({ where: { tenantId: company.id, userId: user.id } });
  expect(member.role).toBe("viewer");
  const account = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + provider.id } });
  expect(account.accountId).toBe(`${IDP_ENTITY}|saml-sub-1`);
  // 같은 RelayState 재전송 → 401 (일회성 소비)
  const replay = await routes().then(r => r.samlRoute(postSaml(sign(samlResponse({ inResponseTo: requestId })), relayState)));
  expect(replay.status).toBe(401);
});

test("위조 SAML 응답은 모두 거부된다: 서명·issuer·audience·InResponseTo·Recipient·만료·RelayState", async () => {
  const { cookie } = await ownerCookie();
  const { provider } = await makeProvider(cookie);
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const { samlRoute } = await routes();
  const attempt = async (mutate: (o: Parameters<typeof samlResponse>[0]) => void, opts: { key?: string; unsigned?: boolean } = {}) => {
    const { requestId, relayState } = await begin(cookie, provider.id);
    const o: Parameters<typeof samlResponse>[0] = { inResponseTo: requestId };
    mutate(o);
    const xml = samlResponse(o);
    const b64 = opts.unsigned ? Buffer.from(xml).toString("base64") : sign(xml, opts.key ?? idpKey);
    const res = await samlRoute(postSaml(b64, relayState));
    expect(res.status).toBe(401);
    return res;
  };
  // 서명 없음
  await attempt(() => {}, { unsigned: true });
  // 다른 키로 서명
  await attempt(() => {}, { key: evilKey });
  // issuer 불일치
  await attempt(o => { o.issuer = "http://evil.example.com/idp"; });
  // audience 불일치
  await attempt(o => { o.audience = "other-sp"; });
  // InResponseTo 위조(없는 요청 ID)
  await attempt(o => { o.inResponseTo = "_forged"; });
  // Recipient가 다른 ACS
  await attempt(o => { o.recipient = "https://attacker.example.com/acs"; });
  // 만료된 어서션
  await attempt(o => { o.notOnOrAfter = iso(-120000); o.notBefore = iso(-3600000); });
  // IdP 실패 상태
  await attempt(o => { o.status = "urn:oasis:names:tc:SAML:2.0:status:RequestDenied"; });
  // 존재하지 않는 RelayState
  const orphan = await samlRoute(postSaml(sign(samlResponse({ inResponseTo: "_x" })), "orphan-relay"));
  expect(orphan.status).toBe(401);
  // 어서션 서명 후 XML 변조(이메일 탈취 시도) → 서명 불일치
  const { requestId, relayState } = await begin(cookie, provider.id);
  const signedXml = Buffer.from(sign(samlResponse({ inResponseTo: requestId })), "base64").toString();
  const tampered = Buffer.from(signedXml.replace("sso-saml@catchsecu.test", "victim@catchsecu.test")).toString("base64");
  expect((await samlRoute(postSaml(tampered, relayState))).status).toBe(401);
});

test("SAML 초대가입: 초대된 역할·서비스로 수락, 다른 이메일·없는 초대는 거부", async () => {
  const { cookie, company, user: owner } = await ownerCookie();
  const { provider, samlRoute } = await makeProvider(cookie).then(async m => ({ ...m, ...(await routes()) }));
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const service = await db.service.create({ data: { tenantId: company.id, name: "대상 서비스", externalName: "svc" } });
  const ownerMembership = await db.membership.findFirstOrThrow({ where: { tenantId: company.id, userId: owner.id } });
  const invitation = await db.invitation.create({ data: { tenantId: company.id, invitedBy: ownerMembership.id,
    email: "sso-saml@catchsecu.test", role: "editor", serviceIds: [service.id],
    tokenHash: tokenHash(randomUUID()), expiresAt: new Date(Date.now() + 86400000) } });
  // invitation 없는 invite 모드 → 422
  const noInv = await (await routes()).startRoute(req(`/auth/sso/${provider.id}?mode=invite`));
  expect(noInv.status).toBe(422);
  // 정상 초대가입
  const { url, requestId, relayState } = await begin(cookie, provider.id, invitation.id);
  const res = await samlRoute(postSaml(sign(samlResponse({ inResponseTo: requestId })), relayState));
  expect(res.status).toBe(302);
  expect(res.headers.get("set-cookie")).toContain("better-auth.session_token=");
  const user = await db.user.findUniqueOrThrow({ where: { email: "sso-saml@catchsecu.test" } });
  const member = await db.membership.findFirstOrThrow({ where: { tenantId: company.id, userId: user.id } });
  expect(member.role).toBe("editor");
  const grant = await db.serviceGrant.findFirstOrThrow({ where: { tenantId: company.id, memberId: member.id, serviceId: service.id } });
  expect(grant.capabilities.length).toBeGreaterThan(0);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("accepted");
  // 다른 이메일 초대로 탈취 시도 → 410
  const other = await db.invitation.create({ data: { tenantId: company.id, invitedBy: ownerMembership.id,
    email: "victim@catchsecu.test", role: "admin", serviceIds: [service.id],
    tokenHash: tokenHash(randomUUID()), expiresAt: new Date(Date.now() + 86400000) } });
  const evil = await begin(cookie, provider.id, other.id);
  const evilRes = await samlRoute(postSaml(sign(samlResponse({ inResponseTo: evil.requestId, nameId: "attacker-sub" })), evil.relayState));
  expect(evilRes.status).toBe(410);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("pending");
  expect(url.searchParams.get("SAMLRequest")).toBeTruthy();
});
