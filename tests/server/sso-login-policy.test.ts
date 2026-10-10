import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { decrypt } from "@/server/crypto";
import { recordSsoSessionProof } from "@/server/sso-session-proof";
import { readSsoLoginPolicy, requestSsoPolicyChallenge, saveSsoLoginPolicy } from "@/server/sso-login-policy";
import { runOneJob } from "@/server/jobs";
import * as auditModule from "@/server/audit";
import { GET, PUT } from "@/app/api/v1/security/sso-policy/route";
import { POST } from "@/app/api/v1/security/sso-policy/challenge/route";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE'); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(async () => { await db.$disconnect(); });
const google = { protocol: "oidc", name: "시험 Google", issuer: "https://accounts.google.com", clientId: "synthetic-client",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", enabled: true, preflightOk: true };
const selection = { mode: "GOOGLE" as const, version: 0 };
async function changeRole(f: Awaited<ReturnType<typeof fixture>>, role: "security" | "admin" | "editor" | "viewer") {
  const backup = await db.user.create({ data: { email: randomUUID() + "@writer.test", name: "다른 소유자", emailVerified: true } });
  await db.membership.create({ data: { tenantId: f.company.id, userId: backup.id, role: "owner" } });
  await db.membership.update({ where: { id: f.ctx.member.id }, data: { role } });
}
async function fixture(options: { entitlement?: "none" | "excluded" | "expired"; proofAge?: number; noProof?: boolean } = {}) {
  const email = randomUUID() + "@writer.test", password = "Policy-writer!123456";
  const call = (path: string, body: unknown) => auth.handler(new Request(origin + "/api/v1/auth/" + path,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  expect((await call("sign-up/email", { email, password, name: "정책 저장 시험" })).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "정책 시험 회사", publicName: "회사", policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId: user.id, role: "owner" } } } });
  const response = await call("sign-in/email", { email, password }); expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const headers = new Headers({ origin, cookie }), ctx = await requireContext(headers);
  const provider = await db.ssoProvider.create({ data: { ...google, tenantId: company.id } });
  const account = await db.account.create({ data: { userId: user.id, providerId: "sso:" + provider.id, accountId: google.issuer + "|" + user.id } });
  // Explicit relational provenance fixture; signed callback acquisition is tested separately.
  if (!options.noProof) await recordSsoSessionProof(db, ctx.session.id, user.id, provider, account.id, new Date(Date.now() - (options.proofAge ?? 0)));
  if (options.entitlement !== "none") {
    const version = await db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000) + 100,
      cycle: "trial", priceKrw: 0, features: [], capabilities: options.entitlement === "excluded" ? [] : ["security.sso_login_policy"] } });
    const start = new Date(Date.now() - (options.entitlement === "expired" ? 8 : 1) * 86400000), end = new Date(start.getTime() + 7 * 86400000);
    await db.billingSubscription.create({ data: { tenantId: company.id, planId: "trial", planVersionId: version.id, status: "trialing", activationSource: "trial", priceKrw: 0, periodStart: start, periodEnd: end } });
  }
  const request = (method: string, body?: unknown) => new Request(origin + "/api/v1/security/sso-policy", { method, headers: { origin, cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const challenge = async () => {
    const issued = await requestSsoPolicyChallenge(ctx, { ...selection, tenantId: company.id }, randomUUID());
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sso-policy:" + issued.challengeId } });
    const mail = decrypt<{ text: string; to: string }>(job.payloadCipher), code = mail.text.match(/인증번호: (\d{6})/)![1];
    return { ...issued, code, job, mail, save: (override = {}) => saveSsoLoginPolicy(ctx, { ...selection, tenantId: company.id, challengeId: issued.challengeId, code, ...override }, randomUUID()) };
  };
  return { ctx, user, company, provider, account, headers, request, challenge };
}
test("조회는 기본 NONE·기능 권한·최근 인증·미연결 구성원 영향을 구분하고 비밀을 반환하지 않는다", async () => {
  const f = await fixture();
  const other = await db.user.create({ data: { email: randomUUID() + "@writer.test", emailVerified: true, name: "미연결" } });
  await db.membership.create({ data: { tenantId: f.company.id, userId: other.id, role: "viewer" } });
  const result = await readSsoLoginPolicy(f.ctx);
  expect(result).toMatchObject({ mode: "NONE", version: 0, canManage: true, entitlement: { available: true }, authentication: { identityProvider: "GOOGLE" } });
  expect(result.options.find(row => row.mode === "GOOGLE")).toMatchObject({ configured: true, linked: true, activeMembers: 2, linkedMembers: 1, unlinkedMembers: 1 });
  expect(JSON.stringify(result)).not.toMatch(/codeHash|clientId|synthetic-client|@writer.test/);
});
test.each(["none", "excluded", "expired"] as const)("%s 구독은 현재 DB 상태로 정책 변경을 차단한다", async entitlement => {
  const f = await fixture({ entitlement });
  expect((await readSsoLoginPolicy(f.ctx)).entitlement.available).toBe(false);
  await expect(f.challenge()).rejects.toMatchObject({ status: 402 });
  expect(await db.ssoPolicyChallenge.count()).toBe(0);
});
test.each(["admin", "editor", "viewer"] as const)("캡처된 owner 문맥이라도 현재 %s 역할은 저장 권한이 없다", async role => {
  const f = await fixture(); await changeRole(f, role);
  await expect(f.challenge()).rejects.toMatchObject({ status: 403 });
});
test.each(["missing", "old", "disabled"] as const)("%s 실제 SSO 근거는 연결 계정만으로 대체하지 않는다", async kind => {
  const f = await fixture({ noProof: kind === "missing", proofAge: kind === "old" ? 301000 : 0 });
  if (kind === "disabled") await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: false } });
  await expect(f.challenge()).rejects.toMatchObject({ code: "SSO_POLICY_REAUTH_REQUIRED" });
});
test("이메일 인증·정책 저장·한 번 소비·감사가 원자 적용되고 재전송은 버전 충돌이다", async () => {
  const f = await fixture(), c = await f.challenge();
  expect(c.mail.to).toBe(f.user.email);
  expect(await c.save()).toEqual({ tenantId: f.company.id, mode: "GOOGLE", version: 1 });
  expect(await db.ssoPolicyChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).toMatchObject({ consumedAt: expect.any(Date), attempts: 0 });
  expect(await db.auditEvent.count({ where: { action: "sso.policy_updated" } })).toBe(1);
  await expect(c.save()).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(await db.auditEvent.count({ where: { action: "sso.policy_updated" } })).toBe(1);
});
test("보안 담당자도 변경 가능하고 NONE 복귀는 기존 공급자의 최근 인증으로 처리한다", async () => {
  const f = await fixture(); await changeRole(f, "security");
  const c = await f.challenge(); await c.save();
  await db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { createdAt: new Date(Date.now() - 61000) } });
  const next = await requestSsoPolicyChallenge(f.ctx, { tenantId: f.company.id, mode: "NONE", version: 1 }, randomUUID());
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sso-policy:" + next.challengeId } });
  const code = decrypt<{ text: string }>(job.payloadCipher).text.match(/인증번호: (\d{6})/)![1];
  expect(await saveSsoLoginPolicy(f.ctx, { tenantId: f.company.id, mode: "NONE", version: 1, challengeId: next.challengeId, code }, randomUUID())).toEqual({ tenantId: f.company.id, mode: "NONE", version: 2 });
});
test("오답 5회는 각각 커밋되며 이후 정답도 소비하지 못한다", async () => {
  const f = await fixture(), c = await f.challenge(), bad = c.code === "000000" ? "000001" : "000000";
  for (let i = 1; i <= 5; i++) {
    await expect(c.save({ code: bad })).rejects.toMatchObject({ code: i === 5 ? "SSO_POLICY_CHALLENGE_INVALID" : "SSO_POLICY_CODE_INVALID" });
    expect((await db.ssoPolicyChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).attempts).toBe(i);
  }
  await expect(c.save()).rejects.toMatchObject({ code: "SSO_POLICY_CHALLENGE_INVALID" });
  expect((await db.job.findUniqueOrThrow({ where: { id: c.job.id } })).status).toBe("cancelled");
  expect(await db.ssoLoginPolicy.count()).toBe(0);
});
test("동일 요청의 동시 저장은 한 번만 성공한다", async () => {
  const f = await fixture(), c = await f.challenge();
  const results = await Promise.allSettled([c.save(), c.save()]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
  expect(await db.auditEvent.count({ where: { action: "sso.policy_updated" } })).toBe(1);
});
test("새 코드 발급은 이전 코드를 폐기하고 메일을 취소하며 재발급 간격을 제한한다", async () => {
  const f = await fixture(), first = await f.challenge();
  await expect(f.challenge()).rejects.toMatchObject({ status: 429 });
  await db.ssoPolicyChallenge.update({ where: { id: first.challengeId }, data: { createdAt: new Date(Date.now() - 61000) } });
  const second = await f.challenge();
  await expect(first.save()).rejects.toMatchObject({ code: "SSO_POLICY_CHALLENGE_INVALID" });
  expect((await db.job.findUniqueOrThrow({ where: { id: first.job.id } })).status).toBe("cancelled");
  expect(await second.save()).toMatchObject({ version: 1 });
});
test.each(["session", "user", "tenant", "mode", "email", "expired"] as const)("코드의 %s 바인딩을 현재 DB에서 대조한다", async kind => {
  const f = await fixture(), c = await f.challenge();
  if (kind === "expired") await db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { createdAt: new Date(Date.now() - 600000), expiresAt: new Date(Date.now() - 1000) } });
  else if (kind === "email") await db.user.update({ where: { id: f.user.id }, data: { email: "changed@writer.test" } });
  else if (kind === "mode") await db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { mode: "AZURE" } });
  else if (kind === "tenant") {
    const company = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
    await db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { tenantId: company.id } });
  } else {
    const user = kind === "user" ? await db.user.create({ data: { email: randomUUID() + "@writer.test", name: "다른 사용자", emailVerified: true } }) : f.user;
    const session = await db.session.create({ data: { userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    await db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { userId: user.id, sessionId: session.id } });
  }
  await expect(c.save()).rejects.toMatchObject({ code: kind === "expired" ? "SSO_POLICY_CHALLENGE_INVALID" : "SSO_POLICY_CHALLENGE_NOT_FOUND" });
  expect(await db.ssoLoginPolicy.count()).toBe(0);
});
test.each(["challenge", "save", "wrong-code"] as const)("%s 감사 실패는 인증·메일·정책·실패 횟수를 모두 롤백한다", async stage => {
  const f = await fixture(), c = stage === "challenge" ? null : await f.challenge();
  const action = stage === "challenge" ? "sso.policy_challenge_requested" : stage === "save" ? "sso.policy_updated" : "sso.policy_challenge_rejected";
  const original = auditModule.audit;
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    if (args[3] === action) throw new Error("TEST_AUDIT_FAILED"); return original(...args);
  });
  await expect(c ? c.save(stage === "wrong-code" ? { code: c.code === "000000" ? "000001" : "000000" } : {}) : f.challenge()).rejects.toThrow("TEST_AUDIT_FAILED");
  expect(await db.ssoLoginPolicy.count()).toBe(0);
  if (c) expect(await db.ssoPolicyChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).toMatchObject({ attempts: 0, consumedAt: null });
  else { expect(await db.ssoPolicyChallenge.count()).toBe(0); expect(await db.job.count({ where: { dedupeKey: { startsWith: "mail:sso-policy:" } } })).toBe(0); }
});
test("저장 도중 인증 기한을 넘으면 정책과 소비·감사도 커밋하지 않는다", async () => {
  const f = await fixture(), c = await f.challenge(), original = auditModule.audit;
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    await original(...args);
    if (args[3] === "sso.policy_updated") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 301000); }
  });
  await expect(c.save()).rejects.toMatchObject({ code: "SSO_POLICY_REAUTH_REQUIRED" });
  expect(await db.ssoLoginPolicy.count()).toBe(0);
  expect((await db.ssoPolicyChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).consumedAt).toBe(null);
  expect(await db.auditEvent.count({ where: { action: "sso.policy_updated" } })).toBe(0);
});
test.each(["role", "proof", "provider", "version", "session"] as const)("challenge 발급 뒤 %s 변경도 저장 시 다시 확인한다", async kind => {
  const f = await fixture(), c = await f.challenge();
  if (kind === "role") await changeRole(f, "viewer");
  if (kind === "proof") await db.ssoSessionProof.delete({ where: { sessionId: f.ctx.session.id } });
  if (kind === "provider") await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: false } });
  if (kind === "version") await db.ssoLoginPolicy.create({ data: { tenantId: f.company.id, mode: "NONE" } });
  if (kind === "session") await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await expect(c.save()).rejects.toMatchObject({ code: kind === "role" ? "FORBIDDEN" : kind === "version" ? "VERSION_CONFLICT" : kind === "session" ? "SESSION_EXPIRED" : "SSO_POLICY_REAUTH_REQUIRED" });
  expect((await db.ssoPolicyChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).consumedAt).toBe(null);
});
test("구독 기한이 저장 도중 끝나도 정책·소비·감사가 롤백된다", async () => {
  const f = await fixture(), c = await f.challenge(), original = auditModule.audit;
  const subscription = await db.billingSubscription.findFirstOrThrow({ where: { tenantId: f.company.id } });
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    await original(...args);
    if (args[3] === "sso.policy_updated") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(subscription.periodEnd!.getTime() + 1); }
  });
  await expect(c.save()).rejects.toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });
  expect(await db.ssoLoginPolicy.count()).toBe(0);
  expect((await db.ssoPolicyChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).consumedAt).toBe(null);
  expect(await db.auditEvent.count({ where: { action: "sso.policy_updated" } })).toBe(0);
});
test("제한 공급자 사이 직접 교체는 명시적 NONE 중간 단계를 요구한다", async () => {
  const f = await fixture(), c = await f.challenge(); await c.save();
  await expect(requestSsoPolicyChallenge(f.ctx, { tenantId: f.company.id, mode: "AZURE", version: 1 }, randomUUID())).rejects.toMatchObject({ code: "SSO_POLICY_SWITCH_REQUIRES_NONE" });
});
test("DB가 잘못된 challenge 시도 수와 사용자/세션 조합을 거부하고 세션 삭제는 요청을 정리한다", async () => {
  const f = await fixture(), c = await f.challenge();
  await expect(db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { attempts: 6 } })).rejects.toThrow();
  const other = await db.user.create({ data: { name: "다른 사용자", email: randomUUID() + "@writer.test" } });
  await expect(db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { userId: other.id } })).rejects.toThrow();
  await db.session.delete({ where: { id: f.ctx.session.id } });
  expect(await db.ssoPolicyChallenge.count({ where: { id: c.challengeId } })).toBe(0);
});
test("다른 탭에서 B 회사로 인증해도 A 화면의 challenge·저장 요청은 B 정책을 바꾸지 못한다", async () => {
  const f = await fixture(), firstView = await readSsoLoginPolicy(f.ctx);
  const company = await db.company.create({ data: { name: "B 회사", publicName: "B", memberships: { create: { userId: f.user.id, role: "owner" } } } });
  const subscription = await db.billingSubscription.findFirstOrThrow({ where: { tenantId: f.company.id } });
  await db.billingSubscription.create({ data: { tenantId: company.id, planId: subscription.planId, planVersionId: subscription.planVersionId, status: "trialing", activationSource: "trial", priceKrw: 0, periodStart: subscription.periodStart, periodEnd: subscription.periodEnd } });
  const provider = await db.ssoProvider.create({ data: { ...google, tenantId: company.id } });
  const account = await db.account.create({ data: { userId: f.user.id, providerId: "sso:" + provider.id, accountId: google.issuer + "|" + f.user.id } });
  await db.ssoSessionProof.delete({ where: { sessionId: f.ctx.session.id } });
  await db.session.update({ where: { id: f.ctx.session.id }, data: { activeCompanyId: company.id } });
  await recordSsoSessionProof(db, f.ctx.session.id, f.user.id, provider, account.id);
  const staleSelection = { ...selection, tenantId: firstView.tenantId };
  const rejected = await POST(f.request("POST", staleSelection));
  expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ error: { code: "COMPANY_CHANGED" } });
  expect(await db.ssoPolicyChallenge.count()).toBe(0);
  const issued = await POST(f.request("POST", { ...selection, tenantId: company.id })); expect(issued.status).toBe(201);
  const { challengeId } = await issued.json(), job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sso-policy:" + challengeId } });
  const code = decrypt<{ text: string }>(job.payloadCipher).text.match(/인증번호: (\d{6})/)![1];
  const save = await PUT(f.request("PUT", { ...staleSelection, challengeId, code }));
  expect(save.status).toBe(403); expect(await save.json()).toMatchObject({ error: { code: "COMPANY_CHANGED" } });
  expect(await db.ssoLoginPolicy.count()).toBe(0);
  expect((await db.ssoPolicyChallenge.findUniqueOrThrow({ where: { id: challengeId } })).consumedAt).toBe(null);
});
test("API는 원본 출처·엄격한 계약과 201→200 결과를 확인한다", async () => {
  const f = await fixture();
  expect((await GET(f.request("GET"))).status).toBe(200);
  const wrongOrigin = f.request("POST", { ...selection, tenantId: f.company.id }); wrongOrigin.headers.set("origin", "https://evil.invalid");
  expect((await POST(wrongOrigin)).status).toBe(403);
  expect((await POST(f.request("POST", { ...selection, tenantId: f.company.id, unexpected: true }))).status).toBe(422);
  const response = await POST(f.request("POST", { ...selection, tenantId: f.company.id })); expect(response.status).toBe(201);
  const issued = await response.json(); expect(Object.keys(issued).sort()).toEqual(["challengeId", "expiresAt", "retryAt"]);
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:sso-policy:" + issued.challengeId } });
  const code = decrypt<{ text: string }>(job.payloadCipher).text.match(/인증번호: (\d{6})/)![1];
  expect((await PUT(f.request("PUT", { ...selection, tenantId: f.company.id, challengeId: issued.challengeId, code }))).status).toBe(200);
});
test.each(["current", "revoked", "role", "provider", "version", "email"] as const)("메일 발송 직전 %s 상태를 대조하고 해당 job만 실행한다", async kind => {
  const f = await fixture(), c = await f.challenge();
  if (kind === "revoked") await db.ssoPolicyChallenge.update({ where: { id: c.challengeId }, data: { revokedAt: new Date() } });
  if (kind === "role") await changeRole(f, "viewer");
  if (kind === "provider") await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: false } });
  if (kind === "version") await db.ssoLoginPolicy.create({ data: { tenantId: f.company.id, mode: "NONE" } });
  if (kind === "email") await db.user.update({ where: { id: f.user.id }, data: { email: "changed@writer.test" } });
  expect(await runOneJob("policy-writer-test", { tenantId: f.company.id, jobId: c.job.id })).toBe(true);
  expect((await db.job.findUniqueOrThrow({ where: { id: c.job.id } })).status).toBe(kind === "current" ? "done" : "cancelled");
  if (kind === "current") {
    const mail = JSON.parse(await readFile(env.LOCAL_MAIL_DIR + "/" + c.job.id + ".json", "utf8"));
    expect(mail.text).toContain(c.code); expect(mail.to).toBe(f.user.email);
  }
});
