import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";
import { authPath, safeReturnTo } from "@/lib/return-to";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only the isolated test DB is allowed.");
const origin = new URL(env.BETTER_AUTH_URL).origin;
const email = "navigation@catchsecu.test", password = "Navigation-test-password!123";
function request(path: string, body?: unknown) {
  return new Request(origin + "/api/v1/auth" + path, { method: body ? "POST" : "GET",
    headers: { origin, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function latestMail(subject: string) {
  const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
  const mail = jobs.map(row => decrypt<{ to: string; subject: string; text: string }>(row.payloadCipher)).find(row => row.to === email && row.subject === subject);
  expect(mail).toBeDefined();
  return mail!.text.match(/https?:\/\/\S+/)![0];
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  expect((await auth.handler(request("/sign-up/email", { name: "인증 화면 시험", email, password, callbackURL: authPath("/login", "/form/list?status=all") }))).status).toBe(200);
  await db.user.update({ where: { email }, data: { emailVerified: true } });
});
beforeEach(async () => { await db.rateLimit.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("authentication callbacks", () => {
  test.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/%252f%252fevil.example", "/%5cevil.example", "/%255cevil.example", "/%00dashboard", "/%7fdashboard"])("rejects unsafe callback %s before issuing a reset mail", async callback => {
    const before = await db.job.count({ where: { type: "mail" } });
    const response = await auth.handler(request("/request-password-reset", { email, redirectTo: callback }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.job.count({ where: { type: "mail" } })).toBe(before);
    expect(safeReturnTo(callback)).toBe("/dashboard");
  });
  test("preserves the intended page through the mailed reset callback", async () => {
    const target = "/form/list?status=all";
    const callback = authPath("/passwordChange", target);
    expect((await auth.handler(request("/request-password-reset", { email, redirectTo: callback }))).status).toBe(200);
    const response = await auth.handler(new Request(await latestMail("비밀번호 재설정")));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!, origin);
    expect(location.origin).toBe(origin);
    expect(location.pathname).toBe("/passwordChange");
    expect(location.searchParams.get("returnTo")).toBe(target);
    expect(location.searchParams.get("token")).toBeTruthy();
  });
  test("expired reset callbacks retain returnTo and expose an error without a usable token", async () => {
    const target = "/my-page/info";
    expect((await auth.handler(request("/request-password-reset", { email, redirectTo: authPath("/passwordChange", target) }))).status).toBe(200);
    const link = await latestMail("비밀번호 재설정");
    await db.verification.updateMany({ data: { expiresAt: new Date(Date.now() - 60000) } });
    const response = await auth.handler(new Request(link));
    const location = new URL(response.headers.get("location")!, origin);
    expect(location.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(location.searchParams.get("returnTo")).toBe(target);
    expect(location.searchParams.has("token")).toBe(false);
  });
  test("invalid email verification redirects to an explicit login error", async () => {
    const query = new URLSearchParams({ token: "invalid", callbackURL: authPath("/login", "/form/list") });
    const response = await auth.handler(request("/verify-email?" + query));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!, origin);
    expect(location.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(location.searchParams.get("returnTo")).toBe("/form/list");
  });
  test("accepts an absolute callback only on this app's origin", async () => {
    expect((await auth.handler(request("/request-password-reset", { email, redirectTo: origin + "/passwordChange" }))).status).toBe(200);
    const userInfo = new URL("/passwordChange", origin); userInfo.username = "user"; userInfo.password = "password";
    expect((await auth.handler(request("/request-password-reset", { email, redirectTo: userInfo.href }))).status).toBeGreaterThanOrEqual(400);
    const foreign = new URL("/passwordChange", origin); foreign.hostname += ".evil.example";
    expect((await auth.handler(request("/request-password-reset", { email, redirectTo: foreign.href }))).status).toBeGreaterThanOrEqual(400);
  });
});
