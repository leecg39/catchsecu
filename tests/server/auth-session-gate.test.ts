import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { GET as context, POST as selectContext } from "@/app/api/v1/context/route";
import { GET as service } from "@/app/api/v1/services/[id]/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Session-gate-password!123";
const companyA = randomUUID(), companyB = randomUUID(), serviceA = randomUUID();
const emailA = "session-a@catchsecu.test", emailB = "session-b@catchsecu.test", emailMulti = "session-multi@catchsecu.test";
let cookieA = "", cookieB = "";
function req(path: string, method = "GET", cookie = "", value?: unknown, requestOrigin = origin) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin: requestOrigin, ...(cookie ? { cookie } : {}), ...(value ? { "content-type": "application/json" } : {}) },
    ...(value ? { body: JSON.stringify(value) } : {}) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function signin(email: string, prior = "") {
  const response = await auth.handler(req("/auth/sign-in/email", "POST", prior, { email, password }));
  expect(response.status).toBe(200);
  return response;
}
async function session(cookie: string) {
  return auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const [id, name] of [[companyA, "세션 회사 A"], [companyB, "세션 회사 B"]])
    await db.company.create({ data: { id, name, publicName: name, policy: { create: {} } } });
  await db.service.create({ data: { id: serviceA, tenantId: companyA, name: "A 전용 서비스", externalName: "A 전용 서비스" } });
  for (const [email, tenantIds] of [[emailA, [companyA]], [emailB, [companyB]], [emailMulti, [companyA, companyB]]] as const) {
    expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { email, name: email.split("@")[0], password }))).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    for (const tenantId of tenantIds) await db.membership.create({ data: { userId: user.id, tenantId, role: "owner" } });
  }
  cookieA = cookies(await signin(emailA)); cookieB = cookies(await signin(emailB));
});
beforeEach(async () => { await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("authentication integration gate", () => {
  test("session cookies are HttpOnly and SameSite, and unsigned or altered cookies are rejected", async () => {
    const response = await signin(emailA);
    const tokenCookie = response.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token="))!;
    expect(tokenCookie.toLowerCase()).toContain("httponly");
    expect(tokenCookie.toLowerCase()).toContain("samesite=lax");
    const valid = await session(cookies(response));
    expect(valid).not.toBeNull();
    expect((await context(req("/context", "GET", "better-auth.session_token=" + valid!.session.token))).status).toBe(401);
    const altered = cookies(response).replace(/session_token=([^;]+)/, (_match, value: string) => "session_token=" + value.slice(0, -1) + (value.endsWith("a") ? "b" : "a"));
    expect((await context(req("/context", "GET", altered))).status).toBe(401);
  });
  test("signing in with a preexisting session creates a new user-bound session instead of fixing its ID", async () => {
    const before = await session(cookieA);
    const response = await signin(emailB, cookieA), after = await session(cookies(response));
    expect(after!.session.id).not.toBe(before!.session.id);
    expect(after!.user.email).toBe(emailB);
    expect((await session(cookieA))!.user.email).toBe(emailA);
  });
  test("company A and B requests remain isolated while running concurrently", async () => {
    const pairs = await Promise.all(Array.from({ length: 8 }, async () => {
      const [a, b, denied] = await Promise.all([context(req("/context", "GET", cookieA)), context(req("/context", "GET", cookieB)), service(req("/services/" + serviceA, "GET", cookieB))]);
      return [(await a.json()).company.id, (await b.json()).company.id, denied.status];
    }));
    for (const pair of pairs) expect(pair).toEqual([companyA, companyB, 404]);
    expect((await selectContext(req("/context", "POST", cookieB, { companyId: companyA }))).status).toBe(404);
    expect((await session(cookieB))!.session.activeCompanyId).toBe(companyB);
  });
  test("company selection is scoped to one session of a user with two memberships", async () => {
    const first = cookies(await signin(emailMulti)), second = cookies(await signin(emailMulti));
    expect((await selectContext(req("/context", "POST", second, { companyId: companyB }))).status).toBe(200);
    expect((await session(first))!.session.activeCompanyId).toBe(companyA);
    expect((await session(second))!.session.activeCompanyId).toBe(companyB);
    expect((await service(req("/services/" + serviceA, "GET", second))).status).toBe(404);
    expect((await service(req("/services/" + serviceA, "GET", first))).status).toBe(200);
  });
  test("cross-origin authentication and company changes cannot mutate a valid session", async () => {
    const current = await session(cookieA);
    expect((await auth.handler(req("/auth/sign-out", "POST", cookieA, {}, "https://evil.example"))).status).toBe(403);
    expect((await selectContext(req("/context", "POST", cookieA, { companyId: companyB }, "https://evil.example"))).status).toBe(403);
    expect((await session(cookieA))!.session.id).toBe(current!.session.id);
  });
  test("GET sign-out does not mutate a session; POST sign-out prevents replay and leaves another device active", async () => {
    const first = cookies(await signin(emailB)), second = cookies(await signin(emailB));
    expect((await auth.handler(req("/auth/sign-out", "GET", first))).status).toBeGreaterThanOrEqual(400);
    expect((await context(req("/context", "GET", first))).status).toBe(200);
    expect((await auth.handler(req("/auth/sign-out", "POST", first, {}))).status).toBe(200);
    expect((await context(req("/context", "GET", first))).status).toBe(401);
    expect((await context(req("/context", "GET", second))).status).toBe(200);
  });
  test("an expired database session cannot be revived by its valid signed cookie", async () => {
    const cookie = cookies(await signin(emailA)), current = await session(cookie);
    await db.session.update({ where: { id: current!.session.id }, data: { expiresAt: new Date(Date.now() - 60000) } });
    expect((await context(req("/context", "GET", cookie))).status).toBe(401);
    expect(await session(cookie)).toBeNull();
  });
});
