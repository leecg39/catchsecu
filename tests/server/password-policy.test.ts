import { beforeEach as beforeSecurityCase } from "vitest";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { decrypt } from "@/server/crypto";
import { addPolicyMonths, effectivePasswordRules } from "@/server/password-policy";
import { policyDefaults } from "@/contracts/security";
import { GET as statusGet, POST as defer } from "@/app/api/v1/me/password-policy/route";
import { GET as services } from "@/app/api/v1/services/route";
import { GET as context, POST as switchCompany } from "@/app/api/v1/context/route";
import { GET as policyGet, PATCH as policyPatch, DELETE as policyReset } from "@/app/api/v1/security/policy/route";
import { GET as authRouteGet, POST as authRoutePost } from "@/app/api/v1/auth/[...all]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test database is allowed.");
const origin = env.BETTER_AUTH_URL, password = "Password-test-initial!123", replacement = "Password-test-replacement!456";
const tenant = randomUUID(), foreignTenant = randomUUID();
type Person = { id: string; email: string; memberId: string; cookie: string };
let owner: Person, person: Person;
function req(path: string, method = "GET", cookie = person?.cookie ?? "", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
const authRoute = (request: Request) => request.method === "GET" ? authRouteGet(request) : authRoutePost(request);
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const authCall = (path: string, data: unknown, cookie = "") => authRoute(req("/auth" + path, "POST", cookie, data));
async function login(user: Person, next = password) {
  const response = await authCall("/sign-in/email", { email: user.email, password: next });
  expect(response.status).toBe(200); return cookieOf(response);
}
async function createPerson(role: "owner" | "viewer" = "viewer", company = tenant) {
  await db.rateLimit.deleteMany();
  const email = randomUUID() + "@password.test.local";
  expect((await authCall("/sign-up/email", { name: role, email, password })).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company, userId: user.id, role } });
  const result = { id: user.id, email, memberId: member.id, cookie: "" };
  result.cookie = await login(result); return result;
}
const change = (next = replacement, current = password, cookie = person.cookie) => authCall("/change-password", { currentPassword: current, newPassword: next, revokeOtherSessions: false }, cookie);
const passwordStatus = async (cookie = person.cookie) => (await statusGet(req("/me/password-policy", "GET", cookie))).json();
async function expire() { await db.user.update({ where: { id: person.id }, data: { passwordChangedAt: new Date("2020-01-31T15:30:00Z") } }); }
async function configure(patch: Record<string, unknown>) {
  const response = await policyGet(req("/security/policy", "GET", owner.cookie)); expect(response.status).toBe(200);
  const current = await response.json();
  const fields = Object.fromEntries(Object.keys(policyDefaults).map(key => [key, current[key]]));
  return policyPatch(req("/security/policy", "PATCH", owner.cookie, { ...fields, tenantId: tenant, version: current.version, password, ...patch }));
}
async function proof() {
  await db.rateLimit.deleteMany();
  expect((await authCall("/request-password-reset", { email: person.email, redirectTo: "/passwordChange" })).status).toBe(200);
  const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const mail = jobs.map(job => decrypt<{ to: string; text: string; subject: string }>(job.payloadCipher)).find(mail => mail.to === person.email && mail.subject === "비밀번호 재설정")!;
  const response = await authRoute(new Request(mail.text.match(/https?:\/\/\S+/)![0]));
  return new URL(response.headers.get("location")!, origin).searchParams.get("token")!;
}
const reset = (token: string, next = replacement) => authCall("/reset-password", { token, newPassword: next });
async function deferNow(cookie = person.cookie, patch: Record<string, unknown> = {}) {
  const status = await passwordStatus(cookie);
  return defer(req("/me/password-policy", "POST", cookie, { tenantId: tenant, passwordRevision: status.passwordRevision, ...patch }));
}
const account = () => db.account.findFirstOrThrow({ where: { userId: person.id, providerId: "credential" } });
async function checkPassword(value: string) { const ctx = await auth.$context; return ctx.password.verify({ hash: (await account()).password!, password: value }); }

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const id of [tenant, foreignTenant]) await db.company.create({ data: { id, name: id, publicName: id, policy: { create: {} } } });
  owner = await createPerson("owner"); await createPerson("owner", foreignTenant);
});
beforeEach(async () => {
  await db.securityPolicy.updateMany({ data: { ...policyDefaults, version: { increment: 1 }, passwordRevision: { increment: 1 } } });
  await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany();
  person = await createPerson();
});
afterAll(async () => { await db.$disconnect(); });

describe("password policy, expiry and credential transactions", () => {
  test("calendar-month deadlines preserve Korea time and clip leap and short month ends", () => {
    expect(addPolicyMonths(new Date("2024-01-30T16:23:00Z"), 1).toISOString()).toBe("2024-02-28T16:23:00.000Z");
    expect(addPolicyMonths(new Date("2023-01-30T16:23:00Z"), 1).toISOString()).toBe("2023-02-27T16:23:00.000Z");
    expect(addPolicyMonths(new Date("2024-02-28T16:23:00Z"), 12).toISOString()).toBe("2025-02-27T16:23:00.000Z");
    expect(addPolicyMonths(new Date("2026-12-30T16:23:00Z"), 2).toISOString()).toBe("2027-02-27T16:23:00.000Z");
  });
  test("policy CRUD validates limits, versions password rules separately and restores defaults", async () => {
    const before = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: tenant } });
    for (const invalid of [{ passwordMonths: 13 }, { passwordReuse: 2 }, { passwordDeferral: "forever" }, { minPassword: 129 }])
      expect((await configure(invalid)).status).toBe(422);
    const saved = await configure({ minPassword: 16, passwordMonths: 2, passwordReuse: 10, passwordDeferral: "period" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ minPassword: 16, passwordMonths: 2, passwordReuse: 10, passwordDeferral: "period",
      passwordRevision: before.passwordRevision + 1, approvalRevision: before.approvalRevision });
    expect((await configure({ sessionMinutes: 60 })).status).toBe(200);
    const current = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: tenant } });
    expect(current.passwordRevision).toBe(before.passwordRevision + 1);
    const restored = await policyReset(req("/security/policy", "DELETE", owner.cookie, { tenantId: tenant, version: current.version, password }));
    expect(restored.status).toBe(200); expect(await restored.json()).toMatchObject(policyDefaults);
  });
  test("change rejects missing authentication, wrong origin, unknown fields and incorrect current password", async () => {
    expect((await change(replacement, password, "")).status).toBe(401);
    expect((await authRoute(req("/auth/change-password", "POST", person.cookie, { currentPassword: password, newPassword: replacement }, { origin: "https://invalid.example" }))).status).toBe(403);
    expect((await authCall("/change-password", { currentPassword: password, newPassword: replacement, userId: owner.id }, person.cookie)).status).toBe(422);
    const wrong = await change(password, "incorrect");
    expect(wrong.status).toBe(400); expect(await wrong.json()).toMatchObject({ code: "INVALID_PASSWORD" });
    expect(await db.passwordHistory.count({ where: { userId: person.id } })).toBe(0);
  });
  test("default rejects current password and a failed reset leaves its proof and all sessions intact", async () => {
    const token = await proof(), before = await account(), sessions = await db.session.count({ where: { userId: person.id } });
    const changed = await change(password); expect(changed.status).toBe(400); expect(await changed.json()).toMatchObject({ code: "PASSWORD_REUSED" });
    const failed = await reset(token, password); expect(failed.status).toBe(400); expect(await failed.json()).toMatchObject({ code: "PASSWORD_REUSED" });
    expect((await account()).password === before.password).toBe(true);
    expect(await db.verification.count({ where: { value: person.id } })).toBe(1);
    expect(await db.session.count({ where: { userId: person.id } })).toBe(sessions);
    expect((await reset(token)).status).toBe(200); expect(await checkPassword(replacement)).toBe(true);
    expect(await db.verification.count({ where: { value: person.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: person.id } })).toBe(0);
  });
  test("successful change records one hash, clears all reset proofs and revokes other sessions even when false was sent", async () => {
    const old = await db.user.findUniqueOrThrow({ where: { id: person.id } }), oldHash = (await account()).password;
    const second = await login(person); await proof(); await proof();
    const started = Date.now(), result = await change(); expect(result.status).toBe(200);
    const history = await db.passwordHistory.findMany({ where: { userId: person.id } });
    expect(history).toHaveLength(1); expect(history[0].passwordHash === oldHash).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).passwordChangedAt! > old.passwordChangedAt!).toBe(true);
    expect((await services(req("/services", "GET", person.cookie))).status).toBe(401);
    expect((await services(req("/services", "GET", second))).status).toBe(401);
    expect((await services(req("/services", "GET", cookieOf(result)))).status).toBe(200);
    expect(await db.verification.count({ where: { value: person.id } })).toBe(0);
    const audit = await db.auditEvent.findMany({ where: { actorId: person.id, action: "password.changed" } });
    expect(audit).toHaveLength(1); expect(audit[0].detail).toEqual({ changedFields: ["password"] });
    const changedAt = (await db.user.findUniqueOrThrow({ where: { id: person.id } })).passwordChangedAt!;
    for (const date of [changedAt, history[0].changedAt, audit[0].createdAt]) {
      expect(date.getTime()).toBeGreaterThanOrEqual(started); expect(date.getTime()).toBeLessThanOrEqual(Date.now());
    }
    for (const secret of [password, replacement, oldHash!]) expect(JSON.stringify(audit).includes(secret)).toBe(false);
  });
  test("the credential trigger stores UTC even on a connection set to Korea time", async () => {
    const started = Date.now(), nextHash = await (await auth.$context).password.hash(replacement);
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Seoul'`;
      await tx.account.update({ where: { id: (await account()).id }, data: { password: nextHash } });
    });
    const user = await db.user.findUniqueOrThrow({ where: { id: person.id } });
    const history = await db.passwordHistory.findFirstOrThrow({ where: { userId: person.id } });
    const event = await db.auditEvent.findFirstOrThrow({ where: { actorId: person.id, action: "password.changed" } });
    for (const date of [user.passwordChangedAt!, history.changedAt, event.createdAt]) {
      expect(date.getTime()).toBeGreaterThanOrEqual(started); expect(date.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
  test("disabling reuse permits the same password but still rotates its hash and sessions", async () => {
    expect((await configure({ passwordReuse: 0 })).status).toBe(200);
    const before = (await account()).password, result = await change(password);
    expect(result.status).toBe(200); expect((await account()).password === before).toBe(false);
    expect(await checkPassword(password)).toBe(true);
    expect((await services(req("/services", "GET", person.cookie))).status).toBe(401);
  });
  test("the strongest minimum and reuse rules apply across active memberships, excluding suspended memberships and companies", async () => {
    await db.securityPolicy.update({ where: { tenantId: foreignTenant }, data: { minPassword: 40, passwordReuse: 10 } });
    const member = await db.membership.create({ data: { tenantId: foreignTenant, userId: person.id, role: "viewer" } });
    expect(await effectivePasswordRules(person.id)).toEqual({ minPassword: 40, passwordReuse: 10 });
    const token = await proof(), rejected = await reset(token);
    expect(rejected.status).toBe(400); expect(await rejected.json()).toMatchObject({ code: "PASSWORD_POLICY" });
    await db.membership.update({ where: { id: member.id }, data: { status: "suspended" } });
    expect(await effectivePasswordRules(person.id)).toEqual({ minPassword: 12, passwordReuse: 1 });
    await db.membership.update({ where: { id: member.id }, data: { status: "active" } });
    await db.company.update({ where: { id: foreignTenant }, data: { status: "suspended" } });
    try { expect(await effectivePasswordRules(person.id)).toEqual({ minPassword: 12, passwordReuse: 1 }); }
    finally { await db.company.update({ where: { id: foreignTenant }, data: { status: "active" } }); }
    expect((await reset(token, replacement.repeat(2))).status).toBe(200);
  });
  test("last-ten reuse checks real history and retains exactly nine previous hashes", async () => {
    expect((await configure({ passwordReuse: 10 })).status).toBe(200);
    let current = password, cookie = person.cookie;
    for (let index = 1; index <= 9; index++) {
      await db.rateLimit.deleteMany();
      const next = replacement + index, response = await change(next, current, cookie);
      expect(response.status).toBe(200); cookie = cookieOf(response); current = next;
    }
    const reused = await change(password, current, cookie); expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ code: "PASSWORD_REUSED" });
    await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany();
    const tenth = await change(replacement + "10", current, cookie); expect(tenth.status).toBe(200);
    expect(await db.passwordHistory.count({ where: { userId: person.id } })).toBe(9);
    expect((await change(password, replacement + "10", cookieOf(tenth))).status).toBe(200);
    expect(await db.passwordHistory.count({ where: { userId: person.id } })).toBe(9);
  }, 60000);
  test("direct auth API calls cannot bypass credential policy", async () => {
    await expect(auth.api.changePassword({ headers: req("/").headers, body: { currentPassword: password, newPassword: replacement } })).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(auth.api.resetPassword({ body: { newPassword: replacement, token: await proof() } })).rejects.toMatchObject({ status: "FORBIDDEN" });
    expect(await checkPassword(password)).toBe(true);
    await db.account.deleteMany({ where: { userId: person.id, providerId: "credential" } });
    await expect(auth.api.setPassword({ headers: req("/").headers, body: { newPassword: replacement } })).rejects.toMatchObject({ status: "FORBIDDEN" });
    expect(await db.account.count({ where: { userId: person.id, providerId: "credential" } })).toBe(0);
  });
  test("concurrent change requests with the old session commit only once", async () => {
    const responses = await Promise.all([replacement, replacement + "-other"].map(next => change(next)));
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(responses.filter(response => [400, 401].includes(response.status))).toHaveLength(1);
    expect(await db.passwordHistory.count({ where: { userId: person.id } })).toBe(1);
  });
  test("concurrent reset proofs cannot overwrite a password after the first reset", async () => {
    const first = await proof(), second = await proof();
    const responses = await Promise.all([reset(first), reset(second, replacement + "-other")]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    expect(await db.passwordHistory.count({ where: { userId: person.id } })).toBe(1);
    expect(await db.verification.count({ where: { value: person.id } })).toBe(0);
  });
  test("a session creation database failure rolls back password, history, timestamps, reset proofs and session revocation", async () => {
    const before = await account(), user = await db.user.findUniqueOrThrow({ where: { id: person.id } });
    await proof();
    await db.$executeRawUnsafe('CREATE FUNCTION qa_password_session_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = \''
      + person.id + '\' THEN RAISE EXCEPTION \'QA session creation failure\'; END IF; RETURN NEW; END $$');
    await db.$executeRawUnsafe('CREATE TRIGGER qa_password_session_failure BEFORE INSERT ON "Session" FOR EACH ROW EXECUTE FUNCTION qa_password_session_failure()');
    try {
      const result = await change(); expect(result.status).toBe(500);
      expect((await account()).password === before.password).toBe(true);
      expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).passwordChangedAt!.getTime()).toBe(user.passwordChangedAt!.getTime());
      expect(await db.passwordHistory.count({ where: { userId: person.id } })).toBe(0);
      expect(await db.verification.count({ where: { value: person.id } })).toBe(1);
      expect((await services(req("/services"))).status).toBe(200);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER qa_password_session_failure ON "Session"');
      await db.$executeRawUnsafe('DROP FUNCTION qa_password_session_failure()');
    }
  });
  test("password attempts remain rate limited after transaction rollback", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 10; index++) statuses.push((await change(replacement, "incorrect")).status);
    expect(statuses.slice(0, 3)).toEqual([400, 400, 400]);
    expect(statuses.slice(3)).toEqual(Array(7).fill(429));
    expect((await change()).status).toBe(429); expect(await checkPassword(password)).toBe(true);
    expect(await db.apiRateLimit.findUnique({ where: { key: "password-mutation:" + person.id } })).toMatchObject({ count: 11 });
  });
  test("expiry blocks company APIs and appears in context while recovery and policy status remain accessible", async () => {
    await expire();
    const blocked = await services(req("/services")); expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "PASSWORD_CHANGE_REQUIRED" } });
    expect(await (await context(req("/context"))).json()).toMatchObject({ requirePasswordChange: true });
    expect(await passwordStatus()).toMatchObject({ required: true, expired: true, canDefer: false, deferralMode: "never" });
    expect((await deferNow()).status).toBe(403);
    expect((await change()).status).toBe(200);
    person.cookie = await login(person, replacement);
    expect(await passwordStatus()).toMatchObject({ required: false, expired: false });
    expect((await services(req("/services"))).status).toBe(200);
  });
  test("no rotation and credential-free accounts do not expire, and fresh passwords cannot be deferred", async () => {
    expect((await deferNow()).status).toBe(409);
    await expire(); expect((await configure({ passwordMonths: 0 })).status).toBe(200);
    expect(await passwordStatus()).toMatchObject({ required: false, deadline: null });
    expect((await configure({ passwordMonths: 1 })).status).toBe(200);
    await db.account.deleteMany({ where: { userId: person.id, providerId: "credential" } });
    await db.user.update({ where: { id: person.id }, data: { passwordChangedAt: null } });
    expect(await passwordStatus()).toMatchObject({ required: false, deadline: null });
  });
  test("session deferral is idempotent in one session and the next login must change again", async () => {
    expect((await configure({ passwordDeferral: "session" })).status).toBe(200); await expire();
    const first = await deferNow(); expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ expired: true, required: false });
    expect((await services(req("/services"))).status).toBe(200);
    expect((await deferNow()).status).toBe(200);
    expect(await db.auditEvent.count({ where: { actorId: person.id, action: "password.deferred" } })).toBe(1);
    const nextLogin = await login(person);
    expect(await passwordStatus(nextLogin)).toMatchObject({ required: true, canDefer: true });
    expect(await passwordStatus()).toMatchObject({ required: false });
  });
  test("period deferral survives login until its deadline, policy revision or credential change", async () => {
    expect((await configure({ passwordMonths: 1, passwordDeferral: "period" })).status).toBe(200); await expire();
    const start = new Date(), first = await deferNow(); expect(first.status).toBe(200);
    const saved = await db.passwordDeferral.findUniqueOrThrow({ where: { tenantId_memberId: { tenantId: tenant, memberId: person.memberId } } });
    expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(addPolicyMonths(start, 1).getTime());
    expect(saved.expiresAt.getTime()).toBeLessThanOrEqual(addPolicyMonths(new Date(), 1).getTime());
    person.cookie = await login(person); expect(await passwordStatus()).toMatchObject({ required: false });
    await db.passwordDeferral.update({ where: { id: saved.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await passwordStatus()).toMatchObject({ required: true });
    expect((await deferNow()).status).toBe(200);
    expect((await configure({ passwordReuse: 10 })).status).toBe(200);
    expect(await passwordStatus()).toMatchObject({ required: true });
    expect((await deferNow()).status).toBe(200);
    expect((await change()).status).toBe(200);
    expect(await db.passwordDeferral.count({ where: { userId: person.id } })).toBe(0);
  });
  test("deferral rejects wrong origin, other company, stale policy, idle session and suspended membership", async () => {
    expect((await configure({ passwordDeferral: "session" })).status).toBe(200); await expire();
    const status = await passwordStatus();
    expect((await defer(req("/me/password-policy", "POST", person.cookie, { tenantId: tenant, passwordRevision: status.passwordRevision }, { origin: "https://invalid.example" }))).status).toBe(403);
    expect((await deferNow(person.cookie, { tenantId: foreignTenant })).status).toBe(409);
    expect((await deferNow(person.cookie, { passwordRevision: status.passwordRevision - 1 })).status).toBe(409);
    await db.membership.update({ where: { id: person.memberId }, data: { status: "suspended" } });
    expect((await deferNow()).status).toBe(409);
    await db.membership.update({ where: { id: person.memberId }, data: { status: "active" } });
    await db.session.updateMany({ where: { userId: person.id }, data: { updatedAt: new Date(Date.now() - 31 * 60000) } });
    expect((await defer(req("/me/password-policy", "POST", person.cookie, { tenantId: tenant, passwordRevision: status.passwordRevision }))).status).toBe(401);
    expect(await db.passwordDeferral.count({ where: { userId: person.id } })).toBe(0);
  });
  test("company switching applies each company's expiry while password rules remain account-wide", async () => {
    await db.membership.create({ data: { tenantId: foreignTenant, userId: person.id, role: "viewer" } });
    await db.securityPolicy.update({ where: { tenantId: foreignTenant }, data: { passwordMonths: 0 } });
    await expire(); expect((await services(req("/services"))).status).toBe(403);
    const switched = await switchCompany(req("/context", "POST", person.cookie, { companyId: foreignTenant }));
    expect(switched.status).toBe(200); expect(await switched.json()).toMatchObject({ requirePasswordChange: false });
    expect((await services(req("/services"))).status).toBe(200);
    expect((await switchCompany(req("/context", "POST", person.cookie, { companyId: tenant }))).status).toBe(200);
    expect((await services(req("/services"))).status).toBe(403);
  });
  test("password reset racing a deferral never leaves a valid deferral of the old credential", async () => {
    expect((await configure({ passwordDeferral: "period" })).status).toBe(200); await expire();
    const token = await proof();
    const results = await Promise.all([deferNow(), reset(token)]);
    expect(results[1].status).toBe(200); expect([200, 401, 409]).toContain(results[0].status);
    expect(await db.passwordDeferral.count({ where: { userId: person.id } })).toBe(0);
    person.cookie = await login(person, replacement); expect(await passwordStatus()).toMatchObject({ required: false });
  });
  test("database rejects invalid password policy and cross-company deferral records", async () => {
    await expect(db.securityPolicy.update({ where: { tenantId: tenant }, data: { passwordReuse: 2 } })).rejects.toThrow();
    await expect(db.passwordDeferral.create({ data: { tenantId: foreignTenant, memberId: person.memberId, userId: person.id,
      passwordChangedAt: new Date(), passwordRevision: 1, mode: "period", expiresAt: new Date() } })).rejects.toMatchObject({ code: "P2003" });
  });
});

beforeSecurityCase(grantSecurityTestTrials);
