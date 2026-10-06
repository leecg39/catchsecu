import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { db } from "../src/server/db";
import { decrypt, tokenHash } from "../src/server/crypto";

const base = process.env.QA_SSO_BASE ?? "http://127.0.0.1:3165";
const database = new URL(process.env.DATABASE_URL ?? "");
if (new URL(base).hostname !== "127.0.0.1" || database.pathname !== "/catchsecu_dev"
  || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only local dedicated QA is allowed");
const fixture = JSON.parse(readFileSync(".local/qa-sso-provider-management.json", "utf8")) as {
  email: string; password: string; tenantId: string; userId: string; providerId: string;
};
const targetProviderId = fixture.providerId;
const evidence = "docs/qa/P11-T03/expert-reinvitation/";
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
  results.push({ action: "POST /auth/sso/saml", status: response.status });
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
try {
  const marker = ".local/qa-sso-expert-reinvitation.json";
  const original = await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } });
  const originalAccount = await db.account.findFirstOrThrow({ where: { ssoProviderId: fixture.providerId, userId: fixture.userId } });
  const providerHash = hash(JSON.stringify(original)), accountHash = hash(JSON.stringify(originalAccount));
  assert.equal(await db.session.count({ where: { userId: fixture.userId } }), 0);
  const restarting = process.argv.includes("--verify-restart");
  if (restarting) {
    const previous = JSON.parse(readFileSync(evidence + "http.json", "utf8"));
    assert.equal(providerHash, previous.providerHash); assert.equal(accountHash, previous.accountHash);
    assert.equal((await db.expertAssignment.findUniqueOrThrow({ where: { id: previous.assignmentId } })).status, "revoked");
    const member = await db.membership.findUniqueOrThrow({ where: { id: previous.memberId } });
    assert.equal(member.accessKind, "direct"); assert.equal(member.expertAssignmentId, null);
    assert.equal(await db.serviceGrant.count({ where: { memberId: member.id, serviceId: previous.oldServiceId } }), 0);
    assert.equal(await db.serviceGrant.count({ where: { memberId: member.id, serviceId: previous.serviceId } }), 1);
    assert.equal(await db.session.count({ where: { userId: previous.userId } }), 0);
    await login(); await request("/members"); await request("/auth/sign-out", "POST", {}); cookie = "";
    writeFileSync(evidence + "http-restart.json", JSON.stringify({ at: new Date().toISOString(), results,
      directMembershipAndRevocationPersisted: true, originalProviderAndAccountPreserved: true, ownSessionsRemaining: 0 }, null, 2));
  } else if (process.argv.includes("--resume-prepared")) {
    const saved = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(saved.phase, "prepared");
    const user = await db.user.findUniqueOrThrow({ where: { id: saved.userId } });
    const member = await db.membership.findUniqueOrThrow({ where: { id: saved.memberId } });
    assert.equal(member.tenantId, fixture.tenantId); assert.equal(member.userId, user.id);
    assert.equal(member.accessKind, "direct"); assert.equal(member.status, "active"); assert.equal(member.expertAssignmentId, null);
    const assignment = await db.expertAssignment.findUniqueOrThrow({ where: { id: saved.assignmentId } });
    assert.equal(assignment.expertUserId, user.id); assert.equal(assignment.tenantId, fixture.tenantId);
    assert.equal(assignment.status, "revoked"); assert.equal(assignment.version, 2); assert.ok(assignment.revokedAt);
    const grants = await db.serviceGrant.findMany({ where: { memberId: member.id } }); assert.equal(grants.length, 1);
    const scopes = await db.expertAssignmentService.findMany({ where: { assignmentId: assignment.id } }); assert.equal(scopes.length, 1);
    const serviceId = grants[0].serviceId, oldServiceId = scopes[0].serviceId; assert.notEqual(serviceId, oldServiceId);
    const accepted = await db.invitation.findMany({ where: { tenantId: fixture.tenantId, acceptedBy: user.id, status: "accepted" } });
    assert.equal(accepted.length, 1);
    assert.equal(await db.auditEvent.count({ where: { action: "expert.revoked", resourceId: assignment.id } }), 1);
    assert.equal(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: accepted[0].id } }), 1);
    const prior = JSON.parse(readFileSync("docs/qa/P11-T03/provider-reference/http.json", "utf8"));
    assert.equal(providerHash, prior.providerHash); assert.equal(accountHash, prior.accountHash);
    const abandoned = await db.session.findMany({ where: { userId: user.id }, select: { id: true } }); assert.equal(abandoned.length, 1);
    await db.session.deleteMany({ where: { userId: user.id, id: { in: abandoned.map(row => row.id) } } });
    const linked = await db.account.findFirstOrThrow({ where: { userId: user.id, ssoProviderId: fixture.providerId } });
    assert.ok(linked.accountId.startsWith(original.issuer + "|"));
    const subject = linked.accountId.slice(original.issuer.length + 1);
    const started = await request("/auth/sso/" + fixture.providerId + "?mode=login", "GET", undefined, 302);
    const url = new URL(started.headers.get("location")!);
    const xml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
    const flow = { requestId: /ID="([^"]+)"/.exec(xml)![1], relay: url.searchParams.get("RelayState")! };
    const signed = await callback(flow, subject, user.email, 302); cookie = cookieOf(signed);
    await request("/me");
    const own = (await (await request("/expert-assignments?scope=mine")).json()).items.find((row: { id: string }) => row.id === assignment.id);
    assert.equal(own.status, "revoked"); assert.equal(own.canSelect, false);
    await request("/services/" + serviceId); await request("/services/" + oldServiceId, "GET", undefined, 403);
    await callback(flow, subject, user.email, 401);
    await request("/auth/sign-out", "POST", {}); cookie = "";
    assert.equal(await db.session.count({ where: { userId: { in: [fixture.userId, user.id] } } }), 0);
    writeFileSync(evidence + "http.json", JSON.stringify({ at: new Date().toISOString(), results,
      userId: user.id, memberId: member.id, assignmentId: assignment.id, serviceId, oldServiceId, providerHash, accountHash,
      resumedPreparedFixture: true, abandonedOwnSessionCleaned: 1, fixturePreparedInDb: true, assignmentRevoked: true,
      oldServiceAccessDenied: true, ownSessionsRemaining: 0, browserInteractionVerified: false }, null, 2));
    writeFileSync(marker, JSON.stringify({ phase: "complete", userId: user.id, memberId: member.id, assignmentId: assignment.id }), { mode: 0o600 });
  } else {
    if (existsSync(marker) || existsSync(evidence + "http.json")) throw new Error("Review existing run before repeating");
    assert.equal(original.protocol, "saml"); assert.ok(original.enabled && original.preflightOk);
    const oldService = await db.service.findFirstOrThrow({ where: { tenantId: fixture.tenantId, status: "active" } });
    const email = "qa-reinvited-expert-" + randomUUID() + "@catchsecu.test", subject = "qa-reinvited-expert-" + randomUUID();
    await login();
    const service = await (await request("/services", "POST", { name: "QA 전문가 재초대 " + randomUUID(), externalName: "QA 전문가 재초대" }, 201)).json();
    // Reproduce a historical revoked expert membership with an active assignment and an existing SSO identity.
    const prepared = await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name: "QA 재초대 전문가", emailVerified: true } });
      await tx.account.create({ data: { userId: user.id, providerId: "sso:" + fixture.providerId, accountId: original.issuer + "|" + subject } });
      const assignment = await tx.expertAssignment.create({ data: { tenantId: fixture.tenantId, expertUserId: user.id,
        assignedById: fixture.userId, expiresAt: new Date(Date.now() + 3600000), services: { create: { serviceId: oldService.id } } } });
      const member = await tx.membership.create({ data: { tenantId: fixture.tenantId, userId: user.id, role: "viewer", status: "revoked",
        accessKind: "expert", expertAssignmentId: assignment.id, grants: { create: { serviceId: oldService.id, capabilities: ["service.read"] } } } });
      return { user, assignment, member };
    });
    writeFileSync(marker, JSON.stringify({ phase: "prepared", userId: prepared.user.id, assignmentId: prepared.assignment.id, memberId: prepared.member.id }), { mode: 0o600 });
    const invitation = await (await request("/invitations", "POST", { email, role: "editor", serviceIds: [service.id] }, 201)).json();
    const token = await inviteToken(invitation.id, invitation.version);
    await request("/auth/sign-out", "POST", {}); cookie = "";
    await request("/invitations/sso/options", "POST", { token });
    const flow = await begin(token);
    const response = await callback(flow, subject, email, 302); cookie = cookieOf(response);
    assert.equal(response.headers.get("location"), "/dashboard");
    await request("/me");
    const assignments = await (await request("/expert-assignments?scope=mine")).json();
    const ownAssignment = assignments.items.find((row: { id: string }) => row.id === prepared.assignment.id);
    assert.equal(ownAssignment.status, "revoked"); assert.equal(ownAssignment.canSelect, false);
    await request("/services/" + service.id);
    await request("/services/" + oldService.id, "GET", undefined, 403);
    const assignment = await db.expertAssignment.findUniqueOrThrow({ where: { id: prepared.assignment.id } });
    assert.equal(assignment.status, "revoked"); assert.equal(assignment.version, 2); assert.ok(assignment.revokedAt);
    const member = await db.membership.findUniqueOrThrow({ where: { id: prepared.member.id } });
    assert.equal(member.role, "editor"); assert.equal(member.accessKind, "direct"); assert.equal(member.expertAssignmentId, null);
    assert.deepEqual((await db.serviceGrant.findMany({ where: { memberId: member.id } })).map(row => row.serviceId), [service.id]);
    assert.equal(await db.auditEvent.count({ where: { action: "expert.revoked", resourceId: assignment.id, actorId: prepared.user.id } }), 1);
    assert.equal(await db.auditEvent.count({ where: { action: "invitation.accepted", resourceId: invitation.id } }), 1);
    await callback(flow, subject, email, 401);
    await request("/auth/sign-out", "POST", {}); cookie = "";
    assert.equal(await db.session.count({ where: { userId: { in: [fixture.userId, prepared.user.id] } } }), 0);
    assert.equal(hash(JSON.stringify(await db.ssoProvider.findUniqueOrThrow({ where: { id: fixture.providerId } }))), providerHash);
    assert.equal(hash(JSON.stringify(await db.account.findUniqueOrThrow({ where: { id: originalAccount.id } }))), accountHash);
    writeFileSync(evidence + "http.json", JSON.stringify({ at: new Date().toISOString(), results,
      userId: prepared.user.id, assignmentId: assignment.id, memberId: member.id, serviceId: service.id, oldServiceId: oldService.id,
      providerHash, accountHash, fixturePreparedInDb: true, assignmentRevoked: true, oldServiceAccessDenied: true,
      ownSessionsRemaining: 0, browserInteractionVerified: false }, null, 2));
    writeFileSync(marker, JSON.stringify({ phase: "complete", userId: prepared.user.id, assignmentId: assignment.id, memberId: member.id }), { mode: 0o600 });
  }
  console.log(JSON.stringify({ checks: results.length, restart: restarting, ownSessionsRemaining: 0 }));
} finally { await db.$disconnect(); }
