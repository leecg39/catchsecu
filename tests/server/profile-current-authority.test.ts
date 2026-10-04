import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET, PATCH } from "@/app/api/v1/me/route";
const boundary = vi.hoisted(() => ({ change: "", expireAfterAudit: false }));
vi.mock("@/server/context", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/context")>();
  return { ...actual, requireActor: async (...args: Parameters<typeof actual.requireActor>) => {
    const actor = await actual.requireActor(...args);
    const { db } = await import("@/server/db");
    if (boundary.change === "session") await db.session.delete({ where: { id: actor.session.id } });
    if (boundary.change === "expiry") await db.session.update({ where: { id: actor.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    if (boundary.change === "email") await db.user.update({ where: { id: actor.user.id }, data: { emailVerified: false } });
    return actor;
  } };
});
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (boundary.expireAfterAudit) vi.setSystemTime(Date.now() + 120_000);
  } };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Profile authority tests require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Profile-authority-test!123", email = "profile-authority@example.test";
let userId: string, cookie: string, version: number;
function req(path: string, method = "GET", data?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookie ?? "", ...(data ? { "content-type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  expect((await auth.handler(req("/auth/sign-up/email", "POST", { email, name: "before", password }))).status).toBe(200);
  userId = (await db.user.findUniqueOrThrow({ where: { email } })).id;
});
beforeEach(async () => {
  boundary.change = ""; boundary.expireAfterAudit = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const user = await db.user.update({ where: { id: userId }, data: { emailVerified: true, name: "before" } }); version = user.version;
  const signed = await auth.handler(req("/auth/sign-in/email", "POST", { email, password }));
  expect(signed.status).toBe(200); cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
});
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); });
for (const method of ["GET", "PATCH"] as const) test.each(["session", "expiry", "email"])(`${method} rejects current %s invalidation after initial authentication`, async change => {
  boundary.change = change;
  const audits = await db.auditEvent.count({ where: { actorId: userId, action: "profile.updated" } });
  const result = method === "GET" ? await GET(req("/me")) : await PATCH(req("/me", "PATCH", { version, name: "must not save" }));
  expect(result.status).toBe(401);
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({ name: "before", version });
  expect(await db.auditEvent.count({ where: { actorId: userId, action: "profile.updated" } })).toBe(audits);
});
test("two saves of the same version produce one success and one conflict", async () => {
  const names = [randomUUID(), randomUUID()];
  const responses = await Promise.all(names.map(name => PATCH(req("/me", "PATCH", { version, name }))));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const winner = responses.findIndex(r => r.status === 200);
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({ name: names[winner], version: version + 1 });
});

test("session expiry after audit rolls back profile and audit together", async () => {
  await db.session.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  const audits = await db.auditEvent.count({ where: { actorId: userId, action: "profile.updated" } });
  boundary.expireAfterAudit = true;
  try { expect((await PATCH(req("/me", "PATCH", { version, name: "late change" }))).status).toBe(401); }
  finally { boundary.expireAfterAudit = false; vi.useRealTimers(); }
  expect(await db.user.findUnique({ where: { id: userId } })).toMatchObject({ name: "before", version });
  expect(await db.auditEvent.count({ where: { actorId: userId, action: "profile.updated" } })).toBe(audits);
});
