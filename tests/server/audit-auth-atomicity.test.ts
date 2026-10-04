import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";

const fault = vi.hoisted(() => ({ fail: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (fault.fail && args[3] === "session.created") throw new Error("synthetic session audit failure");
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const email = "audit-login@example.test", password = "Audit-login!123456";
let userId: string, tenantId: string;
function req(passwordValue = password) {
  return new Request(origin + "/api/v1/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password: passwordValue }) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  const signup = new Request(origin + "/api/v1/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password, name: "원자 로그인" }) });
  expect((await auth.handler(signup)).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  tenantId = (await db.company.create({ data: { name: "원자 감사 회사", publicName: "합성", memberships: { create: { userId, role: "owner" } } } })).id;
});
beforeEach(async () => { fault.fail = false; await db.rateLimit.deleteMany(); });
afterAll(async () => { fault.fail = false; await db.$disconnect(); });
test("ordinary password login creates exactly one user/company-bound audit with the session", async () => {
  const response = await auth.handler(req()); expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } });
  const rows = await db.auditEvent.findMany({ where: { action: "session.created", resourceId: session!.session.id } });
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ tenantId, actorId: userId, resource: "session" });
  expect(JSON.stringify(rows[0].detail)).not.toContain(password);
  expect(JSON.stringify(rows[0].detail)).not.toContain(session!.session.token);
});
test("audit failure after insertion rolls back the new login session and withholds its cookie", async () => {
  const sessions = await db.session.count({ where: { userId } });
  const events = await db.auditEvent.count({ where: { actorId: userId, action: "session.created" } });
  fault.fail = true; const response = await auth.handler(req()); fault.fail = false;
  expect(response.status).toBe(500);
  expect(response.headers.getSetCookie().some(c => c.startsWith("better-auth.session_token="))).toBe(false);
  expect(await db.session.count({ where: { userId } })).toBe(sessions);
  expect(await db.auditEvent.count({ where: { actorId: userId, action: "session.created" } })).toBe(events);
});
test("wrong passwords create neither a login session nor a successful login audit", async () => {
  const sessions = await db.session.count({ where: { userId } });
  const events = await db.auditEvent.count({ where: { actorId: userId, action: "session.created" } });
  expect((await auth.handler(req(randomUUID()))).status).toBe(401);
  expect(await db.session.count({ where: { userId } })).toBe(sessions);
  expect(await db.auditEvent.count({ where: { actorId: userId, action: "session.created" } })).toBe(events);
});
