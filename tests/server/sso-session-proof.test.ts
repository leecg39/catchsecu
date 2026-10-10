import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { recordSsoSessionProof, currentSsoSessionProof } from "@/server/sso-session-proof";
import { securityCapabilities, planCapabilities } from "@/contracts/feature-entitlements";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

// Synthetic database identity for relational tests, not a real external login.
async function fixture() {
  const user = await db.user.create({ data: { email: randomUUID() + "@proof.test", name: "근거 시험", emailVerified: true } });
  const company = await db.company.create({ data: { name: "인증 근거", publicName: "근거", memberships: { create: { userId: user.id, role: "owner" } } } });
  const provider = await db.ssoProvider.create({ data: { tenantId: company.id, protocol: "oidc", name: "표시 이름 Google",
    issuer: "https://independent.test", clientId: "test", authorizationUrl: "https://independent.test/authorize",
    tokenUrl: "https://independent.test/token", jwksUrl: "https://independent.test/jwks", enabled: true, preflightOk: true } });
  const account = await db.account.create({ data: { userId: user.id, providerId: "sso:" + provider.id, accountId: "https://independent.test|subject" } });
  const session = await db.session.create({ data: { userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000), activeCompanyId: company.id } });
  const data = { sessionId: session.id, userId: user.id, tenantId: company.id, providerId: provider.id, accountId: account.id,
    identityProvider: "OTHER", authenticatedAt: new Date(Date.now() - 600000) };
  return { user, company, provider, account, session, data };
}
test("출처 없는 과거 세션이나 연결 계정 존재만으로 인증 근거를 만들지 않는다", async () => {
  const f = await fixture();
  expect(await currentSsoSessionProof(db, f.session.id, f.user.id)).toBeNull();
  expect(await db.ssoSessionProof.count()).toBe(0);
});
test("모든 관계가 맞으면 저장하고 표시 이름으로 Google 권한을 부여하지 않는다", async () => {
  const f = await fixture();
  const proof = await recordSsoSessionProof(db, f.session.id, f.user.id, f.provider, f.account.id, f.data.authenticatedAt);
  expect(proof).toMatchObject(f.data);
  expect((await currentSsoSessionProof(db, f.session.id, f.user.id))?.identityProvider).toBe("OTHER");
  expect(await currentSsoSessionProof(db, f.session.id, randomUUID())).toBeNull();
});
test.each(["user", "tenant", "provider", "account", "credential"])("%s 바꿔치기는 실제 복합 FK가 거부한다", async kind => {
  const f = await fixture(), other = await fixture();
  const data = { ...f.data };
  if (kind === "user") data.userId = other.user.id;
  if (kind === "tenant") data.tenantId = other.company.id;
  if (kind === "provider") data.providerId = other.provider.id;
  if (kind === "account") data.accountId = other.account.id;
  if (kind === "credential") data.accountId = (await db.account.create({ data: { userId: f.user.id, providerId: "credential", accountId: f.user.id, password: "fixture-only" } })).id;
  await expect(db.ssoSessionProof.create({ data })).rejects.toMatchObject({ code: "P2003" });
  expect(await db.ssoSessionProof.count()).toBe(0);
});
test("인증 시각/제공자 근거의 사후 덮어쓰기는 DB에서 거부한다", async () => {
  const f = await fixture(); await db.ssoSessionProof.create({ data: f.data });
  await expect(db.ssoSessionProof.update({ where: { sessionId: f.session.id }, data: { authenticatedAt: new Date() } })).rejects.toThrow();
  await expect(db.ssoSessionProof.update({ where: { sessionId: f.session.id }, data: { identityProvider: "GOOGLE" } })).rejects.toThrow();
  expect((await db.ssoSessionProof.findUniqueOrThrow({ where: { sessionId: f.session.id } })).authenticatedAt).toEqual(f.data.authenticatedAt);
});
test.each(["session", "account"])("%s 삭제는 남은 세션 근거도 제거한다", async kind => {
  const f = await fixture(); await db.ssoSessionProof.create({ data: f.data });
  if (kind === "session") await db.session.delete({ where: { id: f.session.id } });
  else await db.account.delete({ where: { id: f.account.id } });
  expect(await db.ssoSessionProof.count()).toBe(0);
});
test("비활성/사전검사 실패/분류 변경된 공급자의 근거는 사용하지 않는다", async () => {
  const f = await fixture(); await db.ssoSessionProof.create({ data: f.data });
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: false } });
  expect(await currentSsoSessionProof(db, f.session.id, f.user.id)).toBeNull();
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: true, preflightOk: false } });
  expect(await currentSsoSessionProof(db, f.session.id, f.user.id)).toBeNull();
  await db.ssoProvider.update({ where: { id: f.provider.id }, data: { preflightOk: true, issuer: "https://accounts.google.com",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", jwksUrl: "https://www.googleapis.com/oauth2/v3/certs" } });
  expect(await currentSsoSessionProof(db, f.session.id, f.user.id)).toBeNull();
});
test("정책은 NONE 기본값과 세 가지 mode 및 양수 버전 제약을 갖는다", async () => {
  const f = await fixture();
  const policy = await db.ssoLoginPolicy.create({ data: { tenantId: f.company.id } });
  expect(policy).toMatchObject({ mode: "NONE", version: 1 });
  await expect(db.ssoLoginPolicy.update({ where: { tenantId: f.company.id }, data: { mode: "arbitrary" } })).rejects.toThrow();
  await expect(db.ssoLoginPolicy.update({ where: { tenantId: f.company.id }, data: { version: 0 } })).rejects.toThrow();
  for (const mode of ["AZURE", "GOOGLE", "NONE"]) expect((await db.ssoLoginPolicy.update({ where: { tenantId: f.company.id }, data: { mode } })).mode).toBe(mode);
  expect(planCapabilities.parse([...securityCapabilities])).toContain("security.sso_login_policy");
  expect(planCapabilities.safeParse(["security.sso_login_policy", "security.sso_login_policy"]).success).toBe(false);
});

const password = "Proof-mfa-owner!123456";
const cookies = (r: Response) => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
function call(path: string, input: unknown, cookie = "") { return auth.handler(new Request(origin + "/api/v1/auth/" + path,
  { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(input) })); }
test("클라이언트의 인증 방법 필드를 이메일 로그인에 넣어도 근거가 생성되지 않는다", async () => {
  const email = randomUUID() + "@proof.test";
  expect((await call("sign-up/email", { email, password, name: "사용자" })).status).toBe(200);
  await db.user.update({ where: { email }, data: { emailVerified: true } });
  expect((await call("sign-in/email", { email, password, identityProvider: "GOOGLE", ssoProviderId: randomUUID(), authenticatedAt: new Date().toISOString() })).status).toBe(200);
  expect(await db.ssoSessionProof.count()).toBe(0);
});
test("MFA 설정 세션 교체는 합성 SSO 근거와 원래 인증 시각을 보존하고 로그아웃은 제거한다", async () => {
  const email = randomUUID() + "@proof.test";
  await call("sign-up/email", { email, password, name: "회전 시험" });
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const f = await fixture();
  await db.membership.create({ data: { tenantId: f.company.id, userId: user.id, role: "admin" } });
  const account = await db.account.create({ data: { userId: user.id, providerId: "sso:" + f.provider.id, accountId: "https://independent.test|rotation" } });
  let cookie = cookies(await call("sign-in/email", { email, password }));
  const old = await db.session.findFirstOrThrow({ where: { userId: user.id } });
  // Only the rotation test seeds provenance. Real signed OIDC/SAML acquisition is covered in protocol suites.
  await db.ssoSessionProof.create({ data: { ...f.data, sessionId: old.id, userId: user.id, accountId: account.id } });
  const setup = await call("two-factor/enable", { password }, cookie); expect(setup.status).toBe(200);
  cookie = cookies(setup) || cookie; const data = await setup.json();
  const secret = new TextDecoder().decode(base32.decode(new URL(data.totpURI).searchParams.get("secret")!));
  const verified = await call("two-factor/verify-totp", { code: await createOTP(secret, { digits: 6, period: 30 }).totp() }, cookie);
  expect(verified.status).toBe(200); cookie = cookies(verified) || cookie;
  const current = await db.session.findFirstOrThrow({ where: { userId: user.id } });
  expect(current.id).not.toBe(old.id);
  expect(current.activeCompanyId).toBe(f.company.id);
  expect(await db.ssoSessionProof.findUnique({ where: { sessionId: old.id } })).toBeNull();
  expect(await db.ssoSessionProof.findUnique({ where: { sessionId: current.id } })).toMatchObject({ authenticatedAt: f.data.authenticatedAt, accountId: account.id, identityProvider: "OTHER" });
  const disabled = await call("two-factor/disable", { password }, cookie); expect(disabled.status).toBe(200); cookie = cookies(disabled) || cookie;
  const afterDisable = await db.session.findFirstOrThrow({ where: { userId: user.id } });
  expect(afterDisable.id).not.toBe(current.id);
  expect(await db.ssoSessionProof.findUnique({ where: { sessionId: afterDisable.id } })).toMatchObject({ authenticatedAt: f.data.authenticatedAt, accountId: account.id, identityProvider: "OTHER" });
  expect((await call("sign-out", {}, cookie)).status).toBe(200);
  expect(await db.ssoSessionProof.count({ where: { userId: user.id } })).toBe(0);
});
