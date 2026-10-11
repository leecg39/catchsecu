import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt, opaqueToken, tokenHash } from "../src/server/crypto";
const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3121"); assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const dir = ".local/rea-fullstack/r07-signup", output = "docs/qa/R07-T04/signup", file = dir + "/fixture.json";
type Identity = { sub: string; email: string; name: string };
type Fixture = { email: string; password: string; ownerId: string; cookie: string; tenantId: string; providerId: string; serviceId: string;
  identities: Record<string, Identity>; invitation?: { id: string; token: string }; pending?: { cookie: string; input: Record<string, unknown>; identity: string }; accepted?: { cookie: string; userId: string; hash: string } };
let f: Fixture;
const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
const results: { action: string; status: number }[] = [];
async function request(path: string, cookie: string, method = "GET", body?: unknown, expected = 200) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", signal: AbortSignal.timeout(90000), headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, method + " " + path.split("?")[0] + " " + (response.status === expected ? "" : await response.clone().text()));
  results.push({ action: method + " " + path.split("?")[0], status: response.status }); return response;
}
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const identity = async (name: string) => { assert.ok(f.identities[name]); await writeFile(dir + "/identity.json", JSON.stringify(f.identities[name]), { mode: 0o600 }); };
async function begin(name: string, invited = false) {
  await identity(name); let authorize: string, cookie: string;
  if (invited) {
    assert.ok(f.invitation); const response = await request("/invitations/sso/start", "", "POST", { token: f.invitation.token, providerId: f.providerId });
    authorize = (await response.json()).redirect; cookie = cookies(response);
  } else { const response = await request("/auth/sso/" + f.providerId, "", "GET", undefined, 302); authorize = response.headers.get("location")!; cookie = cookies(response); }
  const idp = await fetch(authorize, { redirect: "manual", signal: AbortSignal.timeout(10000) }); assert.equal(idp.status, 302);
  const callback = new URL(idp.headers.get("location")!);
  const response = await request("/auth/sso/callback?" + callback.searchParams, cookie, "GET", undefined, 302);
  assert.equal(response.headers.get("location"), "/oauth2/signup"); assert.ok(!cookies(response).includes("better-auth.session_token="));
  cookie += "; " + cookies(response);
  const view = await (await request("/auth/sso/signup", cookie)).json();
  assert.equal(view.email, f.identities[name].email); assert.equal(await db.user.count({ where: { email: view.email } }), 0);
  const input = { intentId: view.id, overFourteen: true, termsAccepted: true, privacyAccepted: true, termsVersion: view.termsVersion, privacyVersion: view.privacyVersion };
  return { cookie, input, identity: name, view };
}
async function rows(userId: string) {
  return { userId, acceptance: await db.ssoSignupAcceptance.findUniqueOrThrow({ where: { userId } }),
    accounts: await db.account.findMany({ where: { userId }, select: { id: true, providerId: true, accountId: true } }),
    memberships: await db.membership.findMany({ where: { userId }, include: { grants: true }, orderBy: { id: "asc" } }),
    proofs: await db.ssoSessionProof.findMany({ where: { userId }, orderBy: { sessionId: "asc" } }),
    audits: await db.auditEvent.findMany({ where: { actorId: userId, action: { in: ["sso.signup_accepted", "sso.account_linked", "sso.login", "invitation.accepted"] } }, select: { id: true, action: true }, orderBy: { id: "asc" } }) };
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  await mkdir(dir, { recursive: true }); await mkdir(output, { recursive: true });
  const mode = process.argv[2], name = process.argv[3] ?? "browser";
  if (mode === "prepare") {
    const stored = await readFile(file, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    f = stored ? JSON.parse(stored) : { email: "r07-signup-owner-" + randomUUID() + "@example.test", password: "R07-Signup!" + randomUUID(), cookie: "", ownerId: "", tenantId: "", providerId: "", serviceId: "", identities: {} };
    for (const key of ["http", "invite", "browser", "cancel", "expired", "restart"]) f.identities[key] ??= { sub: key + "-" + randomUUID(), email: "r07-" + key + "-" + randomUUID() + "@example.test", name: "SSO 가입 확인 " + key };
    await save();
    if (!await db.user.findUnique({ where: { email: f.email } })) await request("/auth/sign-up/email", "", "POST", { email: f.email, password: f.password, name: "R07 가입 시험 관리자" });
    f.ownerId = (await db.user.update({ where: { email: f.email }, data: { emailVerified: true } })).id;
    f.cookie = cookies(await request("/auth/sign-in/email", "", "POST", { email: f.email, password: f.password }));
    f.tenantId ||= (await db.membership.findFirst({ where: { userId: f.ownerId, role: "owner", tenant: { name: "R07 OIDC 동의 시험" } } }))?.tenantId ?? "";
    if (!f.tenantId) f.tenantId = (await (await request("/companies", f.cookie, "POST", { name: "R07 OIDC 동의 시험", publicName: "R07 시험" }, 201)).json()).id;
    await save();
    await request("/context", f.cookie, "POST", { companyId: f.tenantId });
    f.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: f.tenantId } })).id;
    const provider = await db.ssoProvider.findFirst({ where: { tenantId: f.tenantId, clientId: "r07-signup-qa" } }) ?? await (await request("/security/sso", f.cookie, "POST", { tenantId: f.tenantId, protocol: "oidc", name: "R07 로컬 서명 IdP", issuer: "http://127.0.0.1:3123", clientId: "r07-signup-qa", authorizationUrl: "http://127.0.0.1:3123/authorize", tokenUrl: "http://127.0.0.1:3123/token", jwksUrl: "http://127.0.0.1:3123/jwks", scopes: "openid email profile" }, 201)).json();
    assert.equal(provider.preflightOk, true); f.providerId = provider.id;
    if (!provider.enabled) await request("/security/sso/" + provider.id, f.cookie, "PATCH", { version: provider.version, enabled: true });
    await save();
    const owner = await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: f.tenantId, userId: f.ownerId } } });
    if (!f.invitation) {
    const token = opaqueToken();
    const invitation = await db.invitation.create({ data: { tenantId: f.tenantId, invitedBy: owner.id, email: f.identities.invite.email, role: "editor", serviceIds: [f.serviceId], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 86400000) } });
    f.invitation = { id: invitation.id, token }; } await save(); await identity("browser");
    await writeFile(output + "/fixture.json", JSON.stringify({ tenantId: f.tenantId, providerId: f.providerId, companyAndProviderCreatedByHttp: true, ownerVerificationAndInvitationSeededDirectly: true, syntheticLocalIdp: true, officialProviderVerified: false }, null, 2));
  } else {
    f = JSON.parse(await readFile(file, "utf8"));
    if (mode === "identity") await identity(name);
    else if (mode === "http") {
      for (const key of ["http", "invite"]) {
        const pending = await begin(key, key === "invite");
        assert.equal(pending.view.companyName, key === "invite" ? "R07 OIDC 동의 시험" : null);
        await request("/auth/sso/signup", pending.cookie, "POST", { ...pending.input, termsAccepted: false }, 422);
        const accepted = await request("/auth/sso/signup", pending.cookie, "POST", pending.input); assert.equal((await accepted.json()).redirect, "/dashboard");
        const sessionCookie = cookies(accepted).split("; ").filter(c => !c.startsWith("catchsecu-sso-signup=")).join("; ");
        await request("/me", sessionCookie); await request("/auth/sso/signup", pending.cookie, "POST", pending.input, 410);
        const user = await db.user.findUniqueOrThrow({ where: { email: f.identities[key].email } }), state = await rows(user.id);
        assert.equal(state.accounts.length, 1); assert.equal(state.proofs.length, 1); assert.equal(state.memberships[0].role, key === "invite" ? "editor" : "viewer");
        assert.equal(state.memberships[0].grants.length, key === "invite" ? 1 : 0); assert.equal(state.audits.filter(a => a.action === "sso.signup_accepted").length, 1);
        if (key === "http") f.accepted = { cookie: sessionCookie, userId: user.id, hash: hash(state) };
      }
      await save(); await writeFile(output + "/http.json", JSON.stringify({ at: new Date().toISOString(), result: "passed", realRsaJwksPkce: true, officialProviderVerified: false, results }, null, 2));
    } else if (mode === "pending-restart") { f.pending = await begin("restart"); await save(); }
    else if (mode === "after-restart") {
      assert.ok(f.accepted && f.pending); assert.equal(hash(await rows(f.accepted.userId)), f.accepted.hash); await request("/me", f.accepted.cookie);
      await request("/auth/sso/signup", f.pending.cookie); await request("/auth/sso/signup", f.pending.cookie, "POST", f.pending.input);
      await request("/auth/sso/signup", f.pending.cookie, "POST", f.pending.input, 410);
      await writeFile(output + "/after-restart.json", JSON.stringify({ at: new Date().toISOString(), result: "passed", savedStateHash: f.accepted.hash, acceptedSessionPreserved: true, pendingConsentPreserved: true, results }, null, 2));
    } else if (mode === "shorten") {
      // Explicit QA-only deadline adjustment, scoped to this fixture and selected identity.
      const candidates = await db.ssoSignupIntent.findMany({ where: { tenantId: f.tenantId, providerId: f.providerId } });
      const selected = candidates.filter(row => decrypt<{ subject: Identity }>(row.payloadCipher).subject.email === f.identities[name].email);
      assert.equal(selected.length, 1);
      await db.ssoSignupIntent.update({ where: { id: selected[0].id }, data: { expiresAt: new Date(Date.now() + 10000) } });
    } else if (mode === "inspect") {
      const user = await db.user.findUnique({ where: { email: f.identities[name].email } });
      const snapshot = user ? await rows(user.id) : null;
      const pendingRows = await db.ssoSignupIntent.findMany({ where: { tenantId: f.tenantId } });
      const pendingForIdentity = pendingRows.filter(row => decrypt<{ subject: Identity }>(row.payloadCipher).subject.email === f.identities[name].email).length;
      const report = { at: new Date().toISOString(), identity: name, pendingForIdentity, userCount: Number(!!user), state: snapshot, pendingIntents: await db.ssoSignupIntent.count({ where: { tenantId: f.tenantId } }) };
      await writeFile(output + "/" + name + "-database.json", JSON.stringify(report, null, 2)); console.log({ identity: name, userCount: report.userCount, accounts: snapshot?.accounts.length ?? 0, consentReceipts: Number(!!snapshot?.acceptance), pendingIntents: report.pendingIntents });
    } else throw Error("Unknown QA mode");
  }
  console.log(JSON.stringify({ result: "passed", mode: process.argv[2], checks: results.length }));
} finally { await db.$disconnect(); }
