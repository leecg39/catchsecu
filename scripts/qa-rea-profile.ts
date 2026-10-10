import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { roleCapabilities } from "../src/server/permissions";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3100");
const privateDirectory = ".local/rea-fullstack/profile", privateFile = privateDirectory + "/fixture.json", directory = "docs/qa/R05-T04/profile-flow";
type Person = { email: string; password: string; userId: string; cookie: string };
type Fixture = { tag: string; preparedAt: string; ready: boolean; people: Record<string, Person>; tenantId: string; otherTenantId: string; serviceId: string; memberId: string; eventId: string; reviewId?: string; secondReviewId?: string; thirdReviewId?: string;
  sso?: { providerId: string; accountId: string; credentialId: string; passwordBackup: string } };
async function save(fixture: Fixture) { await writeFile(privateFile, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 }); }
async function request(path: string, method = "GET", body?: unknown, cookie = "", label = "", headers: Record<string, string> = {}) {
  return fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { Origin: origin, ...(cookie ? { cookie } : {}),
    "User-Agent": "REA R05 independent HTTP " + label, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(actor: Person, label: string) {
  const response = await request("/auth/sign-in/email", "POST", { email: actor.email, password: actor.password }, "", label); assert.equal(response.status, 200);
  actor.cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => value.startsWith("better-auth.session_token=")).join("; "); assert.ok(actor.cookie);
}
async function finishPreparation(fixture: Fixture) {
  assert.equal(fixture.ready, false); assert.ok(fixture.tenantId && fixture.otherTenantId);
  for (const actor of Object.values(fixture.people)) {
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
    assert.equal(user.email, actor.email); assert.ok(user.createdAt.getTime() >= new Date(fixture.preparedAt).getTime());
  }
  fixture.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: fixture.tenantId } })).id;
  const seeded = await db.$transaction(async tx => {
    // Explicit fixture setup. Membership CRUD is exercised independently in R04.
    const member = await tx.membership.create({ data: { tenantId: fixture.tenantId, userId: fixture.people.member.userId, role: "privacy" } });
    await tx.serviceGrant.create({ data: { tenantId: fixture.tenantId, memberId: member.id, serviceId: fixture.serviceId, capabilities: [...roleCapabilities("privacy")] } });
    // A synthetic seed event is the input to review workflows, not claimed as a real privacy read.
    const event = await tx.auditEvent.create({ data: { tenantId: fixture.tenantId, serviceId: fixture.serviceId, actorId: fixture.people.member.userId,
      action: "submission.read", resource: "submission", resourceId: randomUUID(), requestId: randomUUID(), detail: { syntheticQA: true, purpose: "REA R05 activity review fixture input" } } });
    return { memberId: member.id, eventId: event.id };
  });
  Object.assign(fixture, seeded, { ready: true }); await save(fixture);
  const report = { fixtureSetupOnly: true, identitiesVerifiedDirectlyForFixture: true, membershipSeededForProfileAndReview: true, syntheticAuditEvent: true,
    tenantId: fixture.tenantId, otherTenantId: fixture.otherTenantId, serviceId: fixture.serviceId, memberId: fixture.memberId, eventId: fixture.eventId,
    people: Object.fromEntries(Object.entries(fixture.people).map(([label, actor]) => [label, actor.userId])) };
  await writeFile(directory + "/prepared.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
}
try {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 }); await mkdir(directory, { recursive: true });
  if (process.argv[2] === "prepare") {
    try { await readFile(privateFile); throw new Error("Existing fixture must not be replaced"); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
    const fixture: Fixture = { tag: randomUUID(), preparedAt: new Date().toISOString(), ready: false, people: {}, tenantId: "", otherTenantId: "", serviceId: "", memberId: "", eventId: "" };
    for (const label of ["owner", "member", "foreign"]) fixture.people[label] = { email: "rea-profile-" + label + "-" + fixture.tag + "@catchsecu.test", password: randomBytes(24).toString("hex") + "Aa!1", userId: "", cookie: "" };
    await save(fixture);
    for (const [label, actor] of Object.entries(fixture.people)) {
      const response = await request("/auth/sign-up/email", "POST", { email: actor.email, password: actor.password, name: "REA 프로필 " + label }); assert.equal(response.status, 200);
      const user = await db.user.findUniqueOrThrow({ where: { email: actor.email } }); assert.ok(user.createdAt.getTime() >= new Date(fixture.preparedAt).getTime());
      actor.userId = user.id; await db.user.update({ where: { id: user.id }, data: { emailVerified: true } }); await login(actor, label); await save(fixture);
    }
    for (const label of ["owner", "foreign"]) {
      const response = await request("/companies", "POST", { name: "REA 프로필 " + label + " " + fixture.tag.slice(0, 8), publicName: "REA 합성 프로필 회사" }, fixture.people[label].cookie); assert.equal(response.status, 201);
      const company = await response.json(); if (label === "owner") fixture.tenantId = company.id; else fixture.otherTenantId = company.id; await save(fixture);
    }
    await finishPreparation(fixture);
  } else if (process.argv[2] === "resume-prepare") {
    await finishPreparation(JSON.parse(await readFile(privateFile, "utf8")));
  } else {
    const fixture: Fixture = JSON.parse(await readFile(privateFile, "utf8")); assert.equal(fixture.ready, true);
    if (process.argv[2] === "verify") {
      assert.ok(fixture.reviewId && fixture.secondReviewId && fixture.thirdReviewId && fixture.sso);
      const people = Object.values(fixture.people).map(actor => actor.userId);
      const profiles = await db.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true, department: true, jobTitle: true, phone: true, locale: true, status: true, version: true }, orderBy: { id: "asc" } });
      const closed = profiles.find(row => row.id === fixture.people.member.userId)!;
      assert.deepEqual(closed, { id: fixture.people.member.userId, name: "REA 검증된 프로필", department: "REA 제품 검증", jobTitle: "QA 담당", phone: "010-0000-0000", locale: "ja", status: "closed", version: 6 });
      for (const actor of [fixture.people.owner, fixture.people.foreign]) assert.equal(profiles.find(row => row.id === actor.userId)?.status, "active");
      const closure = await db.accountClosure.findUniqueOrThrow({ where: { userId: closed.id } });
      assert.equal(decrypt<string>(closure.reasonCipher!), "REA 합성 계정 폐쇄 최종 검증"); assert.ok(!closure.reasonCipher!.includes("REA"));
      const cleared = { sessions: await db.session.count({ where: { userId: closed.id } }), accounts: await db.account.count({ where: { userId: closed.id } }),
        factors: await db.twoFactor.count({ where: { userId: closed.id } }), passwordHistory: await db.passwordHistory.count({ where: { userId: closed.id } }),
        passwordDeferrals: await db.passwordDeferral.count({ where: { userId: closed.id } }), userProofs: await db.verification.count({ where: { value: closed.id } }), grants: await db.serviceGrant.count({ where: { memberId: fixture.memberId } }) };
      assert.ok(Object.values(cleared).every(count => count === 0));
      const memberships = await db.membership.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, userId: true, status: true, role: true, version: true }, orderBy: { id: "asc" } });
      assert.equal(memberships.length, 2); assert.deepEqual(memberships.find(row => row.id === fixture.memberId), { id: fixture.memberId, userId: closed.id, status: "revoked", role: "privacy", version: 2 });
      const company = await db.company.findUniqueOrThrow({ where: { id: fixture.tenantId }, select: { id: true, status: true, version: true } }); assert.equal(company.status, "active");
      const service = await db.service.findUniqueOrThrow({ where: { id: fixture.serviceId }, select: { id: true, status: true, version: true } }); assert.equal(service.status, "active");
      const rawReviews = await db.activityReview.findMany({ where: { tenantId: fixture.tenantId }, include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } }, orderBy: { id: "asc" } }); assert.equal(rawReviews.length, 3);
      const expected = new Map([[fixture.reviewId, ["resolved", "destroyed", 5, 0]], [fixture.secondReviewId, ["resolved", "kept", 5, 3]], [fixture.thirdReviewId, ["cancelled", "none", 2, 2]]]);
      for (const row of rawReviews) {
        assert.deepEqual([row.status, row.destructionStatus, row.version, row.messages.length], expected.get(row.id));
        for (const message of row.messages) { assert.ok(decrypt<string>(message.bodyCipher).startsWith("REA")); assert.ok(!message.bodyCipher.includes("REA")); }
      }
      const reviews = rawReviews.map(row => ({ id: row.id, status: row.status, destructionStatus: row.destructionStatus, version: row.version, retentionUntil: row.retentionUntil,
        destroyedAt: row.destroyedAt, destroyApproverId: row.destroyApproverId, messages: row.messages.map(message => ({ id: message.id, kind: message.kind, cipherHash: createHash("sha256").update(message.bodyCipher).digest("hex") })) }));
      const audits = await db.auditEvent.findMany({ where: { OR: [{ tenantId: fixture.tenantId }, { tenantId: null, actorId: { in: people } }] }, select: { id: true, actorId: true, action: true, resourceId: true, requestId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const closedAudits = audits.filter(event => event.action === "account.closed"); assert.equal(closedAudits.length, 2); assert.equal(new Set(closedAudits.map(event => event.requestId)).size, 1);
      assert.equal(audits.filter(event => event.action === "sso.account_unlinked").length, 1); assert.ok(await db.auditEvent.findUnique({ where: { id: fixture.eventId } }));
      const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "activity-review:" + fixture.secondReviewId + ":1" }, include: { attemptsLog: true } }); assert.equal(job.status, "done"); assert.equal(job.attempts, 1); assert.equal(job.attemptsLog.length, 1);
      const bytes = await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")), mailHash = createHash("sha256").update(bytes).digest("hex");
      assert.equal(mailHash, JSON.parse(await readFile(directory + "/review-mail.json", "utf8")).fileHash);
      const checks: { label: string; status: number }[] = [];
      async function check(label: string, path: string, actor: string, status: number) { const response = await request(path, "GET", undefined, fixture.people[actor].cookie); assert.equal(response.status, status, label); const result = await response.json(); checks.push({ label, status }); return result; }
      assert.equal((await check("owner's own profile", "/me", "owner", 200)).id, fixture.people.owner.userId);
      assert.equal((await check("foreign user's own profile", "/me", "foreign", 200)).id, fixture.people.foreign.userId);
      await check("closed account's session remains invalid", "/me", "member", 401);
      for (const row of reviews) { const value = await check("owner can read preserved review " + row.id, "/activity-reviews/" + row.id, "owner", 200); assert.equal(value.version, row.version); assert.equal(value.messages.length, row.messages.length); }
      await check("foreign tenant cannot read preserved review", "/activity-reviews/" + fixture.secondReviewId, "foreign", 404);
      await check("closed recipient cannot read preserved review", "/activity-reviews/" + fixture.secondReviewId, "member", 401);
      const state = { profiles, memberships, company, service, closure: { id: closure.id, userId: closure.userId, completedAt: closure.completedAt, encryptedReasonVerified: true, cipherHash: createHash("sha256").update(closure.reasonCipher!).digest("hex") }, cleared,
        reviews, audits, mail: { jobId: job.id, status: job.status, attempts: job.attempts, receipts: job.attemptsLog.length, mailHash } };
      const stateHash = createHash("sha256").update(JSON.stringify(state)).digest("hex"), tag = process.argv[3] ?? "verified"; assert.match(tag, /^[a-z0-9-]+$/);
      if (tag !== "verified") assert.equal(stateHash, JSON.parse(await readFile(directory + "/verified.json", "utf8")).stateHash);
      await writeFile(directory + "/" + tag + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), checks, state, stateHash, externalProviderVerified: false }, null, 2) + "\n");
      console.log(JSON.stringify({ checks: checks.length, reviews: reviews.length, remainingMessages: reviews.reduce((sum, row) => sum + row.messages.length, 0), audits: audits.length, closedProfileVersion: closed.version, cleared, stateHash }));
    } else if (process.argv[2] === "login-member") {
      await login(fixture.people.member, "member"); await save(fixture); console.log(JSON.stringify({ independentHttpSessionCreated: true }));
    } else if (process.argv[2] === "prepare-sso") {
      assert.equal(fixture.sso, undefined);
      const credential = await db.account.findFirstOrThrow({ where: { userId: fixture.people.member.userId, providerId: "credential" } }); assert.ok(credential.password);
      const seeded = await db.$transaction(async tx => {
        // Synthetic existing connection only. No IdP login or provider preflight is claimed.
        const provider = await tx.ssoProvider.create({ data: { tenantId: fixture.tenantId, name: "REA 연결 해제 시험", protocol: "oidc", issuer: "https://identity.example.test",
          clientId: "rea-profile-fixture", authorizationUrl: "https://identity.example.test/authorize", tokenUrl: "https://identity.example.test/token", jwksUrl: "https://identity.example.test/jwks", enabled: false, preflightOk: false } });
        const account = await tx.account.create({ data: { userId: fixture.people.member.userId, providerId: "sso:" + provider.id, accountId: "rea-profile-" + fixture.tag } });
        return { providerId: provider.id, accountId: account.id };
      });
      fixture.sso = { ...seeded, credentialId: credential.id, passwordBackup: credential.password }; await save(fixture);
      const report = { ...seeded, connectionSeededDirectly: true, providerEnabled: false, externalProviderVerified: false };
      await writeFile(directory + "/sso-setup.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (["sso-only-fixture", "restore-credential"].includes(process.argv[2])) {
      assert.ok(fixture.sso);
      const credential = await db.account.findFirstOrThrow({ where: { id: fixture.sso.credentialId, userId: fixture.people.member.userId, providerId: "credential" } });
      assert.ok(credential.password === fixture.sso.passwordBackup || credential.password === null);
      const only = process.argv[2] === "sso-only-fixture";
      await db.account.update({ where: { id: credential.id }, data: { password: only ? null : fixture.sso.passwordBackup } });
      console.log(JSON.stringify({ directFixturePasswordAvailabilitySetup: true, hasPassword: !only }));
    } else if (process.argv[2] === "boundaries") {
      assert.ok(fixture.secondReviewId);
      const review = await db.activityReview.findFirstOrThrow({ where: { id: fixture.secondReviewId, tenantId: fixture.tenantId } });
      const member = await db.user.findUniqueOrThrow({ where: { id: fixture.people.member.userId } });
      const owner = await db.user.findUniqueOrThrow({ where: { id: fixture.people.owner.userId } });
      const foreignSession = await db.session.findFirstOrThrow({ where: { userId: fixture.people.foreign.userId } });
      const auditsBefore = await db.auditEvent.count({ where: { OR: [{ tenantId: fixture.tenantId }, { actorId: member.id }] } });
      const cases: { label: string; status: number; code?: string }[] = [];
      async function check(label: string, path: string, method: string, input: unknown, actor: string | null, expected: number) {
        const response = await request(path, method, input, actor ? fixture.people[actor].cookie : "", actor ?? "anonymous", { "Idempotency-Key": randomUUID() });
        const value = await response.json().catch(() => ({}));
        assert.equal(response.status, expected, label + ": " + (value.error?.code ?? ""));
        cases.push({ label, status: response.status, code: value.error?.code }); return value;
      }
      const profile = await check("query cannot expose another user's profile", "/me?userId=" + owner.id, "GET", undefined, "member", 200); assert.equal(profile.id, member.id);
      await check("profile cannot change account identity", "/me", "PATCH", { version: member.version, name: member.name, userId: owner.id }, "member", 422);
      await check("stale profile write is rejected", "/me", "PATCH", { version: 1, name: "REJECTED" }, "member", 409);
      await check("another user's session cannot be removed", "/me/sessions/" + foreignSession.id, "DELETE", undefined, "member", 404);
      await check("anonymous profile is denied", "/me", "GET", undefined, null, 401);
      await check("foreign tenant cannot read review", "/activity-reviews/" + review.id, "GET", undefined, "foreign", 404);
      await check("foreign tenant cannot act on review", "/activity-reviews/" + review.id + "/actions", "POST", { version: review.version, action: "cancel", message: "REJECTED" }, "foreign", 404);
      await check("recipient cannot resolve review", "/activity-reviews/" + review.id + "/actions", "POST", { version: review.version, action: "resolve", message: "REJECTED" }, "member", 403);
      await check("recipient cannot request notification", "/activity-reviews/" + review.id + "/notifications", "POST", { version: review.version }, "member", 403);
      await check("recipient cannot approve destruction", "/activity-reviews/" + review.id + "/destruction", "POST", { version: review.version, action: "destroy" }, "member", 403);
      await check("owner cannot respond for recipient", "/activity-reviews/" + review.id + "/actions", "POST", { version: review.version, action: "response", message: "REJECTED" }, "owner", 403);
      await check("second open review is rejected", "/activity-reviews", "POST", { auditEventId: fixture.eventId, title: "REJECTED", message: "REJECTED" }, "owner", 409);
      await check("company owner cannot close account", "/me/closure", "POST", { version: owner.version, confirmation: owner.email, password: fixture.people.owner.password }, "owner", 409);
      assert.equal(await db.auditEvent.count({ where: { OR: [{ tenantId: fixture.tenantId }, { actorId: member.id }] } }), auditsBefore);
      assert.equal((await db.activityReview.findUniqueOrThrow({ where: { id: review.id } })).version, review.version);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: member.id } })).version, member.version);
      assert.ok(await db.session.findUnique({ where: { id: foreignSession.id } }));
      const report = { cases, deniedWritesUnchanged: true, checkedAt: new Date().toISOString() };
      await writeFile(directory + "/boundaries.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ cases: cases.length, deniedWritesUnchanged: true }));
    } else if (process.argv[2] === "mail") {
      assert.ok(fixture.secondReviewId); assert.equal(env.MAIL_TRANSPORT, "local");
      const review = await db.activityReview.findFirstOrThrow({ where: { id: fixture.secondReviewId, tenantId: fixture.tenantId, auditEventId: fixture.eventId, status: "requested", version: 1 } });
      const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "activity-review:" + review.id + ":1" } });
      assert.equal(job.tenantId, fixture.tenantId); assert.equal(job.type, "mail.activity-review.v1");
      const payload = decrypt<{ to: string }>(job.payloadCipher); assert.equal(payload.to, fixture.people.member.email);
      if (job.status !== "done") assert.equal(await runOneJob("rea-profile-browser", { tenantId: fixture.tenantId, jobId: job.id }), true);
      const delivered = await db.job.findUniqueOrThrow({ where: { id: job.id }, include: { attemptsLog: true } }); assert.equal(delivered.status, "done");
      const bytes = await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")), mail = JSON.parse(bytes.toString()); assert.equal(mail.to, fixture.people.member.email);
      assert.ok(!mail.text.includes(review.title));
      const link = mail.text.match(/https?:\/\/\S+/)?.[0]; assert.ok(link && new URL(link).origin === origin && new URL(link).searchParams.get("reviewId") === review.id);
      const report = { reviewId: review.id, jobId: job.id, status: delivered.status, attempts: delivered.attempts, receiptCount: delivered.attemptsLog.length,
        fileHash: createHash("sha256").update(bytes).digest("hex"), reviewTitleExcluded: true, externalProviderVerified: false, scopedWorker: true };
      await writeFile(directory + "/review-mail.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (process.argv[2] === "prepare-second-retention") {
      assert.ok(fixture.secondReviewId);
      const review = await db.activityReview.findFirstOrThrow({ where: { id: fixture.secondReviewId, tenantId: fixture.tenantId, status: "resolved", version: 3, destructionStatus: "none" } });
      await db.activityReview.update({ where: { id: review.id }, data: { retentionUntil: new Date(Date.now() - 60000), destructionStatus: "awaiting", version: { increment: 1 } } });
      const report = { reviewId: review.id, fixtureClockAndAwaitingStateSetupOnly: true, expectedVersion: 4, globalRetentionWorkerRun: false };
      await writeFile(directory + "/second-retention-setup.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (process.argv[2] === "prepare-review-destruction") {
      assert.ok(fixture.reviewId);
      const review = await db.activityReview.findFirstOrThrow({ where: { id: fixture.reviewId, tenantId: fixture.tenantId, auditEventId: fixture.eventId, status: "requested", version: 1 } });
      for (const [actor, version, action, message] of [["member", 1, "response", "REA 합성 활동 검토 답변"], ["owner", 2, "resolve", "REA 합성 활동 검토 처리 완료"]] as const) {
        const response: Response = await fetch(origin + "/api/v1/activity-reviews/" + review.id + "/actions", { method: "POST", headers: { Origin: origin, cookie: fixture.people[actor].cookie, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify({ version, action, message }) }); assert.equal(response.status, 200);
      }
      await db.activityReview.update({ where: { id: review.id }, data: { retentionUntil: new Date(Date.now() - 60000), destructionStatus: "awaiting", version: { increment: 1 } } });
      const report = { reviewId: review.id, responseAndResolutionViaHttp: true, fixtureClockAndAwaitingStateSetupOnly: true, expectedVersion: 4, globalRetentionWorkerRun: false };
      await writeFile(directory + "/destruction-setup.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else if (process.argv[2] === "state") {
      const report = { profiles: await db.user.findMany({ where: { id: { in: Object.values(fixture.people).map(actor => actor.userId) } }, select: { id: true, name: true, phone: true, department: true, jobTitle: true, locale: true, version: true, status: true }, orderBy: { id: "asc" } }),
        reviews: await db.activityReview.findMany({ where: { tenantId: fixture.tenantId }, select: { id: true, auditEventId: true, status: true, version: true, destructionStatus: true, retentionUntil: true }, orderBy: { id: "asc" } }),
        audits: await db.auditEvent.findMany({ where: { OR: [{ tenantId: fixture.tenantId }, { actorId: { in: Object.values(fixture.people).map(actor => actor.userId) }, tenantId: null }] }, select: { id: true, actorId: true, action: true, resourceId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) };
      const tag = process.argv[3] ?? "state"; assert.match(tag, /^[a-z0-9-]+$/); await writeFile(directory + "/" + tag + ".json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ profiles: report.profiles.length, reviews: report.reviews.length, audits: report.audits.length }));
    } else throw new Error("Unknown command");
  }
} finally { await db.$disconnect(); }
