import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";

const fault = vi.hoisted(() => ({ action: "", expire: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (fault.action && args[3] === fault.action) {
      if (fault.expire) vi.setSystemTime(Date.now() + 120000);
      else throw new Error("synthetic auth audit failure");
    }
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const password = "Auth-mutation!123456";
let userId: string, email: string, companyId: string, cookie: string, sessionId: string, otherId: string;
const cookies = (r: Response) => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
function req(path: string, input: unknown = {}, credential = cookie, requestOrigin = origin) {
  return new Request(origin + "/api/v1/auth" + path, { method: "POST", headers: { origin: requestOrigin, cookie: credential ?? "", "content-type": "application/json" }, body: JSON.stringify(input) });
}
async function login() {
  const r = await auth.handler(req("/sign-in/email", { email, password }, "")); expect(r.status).toBe(200);
  const c = cookies(r); const s = await auth.api.getSession({ headers: new Headers({ cookie: c }), query: { disableRefresh: true } });
  return { cookie: c, id: s!.session.id };
}
async function setup() {
  const response = await auth.handler(req("/two-factor/enable", { password })); expect(response.status).toBe(200);
  const data = await response.json(), secret = new TextDecoder().decode(base32.decode(new URL(data.totpURI).searchParams.get("secret")!));
  return { code: await createOTP(secret, { digits: 6, period: 30 }).totp(), backup: data.backupCodes[0] as string };
}
async function enroll() {
  const prepared = await setup(); const r = await auth.handler(req("/two-factor/verify-totp", { code: prepared.code })); expect(r.status).toBe(200);
  cookie = cookies(r); sessionId = (await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } }))!.session.id;
  return prepared;
}
async function snapshot() {
  return {
    user: await db.user.findUnique({ where: { id: userId }, select: { id: true, twoFactorEnabled: true } }),
    factors: await db.twoFactor.findMany({ where: { userId }, orderBy: { id: "asc" }, select: { id: true, secret: true, backupCodes: true, verified: true } }),
    sessions: await db.session.findMany({ where: { userId }, orderBy: { id: "asc" }, select: { id: true, activeCompanyId: true } }),
  };
}
beforeAll(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
beforeEach(async () => {
  fault.action = ""; fault.expire = false; vi.useRealTimers(); await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  email = randomUUID() + "@auth-mutation.example.test";
  expect((await auth.handler(req("/sign-up/email", { email, password, name: "인증 감사" }, ""))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  companyId = (await db.company.create({ data: { name: "인증 감사 회사", publicName: "합성", policy: { create: {} }, memberships: { create: { userId, role: "owner" } } } })).id;
  const first = await login(), second = await login(); cookie = first.cookie; sessionId = first.id; otherId = second.id;
});
afterEach(() => { fault.action = ""; fault.expire = false; vi.useRealTimers(); });
afterAll(async () => { await db.$disconnect(); });

test("logout commits the deleted session and one request-linked safe event, leaving another device active", async () => {
  const r = await auth.handler(req("/sign-out")); expect(r.status).toBe(200);
  expect(await db.session.findUnique({ where: { id: sessionId } })).toBeNull();
  expect(await db.session.findUnique({ where: { id: otherId } })).not.toBeNull();
  const events = await db.auditEvent.findMany({ where: { action: "session.ended", resourceId: sessionId } });
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ tenantId: companyId, actorId: userId, requestId: r.headers.get("x-request-id") });
  expect(events[0].detail).toEqual({ changedFields: [] });
});
test("logout cannot swallow audit failure or clear its cookie when deletion rolls back", async () => {
  fault.action = "session.ended"; const r = await auth.handler(req("/sign-out")); fault.action = "";
  expect(r.status).toBe(500); expect(r.headers.getSetCookie()).toHaveLength(0);
  expect(await db.session.findUnique({ where: { id: sessionId } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "session.ended", resourceId: sessionId } })).toBe(0);
  expect(await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } })).not.toBeNull();
});
test("replayed logout has no second deletion event", async () => {
  expect((await auth.handler(req("/sign-out"))).status).toBe(200);
  expect((await auth.handler(req("/sign-out"))).status).toBe(200);
  expect(await db.auditEvent.count({ where: { action: "session.ended", resourceId: sessionId } })).toBe(1);
});
test("idle expiry persists exactly one session-ended event with the revocation", async () => {
  await db.securityPolicy.update({ where: { tenantId: companyId }, data: { sessionMinutes: 5 } });
  await db.session.update({ where: { id: sessionId }, data: { updatedAt: new Date(Date.now() - 360000) } });
  const r = await auth.handler(new Request(origin + "/api/v1/auth/get-session", { headers: { cookie } }));
  expect(r.status).toBe(401); expect(await db.session.findUnique({ where: { id: sessionId } })).toBeNull();
  expect(await db.auditEvent.count({ where: { action: "session.ended", resourceId: sessionId, actorId: userId, tenantId: companyId } })).toBe(1);
});
test("idle expiry audit failure leaves the expired session intact and cannot authorize it", async () => {
  await db.securityPolicy.update({ where: { tenantId: companyId }, data: { sessionMinutes: 5 } });
  await db.session.update({ where: { id: sessionId }, data: { updatedAt: new Date(Date.now() - 360000) } });
  fault.action = "session.ended";
  const r = await auth.handler(new Request(origin + "/api/v1/auth/get-session", { headers: { cookie } })); fault.action = "";
  expect(r.status).toBe(500); expect(await db.session.findUnique({ where: { id: sessionId } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "session.ended", resourceId: sessionId } })).toBe(0);
  expect((await auth.handler(req("/two-factor/enable", { password }))).status).toBe(401);
  expect(await db.twoFactor.count({ where: { userId } })).toBe(0);
});
test("cross-origin logout cannot delete a session or create a success audit", async () => {
  const r = await auth.handler(req("/sign-out", {}, cookie, "https://untrusted.example")); expect(r.status).toBe(403);
  expect(await db.session.findUnique({ where: { id: sessionId } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { requestId: r.headers.get("x-request-id")! } })).toBe(0);
});
test("direct internal factor enablement cannot bypass the guarded request", async () => {
  const before = await snapshot();
  await expect((await auth.$context).internalAdapter.updateUser(userId, { twoFactorEnabled: true })).rejects.toMatchObject({ statusCode: 403 });
  expect(await snapshot()).toEqual(before);
});
test("factor setup audit failure rolls back secret and backup-code creation", async () => {
  fault.action = "auth.factor_setup"; const r = await auth.handler(req("/two-factor/enable", { password })); fault.action = "";
  expect(r.status).toBe(500); expect(r.headers.getSetCookie()).toHaveLength(0);
  expect(await db.twoFactor.count({ where: { userId } })).toBe(0);
  expect(await db.session.count({ where: { userId } })).toBe(2);
});
test.each(["auth.mfa_enabled", "auth.factor_verified"])("%s failure rolls back enrollment, factor confirmation, revocations and session rotation", async action => {
  const prepared = await setup(), before = await snapshot();
  fault.action = action; const r = await auth.handler(req("/two-factor/verify-totp", { code: prepared.code })); fault.action = "";
  expect(r.status).toBe(500); expect(r.headers.getSetCookie()).toHaveLength(0); expect(await snapshot()).toEqual(before);
  expect(await db.auditEvent.count({ where: { requestId: r.headers.get("x-request-id")! } })).toBe(0);
});
test("successful factor confirmation rotates the session, revokes the other device and audits only safe metadata", async () => {
  const prepared = await setup(), r = await auth.handler(req("/two-factor/verify-totp", { code: prepared.code })); expect(r.status).toBe(200);
  expect(await db.session.count({ where: { userId } })).toBe(1);
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({ twoFactorEnabled: true });
  expect(await db.twoFactor.findFirst({ where: { userId } })).toMatchObject({ verified: true });
  const events = await db.auditEvent.findMany({ where: { requestId: r.headers.get("x-request-id")! } });
  expect(events.map(e => e.action)).toEqual(expect.arrayContaining(["auth.mfa_enabled", "auth.factor_verified", "auth.sessions_revoked_for_mfa", "session.created", "session.ended"]));
  const meta = JSON.stringify(events.map(e => e.detail)); expect(meta).not.toContain(password); expect(meta).not.toContain(prepared.backup); expect(meta).not.toContain(prepared.code);
});
test("disable audit failure preserves enrollment, factor secrets and the current session", async () => {
  await enroll(); const before = await snapshot(); fault.action = "auth.factor_disabled";
  const r = await auth.handler(req("/two-factor/disable", { password })); fault.action = "";
  expect(r.status).toBe(500); expect(r.headers.getSetCookie()).toHaveLength(0); expect(await snapshot()).toEqual(before);
});
test("successful disable deletes the factor and replaces the current session with request-linked audit", async () => {
  await enroll(); const old = sessionId, r = await auth.handler(req("/two-factor/disable", { password })); expect(r.status).toBe(200);
  expect(await db.twoFactor.count({ where: { userId } })).toBe(0); expect(await db.session.count({ where: { userId } })).toBe(1);
  expect(await db.session.findUnique({ where: { id: old } })).toBeNull();
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({ twoFactorEnabled: false });
  expect(await db.auditEvent.count({ where: { requestId: r.headers.get("x-request-id")!, action: "auth.mfa_disabled" } })).toBe(1);
});
test("wrong factor codes retain challenge/account attempt counters on a 401 response", async () => {
  const prepared = await enroll(); const pending = await auth.handler(req("/sign-in/email", { email, password }, "")); expect(pending.status).toBe(200);
  const wrong = prepared.code.slice(0, -1) + (prepared.code.endsWith("0") ? "1" : "0");
  const r = await auth.handler(req("/two-factor/verify-totp", { code: wrong }, cookies(pending))); expect(r.status).toBe(401);
  expect(await db.twoFactor.findFirst({ where: { userId } })).toMatchObject({ failedVerificationCount: 1 });
  expect(await db.auditEvent.count({ where: { requestId: r.headers.get("x-request-id")!, action: "auth.factor_rejected", actorId: userId } })).toBe(1);
});
test("backup-code audit failure restores the consumed code/challenge, and the same proof can then succeed", async () => {
  const prepared = await enroll(), before = await snapshot();
  const pending = await auth.handler(req("/sign-in/email", { email, password }, "")); expect(pending.status).toBe(200); const challenge = cookies(pending);
  const factor = await db.twoFactor.findFirstOrThrow({ where: { userId } });
  fault.action = "auth.backup_code_verified"; const failed = await auth.handler(req("/two-factor/verify-backup-code", { code: prepared.backup }, challenge)); fault.action = "";
  expect(failed.status).toBe(500); expect(failed.headers.getSetCookie()).toHaveLength(0);
  expect((await db.twoFactor.findUniqueOrThrow({ where: { id: factor.id } })).backupCodes).toBe(factor.backupCodes);
  expect((await snapshot()).sessions).toEqual(before.sessions);
  expect((await auth.handler(req("/two-factor/verify-backup-code", { code: prepared.backup }, challenge))).status).toBe(200);
});
test("a session deadline crossed after the final MFA audit rolls back the whole confirmation", async () => {
  const prepared = await setup(); await db.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() + 60000) } });
  const before = await snapshot(); fault.action = "auth.factor_verified"; fault.expire = true;
  const r = await auth.handler(req("/two-factor/verify-totp", { code: prepared.code })); fault.action = ""; fault.expire = false; vi.useRealTimers();
  expect(r.status).toBe(401); expect(r.headers.getSetCookie()).toHaveLength(0); expect(await snapshot()).toEqual(before);
  expect(await db.auditEvent.count({ where: { requestId: r.headers.get("x-request-id")! } })).toBe(0);
});
test("concurrent confirmation of one session succeeds once and serializes without orphan sessions", async () => {
  const prepared = await setup(); const responses = await Promise.all([auth.handler(req("/two-factor/verify-totp", { code: prepared.code })), auth.handler(req("/two-factor/verify-totp", { code: prepared.code }))]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 401]); expect(await db.session.count({ where: { userId } })).toBe(1);
});
test("bulk revocation audits all sessions beyond the adapter's default page and explicit page boundary", async () => {
  await db.session.createMany({ data: Array.from({ length: 1002 }, () => ({ id: randomUUID(), userId, token: randomUUID(), expiresAt: new Date(Date.now() + 60000), updatedAt: new Date(), activeCompanyId: companyId })) });
  const ids = (await db.session.findMany({ where: { userId }, select: { id: true } })).map(r => r.id);
  await (await auth.$context).internalAdapter.deleteUserSessions(userId);
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "session.ended", resourceId: { in: ids } } })).toBe(ids.length);
});
test("bulk revocation includes a login committed while it waits for the account lock", async () => {
  let entered!: () => void, release!: () => void;
  const locked = new Promise<void>(resolve => { entered = resolve; }), unlocked = new Promise<void>(resolve => { release = resolve; });
  const lateId = randomUUID();
  const hold = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    entered(); await unlocked;
    await tx.session.create({ data: { id: lateId, userId, token: randomUUID(), expiresAt: new Date(Date.now() + 60000), updatedAt: new Date(), activeCompanyId: companyId } });
  }, { timeout: 10000 });
  await locked;
  const revoke = (await auth.$context).internalAdapter.deleteUserSessions(userId);
  try {
    const start = Date.now(); let waiting = false;
    while (!waiting && Date.now() - start < 5000) {
      waiting = (await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%User%') AS waiting`)[0].waiting;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally { release(); await hold; await revoke; }
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "session.ended", resourceId: { in: [sessionId, otherId, lateId] } } })).toBe(3);
});
test("rate limits survive failed login audit transactions", async () => {
  await db.rateLimit.deleteMany(); fault.action = "session.created";
  const statuses: number[] = [];
  for (let i = 0; i < 9; i++) statuses.push((await auth.handler(req("/sign-in/email", { email, password }, ""))).status);
  fault.action = ""; expect(statuses.at(-1)).toBe(429); expect(statuses).toContain(500);
  expect(await db.session.count({ where: { userId } })).toBe(2);
});
