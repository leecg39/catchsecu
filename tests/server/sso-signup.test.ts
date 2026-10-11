import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SsoState } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { completeSso } from "@/server/sso";
import { startSsoBrowser } from "@/server/sso-browser";
import { cleanupSsoSignup } from "@/server/sso-signup";
import { signupLegalVersions } from "@/contracts/sso-signup";
import { GET, POST, DELETE } from "@/app/api/v1/auth/sso/signup/route";
const fault = vi.hoisted(() => ({ audit: false, expire: false }));
vi.mock("@/server/audit", async original => {
  const actual = await original<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    if (args[3] === "sso.signup_accepted") {
      if (fault.audit) throw Error("signup audit fixture failure");
      if (fault.expire) vi.setSystemTime(new Date(Date.now() + 301000));
    }
    return actual.audit(...args);
  } };
});
const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw Error("Isolated test DB required");
beforeEach(async () => { fault.audit = false; fault.expire = false; await db.$executeRawUnsafe('TRUNCATE "Company", "User", "ApiRateLimit", "Verification" CASCADE'); });
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());
const request = (cookie: string, method = "GET", body?: unknown, requestOrigin = origin) => new Request(origin + "/api/v1/auth/sso/signup", { method,
  headers: { origin: requestOrigin, cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function pending(invited = false, lifetimeMs = 600000) {
  // This fixture supplies an already-verified identity to the completion boundary.
  // Actual signature/PKCE/browser callback coverage remains in the OIDC transport suites.
  const company = await db.company.create({ data: { name: "SSO 가입 시험 회사", publicName: "SSO 가입 시험", policy: { create: { passwordMonths: 0 } } } });
  const provider = await db.ssoProvider.create({ data: { tenantId: company.id, name: "시험 OIDC", issuer: "https://idp.example.test", clientId: "signup-qa", authorizationUrl: "https://idp.example.test/authorize", tokenUrl: "https://idp.example.test/token", jwksUrl: "https://idp.example.test/jwks", enabled: true, preflightOk: true } });
  const browser = startSsoBrowser(new Headers(), "oidc"), email = "sso-signup-" + randomUUID() + "@example.test";
  const state: SsoState = { id: randomUUID(), tenantId: company.id, providerId: provider.id, providerVersion: provider.version,
    stateHash: "a".repeat(64), browserHash: browser.browserHash, nonceHash: "b".repeat(64), verifierCipher: "fixture", mode: invited ? "invite" : "login",
    sessionId: null, userId: null, invitationId: null, invitationVersion: null, invitationTokenHash: null, orgMemberId: null,
    createdAt: new Date(), expiresAt: new Date(Date.now() + lifetimeMs) };
  if (invited) {
    const owner = await db.user.create({ data: { name: "초대 소유자", email: "owner-" + randomUUID() + "@example.test", emailVerified: true } });
    const member = await db.membership.create({ data: { tenantId: company.id, userId: owner.id, role: "owner" } });
    const invitation = await db.invitation.create({ data: { tenantId: company.id, email, role: "editor", tokenHash: "c".repeat(64), invitedBy: member.id, expiresAt: new Date(Date.now() + 600000), serviceIds: [] } });
    state.invitationId = invitation.id; state.invitationVersion = invitation.version; state.invitationTokenHash = invitation.tokenHash;
  }
  const headers = new Headers({ cookie: browser.browserCookie.split(";")[0] });
  const subject = { sub: "signup-" + randomUUID(), iss: provider.issuer, email, name: "인증된 이름", emailVerified: true };
  const result = await completeSso(provider, state, subject, headers);
  expect(result.redirect).toBe("/oauth2/signup");
  const cookie = headers.get("cookie") + "; " + result.cookie.split(";")[0];
  const response = await GET(request(cookie)); expect(response.status).toBe(200);
  const view = await response.json();
  const input = { intentId: view.id, overFourteen: true, termsAccepted: true, privacyAccepted: true,
    termsVersion: signupLegalVersions.terms, privacyVersion: signupLegalVersions.privacy };
  return { company, provider, state, subject, cookie, view, input };
}
test("신규 OIDC는 동의 전 계정/소속/세션을 만들지 않고 암호화된 가입 요청만 발급한다", async () => {
  const f = await pending();
  expect(await db.user.count()).toBe(0); expect(await db.account.count()).toBe(0); expect(await db.membership.count()).toBe(0); expect(await db.session.count()).toBe(0);
  expect(f.view).toMatchObject({ email: f.subject.email, name: "인증된 이름", companyName: null });
  const row = await db.ssoSignupIntent.findUniqueOrThrow({ where: { id: f.view.id } });
  expect(row.payloadCipher).not.toContain(f.subject.email); expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(300000);
  expect(Object.keys(f.view).sort()).toEqual(["id", "email", "name", "companyName", "expiresAt", "termsVersion", "privacyVersion"].sort());
});
test("동의 수락은 사용자·연결·회사 소속·영수증·세션·감사·소비를 함께 저장한다", async () => {
  const f = await pending(), response = await POST(request(f.cookie, "POST", f.input)); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ redirect: "/dashboard" });
  expect(response.headers.getSetCookie().some(cookie => cookie.includes("better-auth.session_token="))).toBe(true);
  const user = await db.user.findUniqueOrThrow({ where: { email: f.subject.email } });
  expect(await db.account.count({ where: { userId: user.id } })).toBe(1); expect(await db.membership.findUnique({ where: { tenantId_userId: { tenantId: f.company.id, userId: user.id } } })).toMatchObject({ role: "viewer" });
  expect(await db.ssoSignupAcceptance.findUnique({ where: { userId: user.id } })).toMatchObject({ overFourteen: true, termsVersion: signupLegalVersions.terms, privacyVersion: signupLegalVersions.privacy });
  expect(await db.session.count({ where: { userId: user.id } })).toBe(1); expect(await db.ssoSessionProof.count()).toBe(1); expect(await db.ssoSignupIntent.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "sso.signup_accepted" } })).toBe(1);
  expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(410);
});
test.each([{ overFourteen: false }, { termsAccepted: false }, { privacyAccepted: false }, { termsVersion: "old" }, { email: "attacker@example.test" }])("누락 동의·오래된 약관·위조 신원은 저장하지 않는다: %j", async patch => {
  const f = await pending(); expect((await POST(request(f.cookie, "POST", { ...f.input, ...patch }))).status).toBe(422);
  expect(await db.user.count()).toBe(0); expect(await db.ssoSignupIntent.count()).toBe(1);
});
test("다른 브라우저·가입 쿠키 누락·다른 Origin·다른 탭 요청 식별자를 거부한다", async () => {
  const f = await pending(); expect((await GET(request(""))).status).toBe(410);
  expect((await GET(request(f.cookie.split("; ").at(-1)!))).status).toBe(401);
  expect((await POST(request(f.cookie, "POST", f.input, "https://evil.example.test"))).status).toBe(403);
  expect((await POST(request(f.cookie, "POST", { ...f.input, intentId: randomUUID() }))).status).toBe(410);
  expect(await db.user.count()).toBe(0);
});
test("공급자 변경 또는 해제는 기존 가입 요청을 허용하지 않는다", async () => {
  const f = await pending(); await db.ssoProvider.update({ where: { id: f.provider.id }, data: { version: { increment: 1 } } });
  expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(409); expect(await db.user.count()).toBe(0);
  await db.ssoProvider.delete({ where: { id: f.provider.id } }); expect(await db.ssoSignupIntent.count()).toBe(0);
});
test("초대 회사 표시와 수락 역할을 유지하고 취소된 초대를 거부한다", async () => {
  const f = await pending(true); expect(f.view.companyName).toBe(f.company.name);
  await db.invitation.update({ where: { id: f.state.invitationId! }, data: { status: "revoked", version: { increment: 1 } } });
  expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(410);
  expect(await db.user.count({ where: { email: f.subject.email } })).toBe(0);
});
test("유효한 초대 가입은 초대 role과 수락 감사를 한 번 반영한다", async () => {
  const f = await pending(true); expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email: f.subject.email } });
  expect(await db.membership.findUnique({ where: { tenantId_userId: { tenantId: f.company.id, userId: user.id } } })).toMatchObject({ role: "editor" });
  expect(await db.invitation.findUnique({ where: { id: f.state.invitationId! } })).toMatchObject({ status: "accepted", acceptedBy: user.id });
});
test("동시 수락은 한 번만 성공하며 계정·영수증·세션을 중복 생성하지 않는다", async () => {
  const f = await pending(); const responses = await Promise.all([POST(request(f.cookie, "POST", f.input)), POST(request(f.cookie, "POST", f.input))]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 410]); expect(await db.user.count()).toBe(1); expect(await db.ssoSignupAcceptance.count()).toBe(1); expect(await db.session.count()).toBe(1);
});
test("감사 실패는 계정과 영수증까지 롤백하고 같은 요청을 재시도할 수 있다", async () => {
  const f = await pending(); fault.audit = true; expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(500);
  expect(await db.user.count()).toBe(0); expect(await db.ssoSignupAcceptance.count()).toBe(0); expect(await db.ssoSignupIntent.count()).toBe(1);
  fault.audit = false; expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(200);
});
test("수락 도중 가입 기한 종료는 세션과 소비를 롤백한다", async () => {
  const f = await pending(); vi.useFakeTimers({ toFake: ["Date"] }); fault.expire = true;
  expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(410);
  expect(await db.user.count()).toBe(0); expect(await db.session.count()).toBe(0); expect(await db.ssoSignupIntent.count()).toBe(1);
});
test("취소와 기한 정리는 가입 신원 암호문을 제거한다", async () => {
  const f = await pending(); expect((await DELETE(request(f.cookie, "DELETE", { intentId: f.view.id }))).status).toBe(200); expect(await db.ssoSignupIntent.count()).toBe(0);
  const next = await pending(); await db.ssoSignupIntent.update({ where: { id: next.view.id }, data: { createdAt: new Date(Date.now() - 400000), expiresAt: new Date(Date.now() - 100001) } });
  expect((await GET(request(next.cookie))).status).toBe(410); expect((await cleanupSsoSignup()).count).toBe(1); expect(await db.user.count()).toBe(0);
});

test.each(["closed-company", "ip-policy", "login-policy", "email-collision"])("동의 대기 후 %s 변경을 수락 시 다시 확인한다", async kind => {
  const f = await pending();
  if (kind === "closed-company") await db.company.update({ where: { id: f.company.id }, data: { status: "closed" } });
  if (kind === "ip-policy") {
    await db.ipRule.create({ data: { tenantId: f.company.id, cidr: "192.0.2.0/24" } });
    await db.ipAccessPolicy.create({ data: { tenantId: f.company.id, enabled: true } });
  }
  if (kind === "login-policy") await db.ssoLoginPolicy.create({ data: { tenantId: f.company.id, mode: "GOOGLE" } });
  if (kind === "email-collision") await db.user.create({ data: { email: f.subject.email, name: "별도 가입", emailVerified: true } });
  const before = await db.user.count(), response = await POST(request(f.cookie, "POST", f.input));
  expect(response.status).toBe(kind === "email-collision" ? 409 : 403);
  expect(await db.user.count()).toBe(before); expect(await db.account.count()).toBe(0); expect(await db.ssoSignupAcceptance.count()).toBe(0);
  expect(await db.ssoSignupIntent.count()).toBe(1);
});
test.each(["providerVersion", "mode", "hash", "cipher", "expiry", "tenant", "state-unique", "token-unique"])("가입 대기 DB 제약은 직접 쓰기의 %s 위반을 거절한다", async kind => {
  const f = await pending(), row = await db.ssoSignupIntent.findUniqueOrThrow({ where: { id: f.view.id } });
  const data: typeof row = { ...row, id: randomUUID(), stateId: randomUUID(), tokenHash: "d".repeat(64) };
  if (kind === "providerVersion") data.providerVersion = 0;
  if (kind === "mode") data.mode = "link";
  if (kind === "hash") data.browserHash = "raw-secret";
  if (kind === "cipher") data.payloadCipher = JSON.stringify(f.subject);
  if (kind === "expiry") data.expiresAt = new Date(data.createdAt.getTime() + 300001);
  if (kind === "tenant") data.tenantId = (await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } })).id;
  if (kind === "state-unique") data.stateId = row.stateId;
  if (kind === "token-unique") data.tokenHash = row.tokenHash;
  await expect(db.ssoSignupIntent.create({ data })).rejects.toThrow();
  expect(await db.ssoSignupIntent.count()).toBe(1);
});
test("동의 영수증의 필수 값은 DB에서도 강제하고 사용자 물리 삭제와 함께 정리한다", async () => {
  const f = await pending(); expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email: f.subject.email } });
  for (const data of [{ overFourteen: false }, { termsVersion: "" }, { privacyVersion: "" }])
    await expect(db.ssoSignupAcceptance.update({ where: { userId: user.id }, data })).rejects.toThrow();
  // Existing membership retention still blocks hard deletion of an enrolled account.
  await expect(db.user.delete({ where: { id: user.id } })).rejects.toThrow();
  expect(await db.ssoSignupAcceptance.count()).toBe(1);
  // An otherwise unreferenced user demonstrates the new FK cascade itself.
  const disposable = await db.user.create({ data: { email: "receipt-" + randomUUID() + "@example.test", name: "FK fixture" } });
  await db.ssoSignupAcceptance.create({ data: { userId: disposable.id, overFourteen: true, termsVersion: signupLegalVersions.terms, privacyVersion: signupLegalVersions.privacy } });
  await db.user.delete({ where: { id: disposable.id } });
  expect(await db.ssoSignupAcceptance.count({ where: { userId: disposable.id } })).toBe(0);
});

test("가입 대기는 원래 인증의 남은 기한을 5분으로 연장하지 않는다", async () => {
  const f = await pending(false, 30000);
  const row = await db.ssoSignupIntent.findUniqueOrThrow({ where: { id: f.view.id } });
  expect(row.expiresAt).toEqual(f.state.expiresAt);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(f.state.expiresAt.getTime() + 1));
  expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(410);
  expect(await db.user.count()).toBe(0); expect(await db.ssoSignupAcceptance.count()).toBe(0);
});

test("동의 대기 시간은 최근 SSO 인증 근거의 시각을 갱신하지 않는다", async () => {
  const f = await pending(), issued = await db.ssoSignupIntent.findUniqueOrThrow({ where: { id: f.view.id } });
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 120000));
  expect((await POST(request(f.cookie, "POST", f.input))).status).toBe(200);
  const proof = await db.ssoSessionProof.findFirstOrThrow();
  expect(proof.authenticatedAt).toEqual(issued.createdAt);
  expect(Date.now() - proof.authenticatedAt.getTime()).toBeGreaterThanOrEqual(120000);
});
