import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import * as transport from "@/server/sso-transport";
import { GET as start } from "@/app/api/v1/auth/sso/[providerId]/route";
import { GET as callback } from "@/app/api/v1/auth/sso/callback/route";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await db.$disconnect(); });
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const base = "https://login.microsoftonline.com/01234567-89ab-cdef-0123-456789abcdef";

// Controlled transport and synthetic RSA signatures. This is NOT a live Google/Microsoft acceptance test.
test.each(["GOOGLE", "AZURE"] as const)("%s 공식 endpoint 형태에서 실제 서명 검증 성공 후에만 해당 근거를 저장한다", async identity => {
  const tenant = await db.company.create({ data: { name: "서명 시험", publicName: "서명" } });
  const user = await db.user.create({ data: { name: "연결 사용자", email: randomUUID() + "@proof.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "owner" } });
  const provider = await db.ssoProvider.create({ data: { tenantId: tenant.id, name: "표시 이름은 무관", protocol: "oidc", clientId: "synthetic-proof-client",
    issuer: identity === "GOOGLE" ? "https://accounts.google.com" : base + "/v2.0",
    authorizationUrl: identity === "GOOGLE" ? "https://accounts.google.com/o/oauth2/v2/auth" : base + "/oauth2/v2.0/authorize",
    tokenUrl: identity === "GOOGLE" ? "https://oauth2.googleapis.com/token" : base + "/oauth2/v2.0/token",
    jwksUrl: identity === "GOOGLE" ? "https://www.googleapis.com/oauth2/v3/certs" : base + "/discovery/v2.0/keys",
    enabled: true, preflightOk: true } });
  const account = await db.account.create({ data: { userId: user.id, providerId: "sso:" + provider.id, accountId: provider.issuer + "|subject" } });
  let idToken = "", last = "";
  vi.spyOn(transport, "requestSsoJson").mockImplementation(async (input: string) => {
    if (input === provider.tokenUrl) return { status: 200, ok: true, body: { id_token: idToken } };
    if (input === provider.jwksUrl) return { status: 200, ok: true, body: { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "test-rsa", use: "sig" }] } };
    throw new Error("Unexpected transport endpoint");
  });
  for (const outcome of ["bad-signature", "changed-policy", "valid"]) {
    await db.ssoLoginPolicy.upsert({ where: { tenantId: tenant.id }, create: { tenantId: tenant.id, mode: identity }, update: { mode: identity } });
    const initiated = await start(new Request(origin + `/api/v1/auth/sso/${provider.id}?mode=login`));
    expect(initiated.status).toBe(302);
    const cookie = initiated.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const target = new URL(initiated.headers.get("location")!);
    const payload = { iss: provider.issuer, sub: "subject", aud: provider.clientId, nonce: target.searchParams.get("nonce"),
      exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), email: user.email, email_verified: true };
    const unsigned = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-rsa" })).toString("base64url") + "." + Buffer.from(JSON.stringify(payload)).toString("base64url");
    idToken = unsigned + "." + sign("sha256", Buffer.from(unsigned), outcome === "bad-signature" ? other.privateKey : keys.privateKey).toString("base64url");
    if (outcome === "changed-policy") await db.ssoLoginPolicy.update({ where: { tenantId: tenant.id }, data: { mode: identity === "GOOGLE" ? "AZURE" : "GOOGLE" } });
    const result = await callback(new Request(origin + "/api/v1/auth/sso/callback?" + new URLSearchParams({ state: target.searchParams.get("state")!, code: "controlled-code" }), { headers: { cookie } }));
    if (outcome !== "valid") {
      expect(result.status).toBe(outcome === "bad-signature" ? 401 : 403);
      expect(await db.ssoSessionProof.count()).toBe(0);
      expect(await db.session.count()).toBe(0);
    } else {
      expect(result.status).toBe(302);
      const session = await db.session.findFirstOrThrow({ where: { userId: user.id } }); last = session.id;
      expect(await db.ssoSessionProof.findUnique({ where: { sessionId: session.id } })).toMatchObject({ userId: user.id,
        tenantId: tenant.id, providerId: provider.id, accountId: account.id, identityProvider: identity });
    }
  }
  expect(last).not.toBe("");
  expect(await db.auditEvent.count({ where: { action: "sso.login", actorId: user.id } })).toBe(1);
});
