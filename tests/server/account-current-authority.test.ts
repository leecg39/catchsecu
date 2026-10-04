import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireActor } from "@/server/context";
import { closeAccount } from "@/server/account-closure";
import { GET as sessions } from "@/app/api/v1/me/sessions/route";
import { DELETE as revoke } from "@/app/api/v1/me/sessions/[id]/route";
import { GET as activity } from "@/app/api/v1/me/audit-events/route";
import { GET as exportActivity } from "@/app/api/v1/me/audit-events/export/route";
import { GET as closureStatus } from "@/app/api/v1/me/closure/route";
const boundary = vi.hoisted(() => ({ revokeActor: false }));
vi.mock("@/server/context", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/context")>();
  return { ...actual, requireActor: async (...args: Parameters<typeof actual.requireActor>) => {
    const actor = await actual.requireActor(...args);
    if (boundary.revokeActor) {
      const { db } = await import("@/server/db");
      await db.session.deleteMany({ where: { id: actor.session.id } });
    }
    return actor;
  } };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated local test DB is allowed.");
const origin = env.BETTER_AUTH_URL, password = "Account-authority-test!123";
let userId: string, email: string, cookie: string, otherCookie: string, otherSessionId: string;
function req(path: string, method = "GET", data?: unknown, credential = cookie ?? "") {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: credential, ...(data ? { "content-type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
async function signIn() {
  const response = await auth.handler(req("/auth/sign-in/email", "POST", { email, password }));
  expect(response.status).toBe(200); return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
beforeAll(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
beforeEach(async () => {
  boundary.revokeActor = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  email = randomUUID() + "@account-authority.example.test";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", { email, name: "권한 검사", password }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  cookie = await signIn(); otherCookie = await signIn();
  otherSessionId = (await requireActor(req("/context", "GET", undefined, otherCookie).headers)).session.id;
});
afterEach(() => { boundary.revokeActor = false; vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(async () => { await db.$disconnect(); });
const actions = {
  sessions: () => sessions(req("/me/sessions")),
  revoke: () => revoke(req("/me/sessions/" + otherSessionId, "DELETE")),
  activity: () => activity(req("/me/audit-events")),
  export: () => exportActivity(req("/me/audit-events/export")),
  closureStatus: () => closureStatus(req("/me/closure")),
};
test.each(Object.keys(actions) as (keyof typeof actions)[])("%s rejects a session revoked after request authentication", async action => {
  const auditCount = await db.auditEvent.count({ where: { actorId: userId } });
  boundary.revokeActor = true;
  expect((await actions[action]()).status).toBe(401);
  expect(await db.session.findUnique({ where: { id: otherSessionId } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { actorId: userId } })).toBe(auditCount);
});
test("account closure rolls back when the session expires during password verification", async () => {
  const actor = await requireActor(req("/context").headers);
  await db.session.update({ where: { id: actor.session.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
  const ctx = await auth.$context, original = ctx.password.verify;
  vi.spyOn(ctx.password, "verify").mockImplementation(async input => { const valid = await original(input); vi.setSystemTime(Date.now() + 120000); return valid; });
  const auditCount = await db.auditEvent.count({ where: { actorId: userId } });
  await expect(closeAccount(actor, { version: actor.user.version, confirmation: email, password }, randomUUID())).rejects.toMatchObject({ status: 401 });
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({ status: "active", version: actor.user.version });
  expect(await db.accountClosure.count({ where: { userId } })).toBe(0);
  expect(await db.account.count({ where: { userId, providerId: "credential" } })).toBe(1);
  expect(await db.session.findUnique({ where: { id: actor.session.id } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { actorId: userId } })).toBe(auditCount);
});
test("mutually revoking sessions serialize without revoking both or deadlocking", async () => {
  const first = await requireActor(req("/context").headers);
  const responses = await Promise.all([
    revoke(req("/me/sessions/" + otherSessionId, "DELETE")),
    revoke(req("/me/sessions/" + first.session.id, "DELETE", undefined, otherCookie)),
  ]);
  expect(responses.map(r => r.status).sort()).toEqual([204, 401]);
  expect(await db.session.count({ where: { id: { in: [first.session.id, otherSessionId] } } })).toBe(1);
});
test("own activity clamps an empty last page and exposes no other actor or resource identifiers", async () => {
  await db.auditEvent.create({ data: { actorId: userId, requestId: randomUUID(), action: "profile.updated", resource: "user", resourceId: userId, detail: {} } });
  const response = await activity(req("/me/audit-events?page=100&pageSize=10&search=profile.updated"));
  expect(response.status).toBe(200);
  const body = await response.json(); expect(body.page).toBe(1); expect(body.total).toBe(1);
  expect(body.items[0]).toMatchObject({ resourceId: null, serviceId: null, serviceName: null, actorName: "권한 검사" });
});
