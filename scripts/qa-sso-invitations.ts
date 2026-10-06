import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";
import { decrypt, tokenHash } from "../src/server/crypto";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3163";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
const targetProviderId = fixture.providerId;
const evidence = "docs/qa/P11-T03/invitations/";
const results: { action: string; status: number }[] = [];
let cookie = "";
const hash = (input: string) => createHash("sha256").update(input).digest("hex");
const cookieOf = (response: Response) => response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
async function request(path: string, method = "GET", input?: unknown, expected = 200) {
  const r = await fetch(base + "/api/v1" + path, { method, redirect: "manual", headers: { origin: base, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert.equal(r.status, expected, path);
  results.push({ action: method + " " + path, status: r.status });
  return r;
}
async function login() {
  cookie = cookieOf(await request("/auth/sign-in/email", "POST", { email: fixture.email, password: fixture.password }));
  assert.ok(cookie);
}
async function begin(token: string) {
  const response = await request("/invitations/sso/start", "POST", { token, providerId: targetProviderId });
  const url = new URL((await response.json()).redirect);
  assert.ok(!url.href.includes(token));
  const xml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
  const requestId = /ID="([^"]+)"/.exec(xml)![1], relay = url.searchParams.get("RelayState")!;
  const state = await db.ssoState.findUniqueOrThrow({ where: { stateHash: hash(relay) } });
  const invitation = await db.invitation.findUniqueOrThrow({ where: { tokenHash: tokenHash(token) } });
  assert.equal(state.invitationId, invitation.id); assert.equal(state.invitationVersion, invitation.version);
  assert.equal(state.invitationTokenHash, invitation.tokenHash);
  return { requestId, relay };
}
async function inviteToken(id: string, version: number) {
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + id + ":" + version } });
  const mail = decrypt<{ text: string }>(job.payloadCipher);
  return new URL(mail.text.match(/https?:\/\/[^\s]+/)![0]).searchParams.get("token")!;
}
async function callback(flow: { requestId: string; relay: string }, subject: string, email: string, expected: number) {
  const response = await fetch(base + "/api/v1/auth/sso/saml", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SAMLResponse: assertion(flow.requestId, subject, email), RelayState: flow.relay }) });
  assert.equal(response.status, expected, "SAML invitation callback");
  results.push({ action: "POST /auth/sso/saml invitation", status: response.status });
  return response;
}
const key = readFileSync(".local/qa-sso-provider-key.pem", "utf8");
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function assertion(requestId: string, subject: string, email: string) {
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
    + '<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>' + escape(email)
    + '</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>';
  const signer = new SignedXml({ privateKey: key, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
  signer.addReference({ xpath: "//*[local-name(.)='Response']", uri: "#" + id, digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] });
  signer.computeSignature(xml, { location: { reference: "//*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: "after" } });
  return Buffer.from(signer.getSignedXml()).toString("base64");
}
const marker = ".local/qa-sso-invitations.json";
type Pending = { phase: string; invitationId: string; serviceId: string; email: string; subject: string; requestId: string; relay: string; providerHash: string; accountHash: string; accountId: string; userId?: string };
try {
  const original = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const originalAccount = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + fixture.providerId, userId: fixture.userId } });
  const providerHash = hash(JSON.stringify(original)), accountHash = hash(JSON.stringify(originalAccount));
  assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
  const restarting = process.argv.includes("--verify-restart");
  if (restarting) {
    const pending: Pending = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(pending.phase, "pending");
    assert.equal(providerHash, pending.providerHash); assert.equal(accountHash, pending.accountHash);
    const response = await callback(pending, pending.subject, pending.email, 302);
    assert.equal(response.headers.get("location"), "/dashboard"); cookie = cookieOf(response);
    const user = await db.user.findUniqueOrThrow({ where: { email: pending.email } });
    const invitation = await db.invitation.findUniqueOrThrow({ where: { id: pending.invitationId } });
    assert.equal(invitation.status, "accepted"); assert.equal(invitation.acceptedBy, user.id);
    const member = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: fixture.tenantId, userId: user.id } } });
    assert.equal(member.role, "viewer"); assert.equal(member.status, "active");
    assert.equal(await db.serviceGrant.count({ where: { memberId: member.id, serviceId: pending.serviceId } }), 1);
    assert.equal(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: invitation.id } }), 1);
    await request("/me"); await request("/invitations/sso/options", "POST", { token: await inviteToken(invitation.id, 2) }, 410);
    await callback(pending, pending.subject, pending.email, 401);
    await request("/auth/sign-out", "POST", {}); cookie = "";
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
    assert.equal(hash(JSON.stringify(await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } }))), providerHash);
    assert.equal(hash(JSON.stringify(await db.account.findUniqueOrThrow({ where: { id: originalAccount.id } }))), accountHash);
    writeFileSync(evidence + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results, invitationId: invitation.id, memberId: member.id,
      accountId: (await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "sso:" + fixture.providerId } })).id,
      userId: user.id, statePersistedAcrossRestart: true, invitationAcceptedOnce: true, originalProviderAndAccountPreserved: true,
      ownSessionsRemaining: 0, browserInteractionVerified: false }, null, 2));
    writeFileSync(marker, JSON.stringify({ phase: "complete", invitationId: invitation.id, userId: user.id }), { mode: 0o600 });
  } else {
    if (existsSync(marker) || existsSync(evidence + "http.json")) throw new Error("Review existing run before repeating");
    assert.equal(original.protocol, "saml"); assert.ok(original.enabled && original.preflightOk);
    const email = "qa-invitation-" + randomUUID() + "@catchsecu.test", subject = "qa-invitation-" + randomUUID();
    await login();
    const service = await (await request("/services", "POST", { name: "QA SSO 초대 " + randomUUID(), externalName: "QA SSO 초대" }, 201)).json();
    const invitation = await (await request("/invitations", "POST", { email, role: "viewer", serviceIds: [service.id] }, 201)).json();
    const ownerCookie = cookie, token = await inviteToken(invitation.id, invitation.version); cookie = "";
    writeFileSync(marker, JSON.stringify({ phase: "created", invitationId: invitation.id }), { mode: 0o600 });
    const page = await fetch(base + "/oauth2/invite/signup?token=" + encodeURIComponent(token), { redirect: "manual" });
    assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    results.push({ action: "GET invitation page (token omitted)", status: page.status });
    const options = await (await request("/invitations/sso/options", "POST", { token })).json();
    assert.ok(options.providers.some((provider: { id: string }) => provider.id === fixture.providerId));
    for (const provider of options.providers) assert.deepEqual(Object.keys(provider).sort(), ["id", "name", "protocol"]);
    await request("/invitations/preview", "POST", { token }, 401);
    await request("/auth/sso/" + targetProviderId + "?mode=invite&invitation=" + invitation.id, "GET", undefined, 422);
    const oldFlow = await begin(token); cookie = ownerCookie;
    const resent = await (await request("/invitations/" + invitation.id + "/resend", "POST", { version: invitation.version })).json();
    const nextToken = await inviteToken(invitation.id, resent.version);
    await request("/auth/sign-out", "POST", {}); cookie = "";
    await request("/invitations/sso/options", "POST", { token }, 410);
    await callback(oldFlow, subject, email, 410);
    assert.equal(await db.user.count({ where: { email } }), 0);
    const wrongFlow = await begin(nextToken);
    await callback(wrongFlow, subject, "wrong-" + email, 410);
    assert.equal(await db.user.count({ where: { email } }), 0);
    const pending = await begin(nextToken);
    writeFileSync(marker, JSON.stringify({ phase: "pending", invitationId: invitation.id, serviceId: service.id, email, subject, ...pending,
      providerHash, accountHash, accountId: originalAccount.id }), { mode: 0o600 });
    writeFileSync(evidence + "http.json", JSON.stringify({ at: new Date().toISOString(), results, invitationId: invitation.id,
      awaitingRestart: true, providerHash, accountHash, ownSessionsRemaining: 0, browserInteractionVerified: false }, null, 2));
  }
  console.log(JSON.stringify({ checks: results.length, restart: restarting, ownSessionsRemaining: 0 }));
} finally { await db.$disconnect(); }
