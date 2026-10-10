import assert from "node:assert/strict";
import { randomUUID, randomBytes, randomInt, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const privateDir = ".local/rea-fullstack/sso/journey", file = privateDir + "/fixture.json", output = "docs/qa/R07-T04/journey";
type Fixture = { tag: string; preparedAt: string; ready: boolean; email: string; password: string; userId: string; cookie: string;
  companyId: string; serviceId: string; providerId: string; orgCode: string; pin: string; inviteEmail: string; inviteId: string; inviteLink: string;
  secret?: string; backupCodes?: string[]; otp?: string; hash?: string };
let fixture: Fixture;
const checks: { action: string; status: number; code?: string }[] = [];
const save = () => writeFile(file, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
async function request(action: string, path: string, expected: number, input?: unknown, method = input === undefined ? "GET" : "POST") {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { origin, cookie: fixture.cookie,
    ...(input === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.json().catch(() => null);
  checks.push({ action, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, action + " " + (value?.error?.code ?? "")); return { response, value };
}
async function snapshot() {
  const state = await db.$transaction(async tx => {
    const users = await tx.user.findMany({ where: { OR: [{ id: fixture.userId }, { email: fixture.inviteEmail }] }, orderBy: { id: "asc" } });
    const ids = users.map(user => user.id);
    return {
      company: await tx.company.findUniqueOrThrow({ where: { id: fixture.companyId } }), users,
      accounts: await tx.account.findMany({ where: { userId: { in: ids } }, orderBy: { id: "asc" } }),
      factors: await tx.twoFactor.findMany({ where: { userId: { in: ids } }, orderBy: { id: "asc" } }),
      members: await tx.membership.findMany({ where: { tenantId: fixture.companyId }, include: { grants: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
      providers: await tx.ssoProvider.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
      directory: await tx.virtualOrgMember.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
      invitations: await tx.invitation.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
      sessions: await tx.session.findMany({ where: { userId: { in: ids } }, select: { id: true, userId: true, activeCompanyId: true, activeServiceId: true, createdAt: true, expiresAt: true }, orderBy: { id: "asc" } }),
      proofs: await tx.ssoSessionProof.findMany({ where: { tenantId: fixture.companyId }, orderBy: { sessionId: "asc" } }),
      states: await tx.ssoState.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
      audits: await tx.auditEvent.findMany({ where: { OR: [{ tenantId: fixture.companyId }, { actorId: { in: ids } }, { resourceId: { in: ids } }] }, orderBy: { id: "asc" } }),
      jobs: await tx.job.findMany({ where: { tenantId: fixture.companyId }, orderBy: { id: "asc" } }),
      wrongEmailUsers: await tx.user.count({ where: { email: `rea-journey-wrong-${fixture.tag}@example.test` } }),
    };
  }, { isolationLevel: "RepeatableRead" });
  const prepared = JSON.parse(await readFile(output + "/prepared.json", "utf8"));
  const mailHash = createHash("sha256").update(await readFile(env.LOCAL_MAIL_DIR + "/" + prepared.mail.jobId + ".json")).digest("hex");
  assert.equal(mailHash, prepared.mail.sha256, "Delivered invitation mail must remain unchanged");
  return { ...state, mail: { jobId: prepared.mail.jobId as string, sha256: mailHash } };
}
async function assertJourney(state: Awaited<ReturnType<typeof snapshot>>) {
  const owner = state.users.find(user => user.id === fixture.userId);
  const invited = state.users.find(user => user.email === fixture.inviteEmail);
  assert(owner?.twoFactorEnabled && owner.emailVerified); assert(invited?.emailVerified);
  assert.equal(state.users.length, 2); assert.equal(state.wrongEmailUsers, 0);
  assert.equal(state.accounts.length, 2);
  const password = state.accounts.find(account => account.userId === owner.id);
  const linked = state.accounts.find(account => account.userId === invited.id);
  assert(password?.password); assert.equal(password.ssoProviderId, null);
  assert.equal(linked?.ssoProviderId, fixture.providerId); assert.equal(linked?.password, null);
  assert.equal(state.factors.length, 1); assert.equal(state.factors[0].userId, owner.id);
  assert.equal(state.members.length, 2);
  assert.equal(state.members.find(member => member.userId === owner.id)?.role, "owner");
  const member = state.members.find(row => row.userId === invited.id);
  assert.equal(member?.status, "active"); assert.equal(member?.role, "editor"); assert.equal(member?.grants.length, 1);
  assert.equal(member?.grants[0].serviceId, fixture.serviceId);
  assert.deepEqual(member?.grants[0].capabilities.toSorted(), ["service.read", "form.read", "form.write", "form.publish", "document.read", "document.write", "file.write", "import.read", "import.write"].toSorted());
  assert.equal(state.invitations.length, 1);
  assert.equal(state.invitations[0].id, fixture.inviteId); assert.equal(state.invitations[0].status, "accepted");
  assert.equal(state.invitations[0].version, 2); assert.equal(state.invitations[0].acceptedBy, invited.id);
  assert.equal(state.sessions.length, 1); assert.equal(state.sessions[0].userId, invited.id);
  assert.equal(state.sessions[0].activeCompanyId, fixture.companyId);
  assert.equal(state.proofs.length, 1); assert.equal(state.proofs[0].sessionId, state.sessions[0].id);
  assert.equal(state.proofs[0].userId, invited.id); assert.equal(state.proofs[0].accountId, linked?.id);
  assert.equal(state.proofs[0].tenantId, fixture.companyId); assert.equal(state.proofs[0].providerId, fixture.providerId);
  assert.equal(state.proofs[0].identityProvider, "OTHER"); assert.equal(state.states.length, 0);
  assert.equal(state.providers.length, 1); assert(state.providers[0].enabled); assert.equal(state.directory.length, 3);
  assert.equal(state.jobs.find(job => job.id === state.mail.jobId)?.status, "done");
  const counts = Object.fromEntries([...new Set(state.audits.map(audit => audit.action))].map(action => [action, state.audits.filter(audit => audit.action === action).length]));
  assert.equal(counts["invitation.accepted"], 1); assert.equal(counts["sso.account_unlinked"], 1);
  assert.equal(counts["auth.factor_rejected"], 2); assert.equal(counts["auth.factor_verified"], 2);
  for (const label of ["mfa-pending", "unlinked", "wrong-invite-rejected"]) {
    const checkpoint = JSON.parse(await readFile(output + "/" + label + ".json", "utf8"));
    assert.equal(checkpoint.sessions.length, 0, label); assert.equal(checkpoint.proofs.length, 0, label);
    assert.equal(checkpoint.invitations[0].status, "pending", label);
  }
  const verified = JSON.parse(await readFile(output + "/mfa-authenticated.json", "utf8"));
  assert.equal(verified.sessions.length, 1); assert.equal(verified.sessions[0].userId, owner.id);
  assert.equal(verified.proofs.length, 1); assert.equal(verified.proofs[0].identityProvider, "OTHER");
  const denied = JSON.parse(await readFile(output + "/last-method-denied.json", "utf8"));
  assert.equal(denied.status, 409); assert.equal(denied.code, "SSO_LAST_LOGIN_METHOD");
}
try {
  await mkdir(privateDir, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true });
  const mode = process.argv[2];
  if (mode === "prepare") {
    assert(!await access(file).then(() => true, () => false), "Existing fixture must not be replaced");
    const tag = randomUUID().slice(0, 8);
    fixture = { tag, preparedAt: new Date().toISOString(), ready: false, email: `rea-journey-${tag}@example.test`, password: randomBytes(20).toString("hex") + "Aa!1",
      userId: "", cookie: "", companyId: "", serviceId: "", providerId: "", orgCode: "JOURNEY-" + tag, pin: String(randomInt(100000, 1000000)),
      inviteEmail: `rea-journey-invite-${tag}@example.test`, inviteId: "", inviteLink: "" };
    await save();
    await request("register dedicated owner", "/auth/sign-up/email", 200, { email: fixture.email, password: fixture.password, name: "SSO 여정 시험 소유자" });
    const user = await db.user.findUniqueOrThrow({ where: { email: fixture.email } });
    assert(user.createdAt >= new Date(fixture.preparedAt)); fixture.userId = user.id;
    // Identity bootstrap only, not an email verification acceptance result.
    await db.user.update({ where: { id: user.id }, data: { emailVerified: true } }); await save();
    const signed = await request("owner login", "/auth/sign-in/email", 200, { email: fixture.email, password: fixture.password });
    fixture.cookie = signed.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); assert(fixture.cookie); await save();
    fixture.companyId = (await request("create dedicated company", "/companies", 201, { name: "SSO 여정 시험 " + tag, publicName: "SSO 여정 QA" })).value.id; await save();
    fixture.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: fixture.companyId } })).id;
    const provider = (await request("create virtual GPKI", "/security/sso", 201, { tenantId: fixture.companyId, protocol: "gpki", name: "여정 시험 가상 GPKI" })).value;
    fixture.providerId = provider.id; await save();
    const preflight = (await request("preflight virtual GPKI", "/security/sso/" + provider.id + "/preflight", 200, {})).value;
    await request("enable virtual GPKI", "/security/sso/" + provider.id, 200, { tenantId: fixture.companyId, version: preflight.version, enabled: true }, "PATCH");
    for (const [employeeNo, email] of [["owner", fixture.email], ["invite", fixture.inviteEmail], ["wrong", `rea-journey-wrong-${tag}@example.test`]]) {
      await request("directory " + employeeNo, "/security/sso/" + provider.id + "/directory", 201,
        { orgCode: fixture.orgCode, employeeNo, email, name: "여정 시험 " + employeeNo, pin: fixture.pin });
    }
    fixture.inviteId = (await request("invite dedicated new user", "/invitations", 201, { email: fixture.inviteEmail, role: "editor", serviceIds: [fixture.serviceId] })).value.id; await save();
    const invitation = await db.invitation.findUniqueOrThrow({ where: { id: fixture.inviteId } });
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + invitation.id + ":" + invitation.version } });
    assert.equal(job.tenantId, fixture.companyId); assert.equal(decrypt<{ to: string }>(job.payloadCipher).to, fixture.inviteEmail);
    assert(await runOneJob("rea-sso-journey", { tenantId: fixture.companyId, jobId: job.id }));
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } }); assert.equal(done.status, "done");
    const bytes = await readFile(env.LOCAL_MAIL_DIR + "/" + job.id + ".json"), mail = JSON.parse(bytes.toString());
    assert.equal(mail.to, fixture.inviteEmail); fixture.inviteLink = mail.text.match(/https?:\/\/\S+/)?.[0];
    assert(fixture.inviteLink && new URL(fixture.inviteLink).origin === origin); fixture.ready = true; await save();
    await writeFile(output + "/prepared.json", JSON.stringify({ checkedAt: new Date().toISOString(), fixtureSetupOnly: true, emailVerifiedByDatabaseSetup: true,
      companyId: fixture.companyId, providerId: fixture.providerId, invitationId: fixture.inviteId, checks, mail: { transport: "local", jobId: job.id, status: done.status, sha256: createHash("sha256").update(bytes).digest("hex") }, externalProviderVerified: false }, null, 2) + "\n");
    console.log(JSON.stringify({ prepared: true, httpChecks: checks.length }));
  } else {
    fixture = JSON.parse(await readFile(file, "utf8")); assert(fixture.ready);
    assert(!fixture.hash || mode === "verify", "Frozen fixture permits verify only");
    if (mode === "otp") {
      assert(fixture.secret); fixture.otp = await createOTP(new TextDecoder().decode(base32.decode(fixture.secret)), { digits: 6, period: 30 }).totp(); await save();
      console.log(JSON.stringify({ generated: true }));
    } else if (["state", "freeze", "verify"].includes(mode)) {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state)).digest("hex");
      if (mode === "freeze" || mode === "verify") await assertJourney(state);
      if (mode === "freeze") { fixture.hash = hash; await save(); }
      if (mode === "verify") assert.equal(hash, fixture.hash);
      const label = process.argv[3] ?? mode; assert.match(label, /^[a-z0-9-]+$/);
      const report = { checkedAt: new Date().toISOString(), hash, ...(mode === "verify" ? { matched: true } : {}),
        users: state.users.map(user => ({ id: user.id, twoFactorEnabled: user.twoFactorEnabled, emailVerified: user.emailVerified })),
        accounts: state.accounts.map(account => ({ id: account.id, userId: account.userId, ssoProviderId: account.ssoProviderId })),
        members: state.members.map(member => ({ id: member.id, userId: member.userId, role: member.role, status: member.status, grants: member.grants.map(grant => ({ serviceId: grant.serviceId, capabilities: grant.capabilities })) })),
        invitations: state.invitations.map(invitation => ({ id: invitation.id, status: invitation.status, version: invitation.version })),
        sessions: state.sessions, proofs: state.proofs.map(proof => ({ sessionId: proof.sessionId, providerId: proof.providerId, identityProvider: proof.identityProvider })),
        factors: state.factors.length, states: state.states.length, wrongEmailUsers: state.wrongEmailUsers, mail: state.mail,
        ...(mode === "freeze" || mode === "verify" ? { journeyAssertionsPassed: true } : {}),
        auditCounts: Object.fromEntries([...new Set(state.audits.map(audit => audit.action))].map(action => [action, state.audits.filter(audit => audit.action === action).length])) };
      await writeFile(output + "/" + label + ".json", JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify({ mode, label, users: state.users.length, accounts: state.accounts.length, sessions: state.sessions.length, proofs: state.proofs.length, factors: state.factors.length, invitations: report.invitations, auditCounts: report.auditCounts }));
    } else throw new Error("Unknown mode");
  }
} catch (error) {
  await writeFile(output + "/failed-" + process.argv[2] + ".json", JSON.stringify({ checks, message: error instanceof Error ? error.message : "failed" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
