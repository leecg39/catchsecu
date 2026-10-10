import { SsoTestBrowser } from "../helpers/sso-browser";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { SignedXml } from "xml-crypto";
import { auth } from "@/server/auth";
import { opaqueToken, tokenHash } from "@/server/crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";

vi.hoisted(() => { process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL!.replace(/^http:/, "https:"); });

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const browser = new SsoTestBrowser();
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

// Capture the company selected by each fixture; never infer it from a later shared-session change.
const fixtureCompanies = new Map<string, string>();
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  if (path === "/security/sso" && method === "POST" && input && typeof input === "object") input = { tenantId: fixtureCompanies.get(cookie), ...input };
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: browser.cookie(cookie),
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
  const cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  fixtureCompanies.set(cookie, company.id);
  return { cookie, company, user };
}
beforeEach(async () => {
  browser.reset(); fixtureCompanies.clear();
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SsoProvider" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });

async function routes() {
  const { GET: startRoute } = await import("@/app/api/v1/auth/sso/[providerId]/route");
  const { POST: samlRoute } = await import("@/app/api/v1/auth/sso/saml/route");
  const { POST: createProvider } = await import("@/app/api/v1/security/sso/route");
  const { PATCH: patchProvider } = await import("@/app/api/v1/security/sso/[id]/route");
  return { startRoute: browser.wrap(startRoute), samlRoute: browser.wrap(samlRoute), createProvider, patchProvider };
}
async function makeProvider(cookie: string) {
  const { createProvider, patchProvider } = await routes();
  const created = await createProvider(req("/security/sso", cookie, "POST", { name: "SAML IdP", protocol: "saml",
    issuer: IDP_ENTITY, clientId: SP_ENTITY, authorizationUrl: IDP_ENTITY + "/sso", idpCert }, randomUUID()));
  const provider = await created.json();
  return { provider, created, patchProvider };
}
// 시작 요청 → SAMLRequest 디코딩 → IdP가 서명한 응답 POST까지의 정상 흐름
async function begin(cookie: string, providerId: string, invitationToken?: string) {
  const { startRoute } = await routes();
  const { POST: inviteStart } = await import("@/app/api/v1/invitations/sso/start/route");
  const started = invitationToken
    ? await browser.wrap(inviteStart)(req("/invitations/sso/start", cookie, "POST", { token: invitationToken, providerId }))
    : await startRoute(req(`/auth/sso/${providerId}?mode=login`, cookie));
  expect(started.status).toBe(invitationToken ? 200 : 302);
  const url = new URL(invitationToken ? (await started.json()).redirect : started.headers.get("location")!);
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
  expect(await db.ssoSessionProof.findFirst({ where: { userId: user.id } })).toMatchObject({ tenantId: company.id, providerId: provider.id, accountId: account.id, identityProvider: "OTHER" });
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
  const invitationToken = opaqueToken(), otherToken = opaqueToken();
  const invitation = await db.invitation.create({ data: { tenantId: company.id, invitedBy: ownerMembership.id,
    email: "sso-saml@catchsecu.test", role: "editor", serviceIds: [service.id],
    tokenHash: tokenHash(invitationToken), expiresAt: new Date(Date.now() + 86400000) } });
  // invitation 없는 invite 모드 → 422
  const noInv = await (await routes()).startRoute(req(`/auth/sso/${provider.id}?mode=invite`));
  expect(noInv.status).toBe(422);
  // 정상 초대가입
  const { url, requestId, relayState } = await begin(cookie, provider.id, invitationToken);
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
    tokenHash: tokenHash(otherToken), expiresAt: new Date(Date.now() + 86400000) } });
  const evil = await begin(cookie, provider.id, otherToken);
  const evilRes = await samlRoute(postSaml(sign(samlResponse({ inResponseTo: evil.requestId, nameId: "attacker-sub" })), evil.relayState));
  expect(evilRes.status).toBe(410);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("pending");
  expect(url.searchParams.get("SAMLRequest")).toBeTruthy();
});

test("SAML 인증서 교체와 동시 활성화는 거부하고 교체 후 재검사를 요구한다", async () => {
  const { cookie } = await ownerCookie();
  const { provider, patchProvider } = await makeProvider(cookie);
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const replacement = "-----BEGIN CERTIFICATE-----\\n" + "QUJD".repeat(40) + "\\n-----END CERTIFICATE-----";
  const simultaneous = await patchProvider(req("/security/sso/" + provider.id, cookie, "PATCH",
    { version: 1, idpCert: replacement, enabled: true, name: "인증서 교체" }));
  expect(simultaneous.status).toBe(409);
  expect((await simultaneous.json()).error.code).toBe("PREFLIGHT_REQUIRED");
  const rotated = await patchProvider(req("/security/sso/" + provider.id, cookie, "PATCH", { version: 1, idpCert: replacement }));
  expect(await rotated.json()).toMatchObject({ enabled: false, preflightOk: false, version: 2 });
  const { POST: preflight } = await import("@/app/api/v1/security/sso/[id]/preflight/route");
  expect(await (await preflight(req("/security/sso/" + provider.id + "/preflight", cookie, "POST"))).json())
    .toMatchObject({ enabled: false, preflightOk: false, version: 3 });
});

const protocolCases: [string, (xml: string) => string, ((xml: string) => string)?][] = [
  ["missing authentication statement", xml => xml.replace(/<saml:AuthnStatement .*?<\/saml:AuthnStatement>/, "")],
  ["oversized subject", xml => xml.replace("saml-sub-1", "a".repeat(301))],
  ["attribute cannot replace NameID", xml => xml.replace(/<saml:NameID[^>]*>.*?<\/saml:NameID>/, "")
    .replace('<saml:AttributeStatement>', '<saml:AttributeStatement><saml:Attribute Name="nameID"><saml:AttributeValue>forged-id</saml:AttributeValue></saml:Attribute>')],
  ["confirmation not-before", xml => xml.replace("<saml:SubjectConfirmationData ", `<saml:SubjectConfirmationData NotBefore="${iso(-60000)}" `)],
  ["DTD declaration", xml => xml, xml => '<!DOCTYPE samlp:Response [<!ENTITY test "unused">]>' + xml],
  ["missing recipient", xml => xml.replace(` Recipient="${acs}"`, "")],
  ["missing status", xml => xml.replace(/<samlp:Status>.*?<\/samlp:Status>/, "")],
  ["missing subject identifier", xml => xml.replace(/<saml:NameID[^>]*>.*?<\/saml:NameID>/, "")],
  ["blank subject identifier", xml => xml.replace("saml-sub-1", "   ")],
  ["missing bearer method", xml => xml.replace(' Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"', "")],
  ["wrong confirmation method", xml => xml.replace("cm:bearer", "cm:holder-of-key")],
  ["missing confirmation expiry", xml => xml.replace(/(<saml:SubjectConfirmationData) NotOnOrAfter="[^"]+"/, "$1")],
  ["missing confirmation request", xml => xml.replace(/(<saml:SubjectConfirmationData[^>]*?) InResponseTo="[^"]+"/, "$1")],
  ["wrong destination", xml => xml.replace(`Destination="${acs}"`, 'Destination="https://wrong.example.test/acs"')],
  ["wrong subject namespace", xml => xml.replace("<saml:Subject>", '<other:Subject xmlns:other="urn:wrong">').replace("</saml:Subject>", "</other:Subject>")],
  ["decoy recipient", xml => xml.replace("<saml:Subject>", `<hint:Data xmlns:hint="urn:hint" Recipient="${acs}"/><saml:Subject>`)
    .replace(/(SubjectConfirmationData[^>]*Recipient=")[^"]+/, '$1https://wrong.example.test/acs')],
  ["single quoted recipient", xml => xml.replace(`Recipient="${acs}"`, 'Recipient="https://wrong.example.test/acs"'),
    xml => xml.replace('Recipient="https://wrong.example.test/acs"', "Recipient='https://wrong.example.test/acs'")],
  ["spaced denial status", xml => xml.replace("status:Success", "status:RequestDenied"),
    xml => xml.replace('StatusCode Value="', 'StatusCode  Value = "')],
];
test.each(protocolCases)("SAML 구조: %s 응답은 계정과 세션을 만들지 않는다", async (_label, mutate, afterSign) => {
  const { cookie } = await ownerCookie();
  const { provider } = await makeProvider(cookie);
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const { requestId, relayState } = await begin(cookie, provider.id);
  let encoded = sign(mutate(samlResponse({ inResponseTo: requestId })));
  if (afterSign) encoded = Buffer.from(afterSign(Buffer.from(encoded, "base64").toString())).toString("base64");
  const result = await (await routes()).samlRoute(postSaml(encoded, relayState));
  expect(result.status).toBe(401);
  expect(await db.account.count({ where: { providerId: "sso:" + provider.id } })).toBe(0);
  expect(await db.user.count({ where: { email: "sso-saml@catchsecu.test" } })).toBe(0);
});

function signAssertion(xml: string) {
  const id = /<saml:Assertion ID="([^"]+)"/.exec(xml)![1];
  const sig = new SignedXml({ privateKey: idpKey, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", uri: "#" + id,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" } });
  return Buffer.from(sig.getSignedXml()).toString("base64");
}
test.each(["assertion signature", "namespace prefix", "quote whitespace", "alternate bearer"])("SAML 호환: %s 정상 응답은 허용한다", async variant => {
  const { cookie } = await ownerCookie(); const { provider } = await makeProvider(cookie);
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const { requestId, relayState } = await begin(cookie, provider.id);
  let xml = samlResponse({ inResponseTo: requestId });
  if (variant === "namespace prefix") xml = xml.replaceAll("xmlns:saml=", "xmlns:a=").replaceAll("xmlns:samlp=", "xmlns:p=")
    .replaceAll("saml:", "a:").replaceAll("samlp:", "p:");
  if (variant === "alternate bearer") {
    const confirmation = /<saml:SubjectConfirmation .*?<\/saml:SubjectConfirmation>/.exec(xml)![0];
    xml = xml.replace(confirmation, confirmation.replace(`Recipient="${acs}"`, 'Recipient="https://other.example.test/acs"') + confirmation);
  }
  let encoded = variant === "assertion signature" ? signAssertion(xml) : sign(xml);
  if (variant === "quote whitespace") encoded = Buffer.from(Buffer.from(encoded, "base64").toString()
    .replace('StatusCode Value="', 'StatusCode  Value = "').replace(`Recipient="${acs}"`, `Recipient = '${acs}'`)).toString("base64");
  const result = await (await routes()).samlRoute(postSaml(encoded, relayState)); expect(result.status).toBe(302);
  expect(await db.account.count({ where: { providerId: "sso:" + provider.id } })).toBe(1);
});
test("SAML 구조: 서명된 어서션의 수신자 대신 외부 포장 값으로 인증할 수 없다", async () => {
  const { cookie } = await ownerCookie(); const { provider } = await makeProvider(cookie);
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const { requestId, relayState } = await begin(cookie, provider.id);
  const xml = samlResponse({ inResponseTo: requestId, recipient: "https://other.example.test/acs" });
  let signed = Buffer.from(signAssertion(xml), "base64").toString();
  signed = signed.replace("<samlp:Status>", `<hint:Data xmlns:hint="urn:hint" Recipient="${acs}"/><samlp:Status>`);
  const result = await (await routes()).samlRoute(postSaml(Buffer.from(signed).toString("base64"), relayState));
  expect(result.status).toBe(401); expect(await db.account.count({ where: { providerId: "sso:" + provider.id } })).toBe(0);
});
test.each(["duplicate relay", "duplicate response", "oversized declared", "oversized streamed", "wrong type"])("SAML POST: %s 차단", async variant => {
  const form = new URLSearchParams({ SAMLResponse: "encoded", RelayState: "relay" });
  if (variant === "duplicate relay") form.append("RelayState", "other");
  if (variant === "duplicate response") form.append("SAMLResponse", "other");
  const headers = new Headers({ "content-type": variant === "wrong type" ? "application/json" : "application/x-www-form-urlencoded" });
  if (variant === "oversized declared") headers.set("content-length", "1000001");
  const body = variant === "oversized streamed" ? "SAMLResponse=" + "A".repeat(1000001) : form.toString();
  const result = await (await routes()).samlRoute(new Request(acs, { method: "POST", headers, body }));
  expect(result.status).toBe(variant === "wrong type" ? 415 : variant.startsWith("oversized") ? 413 : 422);
});
test("SAML 인증서 교체: 마지막 로그인 수단을 비활성화하는 교체 거부", async () => {
  const { cookie, user } = await ownerCookie();
  const { provider, patchProvider } = await makeProvider(cookie);
  expect((await patchProvider(req(`/security/sso/${provider.id}`, cookie, "PATCH", { version: 1, enabled: true }))).status).toBe(200);
  await db.account.create({ data: { userId: user.id, providerId: "sso:" + provider.id, accountId: "only-saml" } });
  await db.account.deleteMany({ where: { userId: user.id, providerId: "credential" } });
  const changed = await patchProvider(req(`/security/sso/${provider.id}`, cookie, "PATCH", { version: 2, idpCert: readFileSync(join(otherDir, "cert.pem"), "utf8") }));
  expect(changed.status).toBe(409); expect((await changed.json()).error.code).toBe("SSO_PROVIDER_LAST_LOGIN");
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ enabled: true, version: 2, idpCert: idpCert.trim() });
});

test.each(["missing", "other", "legacy", "http"])("E1 SAML %s 브라우저 결합/전송 거절은 서명된 상태도 소비하지 않는다", async variant => {
  const { cookie } = await ownerCookie(), { provider } = await makeProvider(cookie);
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const { requestId, relayState } = await begin(cookie, provider.id);
  const state = await db.ssoState.findFirstOrThrow();
  if (variant === "legacy") await db.ssoState.update({ where: { id: state.id }, data: { browserHash: null } });
  const { POST: rawSaml } = await import("@/app/api/v1/auth/sso/saml/route");
  const request = postSaml(sign(samlResponse({ inResponseTo: requestId })), relayState);
  request.headers.set("cookie", variant === "missing" ? "" : variant === "other" ? browser.cookie().split("=", 1)[0] + "=" + "x".repeat(43) : browser.cookie());
  const previous = env.BETTER_AUTH_URL;
  if (variant === "http") env.BETTER_AUTH_URL = previous.replace(/^https:/, "http:");
  try {
    const response = await rawSaml(request);
    expect(response.status).toBe(variant === "http" ? 503 : 401);
    expect((await response.json()).error.code).toBe(variant === "http" ? "SSO_HTTPS_REQUIRED" : "SSO_BROWSER_MISMATCH");
  } finally { env.BETTER_AUTH_URL = previous; }
  expect(await db.ssoState.count({ where: { id: state.id } })).toBe(1);
  expect(await db.account.count({ where: { providerId: "sso:" + provider.id } })).toBe(0);
});
