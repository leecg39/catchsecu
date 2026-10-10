import { beforeEach as beforeSecurityCase } from "vitest";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { readPolicy } from "@/server/security-policy";
import { signClientIp } from "@/server/client-ip";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated local test DB required");
const tenantId = randomUUID(), origin = new URL(env.BETTER_AUTH_URL).origin, key = randomBytes(32).toString("hex"), priorKey = process.env.APP_IP_SIGNING_KEY;
const password = "Security-current-authority!123", email = "security-current-owner@example.test";
let userId: string, memberId: string, ctx: Context;
function req(path: string, body: unknown) { return new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeAll(async () => {
  process.env.APP_IP_SIGNING_KEY = key;
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.create({ data: { id: tenantId, name: "현재 보안 권한", publicName: "현재 권한", policy: { create: { passwordMonths: 0 } } } });
  for (const address of [email, "security-other-owner@example.test"]) {
    expect((await auth.handler(req("sign-up/email", { email: address, password, name: "owner" }))).status).toBe(200);
    const user = await db.user.update({ where: { email: address }, data: { emailVerified: true } });
    const member = await db.membership.create({ data: { tenantId, userId: user.id, role: "owner" } });
    if (address === email) { userId = user.id; memberId = member.id; }
  }
});
beforeEach(async () => {
  await db.securityPolicy.update({ where: { tenantId }, data: { requireMfa: false } });
  const ip = await db.ipAccessPolicy.findUnique({ where: { tenantId } });
  if (ip) await db.ipAccessPolicy.update({ where: { tenantId }, data: { enabled: false, version: { increment: 1 } } });
  await db.user.update({ where: { id: userId }, data: { emailVerified: true } });
  await db.membership.update({ where: { id: memberId }, data: { role: "owner", status: "active" } });
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const signed = await auth.handler(req("sign-in/email", { email, password })); expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie, "x-catchsecu-client-ip": "192.0.2.1", "x-catchsecu-ip-proof": signClientIp("192.0.2.1", key) }), "security.read");
});
afterAll(async () => { if (priorKey === undefined) delete process.env.APP_IP_SIGNING_KEY; else process.env.APP_IP_SIGNING_KEY = priorKey; await db.$disconnect(); });

test("active owner reads the persisted policy", async () => { expect(await readPolicy(ctx)).toMatchObject({ tenantId, canManage: true }); });
test("a stale owner context reports the current administrator role", async () => {
  await db.membership.update({ where: { id: memberId }, data: { role: "admin" } });
  expect(await readPolicy(ctx)).toMatchObject({ canManage: false });
});
test.each(["viewer", "revoked", "session", "expiry", "email", "mfa", "ip"])("read rejects current %s invalidation after initial context resolution", async change => {
  if (change === "viewer") await db.membership.update({ where: { id: memberId }, data: { role: "viewer" } });
  if (change === "revoked") await db.membership.update({ where: { id: memberId }, data: { status: "revoked" } });
  if (change === "session") await db.session.delete({ where: { id: ctx.session.id } });
  if (change === "expiry") await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  if (change === "email") await db.user.update({ where: { id: userId }, data: { emailVerified: false } });
  if (change === "mfa") await db.securityPolicy.update({ where: { tenantId }, data: { requireMfa: true } });
  if (change === "ip") {
    await db.ipRule.create({ data: { tenantId, cidr: "198.51.100.0/24", enabled: true } });
    await db.ipAccessPolicy.create({ data: { tenantId, enabled: true } });
  }
  const code = change === "viewer" || change === "revoked" ? "FORBIDDEN" : change === "email" ? "ACCOUNT_UNAVAILABLE" : change === "mfa" ? "MFA_REQUIRED" : change === "ip" ? "IP_NOT_ALLOWED" : "SESSION_EXPIRED";
  await expect(readPolicy(ctx)).rejects.toMatchObject({ code });
});

beforeSecurityCase(grantSecurityTestTrials);
