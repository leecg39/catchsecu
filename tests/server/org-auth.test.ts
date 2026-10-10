import { SsoTestBrowser } from "../helpers/sso-browser";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { decrypt, opaqueToken, tokenHash } from "@/server/crypto";
import { env } from "@/server/env";
import * as auditModule from "@/server/audit";
import * as ssoModule from "@/server/sso";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const browser = new SsoTestBrowser();
const password = "Org-owner!12345";

// Capture the company selected by each fixture; never infer it from a later shared-session change.
const fixtureCompanies = new Map<string, string>();
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  if (path === "/security/sso" && method === "POST" && input && typeof input === "object") input = { tenantId: fixtureCompanies.get(cookie), ...input };
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: browser.cookie(cookie),
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ownerCookie(email = "org-" + randomUUID() + "@catchsecu.test") {
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "소유자", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "조직 인증 회사", publicName: "ORG", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } } } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  fixtureCompanies.set(cookie, company.id);
  return { cookie, company, user };
}
beforeEach(async () => {
  browser.reset(); fixtureCompanies.clear();
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SsoProvider" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });

async function routes() {
  const { POST: createProvider, GET: listProviders } = await import("@/app/api/v1/security/sso/route");
  const { PATCH: patchProvider } = await import("@/app/api/v1/security/sso/[id]/route");
  const { GET: listDirectory, POST: addMember } = await import("@/app/api/v1/security/sso/[id]/directory/route");
  const { DELETE: removeMember } = await import("@/app/api/v1/security/sso/[id]/directory/[memberId]/route");
  const { POST: orgLogin } = await import("@/app/api/v1/auth/org/login/route");
  const { POST: emailRegister } = await import("@/app/api/v1/auth/org/email-register/route");
  const { GET: startSso } = await import("@/app/api/v1/auth/sso/[providerId]/route");
  return { createProvider, listProviders, patchProvider, listDirectory, addMember, removeMember, orgLogin: browser.wrap(orgLogin), emailRegister: browser.wrap(emailRegister), startSso: browser.wrap(startSso) };
}
async function makeGpki(cookie: string, protocol = "gpki") {
  const { createProvider, patchProvider } = await routes();
  const created = await createProvider(req("/security/sso", cookie, "POST", { protocol, name: "가상 GPKI" }, randomUUID()));
  expect(created.status).toBe(201);
  const provider = await created.json();
  const enabled = await patchProvider(req(`/security/sso/${provider.id}`, cookie, "PATCH", { version: provider.version, enabled: true }));
  expect((await enabled.json()).enabled).toBe(true);
  return provider;
}
async function addDirectory(cookie: string, providerId: string, member: Record<string, unknown>) {
  const { addMember } = await routes();
  const res = await addMember(req(`/security/sso/${providerId}/directory`, cookie, "POST", member, randomUUID()));
  return { res, member: res.status === 201 ? await res.json() : null };
}
const loginBody = (over: Record<string, unknown> = {}) => ({ protocol: "gpki", orgCode: "ORG-1", employeeNo: "EMP-1", pin: "4321", ...over });

test("가상 GPKI 공급자 등록·디렉터리 CRUD·가상 표시", async () => {
  const { cookie } = await ownerCookie();
  const provider = await makeGpki(cookie);
  expect(provider.protocol).toBe("gpki");
  expect(provider.issuer).toBe("urn:virtual:gpki");
  expect(provider.preflightOk).toBe(true);
  expect(provider.preflightDetail).toContain("가상");
  const { res, member } = await addDirectory(cookie, provider.id,
    { orgCode: "ORG-1", employeeNo: "EMP-1", name: "홍길동", email: "hong@catchsecu.test", pin: "4321" });
  expect(res.status).toBe(201);
  expect(member.name).toBe("홍길동");
  const { listDirectory } = await routes();
  const list = await (await listDirectory(req(`/security/sso/${provider.id}/directory`, cookie))).json();
  expect(list.items).toHaveLength(1);
  expect(JSON.stringify(list)).not.toContain("4321");
  // 조직 식별자+사번은 전역 유일 — 다른 공급자라도 중복 불가
  const dup = await addDirectory(cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "다른", pin: "9999" });
  expect(dup.res.status).toBe(409);
  // 버전 충돌·삭제
  const { removeMember } = await routes();
  const conflict = await removeMember(req(`/security/sso/${provider.id}/directory/${member.id}`, cookie, "DELETE", { version: 99 }));
  expect(conflict.status).toBe(409);
  const removed = await removeMember(req(`/security/sso/${provider.id}/directory/${member.id}`, cookie, "DELETE", { version: member.version }));
  expect(removed.status).toBe(200);
});

test("디렉터리 자격으로 로그인 → JIT 프로비저닝·세션 발급, 잘못된 자격은 거부", async () => {
  const { cookie, company } = await ownerCookie();
  const provider = await makeGpki(cookie);
  await addDirectory(cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "홍길동", email: "hong@catchsecu.test", pin: "4321" });
  const { orgLogin } = await routes();
  // 임의 성공 불가: 모르는 사번·틀린 PIN·다른 프로토콜은 모두 거부
  for (const bad of [{ employeeNo: "EMP-9" }, { pin: "0000" }, { protocol: "saeol" }, { orgCode: "ORG-2" }])
    expect((await orgLogin(req("/auth/org/login", "", "POST", loginBody(bad)))).status).toBeGreaterThanOrEqual(400);
  const ok = await orgLogin(req("/auth/org/login", "", "POST", loginBody()));
  expect(ok.status).toBe(200);
  const body = await ok.json();
  expect(body.status).toBe("verified");
  expect(body.redirect).toBe("/dashboard");
  const sessionCookie = ok.headers.get("set-cookie")!;
  expect(sessionCookie).toContain("better-auth.session_token=");
  const { GET: meRoute } = await import("@/app/api/v1/me/route");
  expect((await meRoute(req("/me", sessionCookie.split(";")[0]))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email: "hong@catchsecu.test" } });
  const member = await db.membership.findFirstOrThrow({ where: { tenantId: company.id, userId: user.id } });
  expect(member.role).toBe("viewer");
  const account = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + provider.id } });
  expect(account.accountId).toBe("urn:virtual:gpki|ORG-1:EMP-1");
  // 두 번째 로그인은 같은 계정/소속을 재사용
  const again = await orgLogin(req("/auth/org/login", "", "POST", loginBody()));
  expect(again.status).toBe(200);
});

test("이메일 미등록 구성원은 email-register 티켓 경로로 등록 후 로그인된다", async () => {
  const { cookie } = await ownerCookie();
  const provider = await makeGpki(cookie);
  await addDirectory(cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "무메일", pin: "4321" });
  const { orgLogin, emailRegister } = await routes();
  const first = await orgLogin(req("/auth/org/login", "", "POST", loginBody()));
  expect(first.status).toBe(200);
  const body = await first.json();
  expect(body.status).toBe("email-register");
  expect(first.headers.get("set-cookie")).toMatch(/catchsecu-sso-browser-local-[a-f0-9]{32}=/);
  expect(JSON.stringify(body)).not.toContain("browserCookie");
  // 잘못된 티켓·이메일 형식 거부
  expect((await emailRegister(req("/auth/org/email-register", "", "POST", { ticket: "x".repeat(43), email: "a@b.test" }))).status).toBeGreaterThanOrEqual(400);
  const registration = await emailChallenge(body.ticket, "new@catchsecu.test");
  const done = await emailRegister(req("/auth/org/email-register", "", "POST", registration));
  expect(done.status).toBe(200);
  expect((await done.json()).status).toBe("verified");
  expect(done.headers.get("set-cookie")).toContain("better-auth.session_token=");
  const member = await db.virtualOrgMember.findFirstOrThrow();
  expect(decrypt<string>(member.emailCipher!)).toBe("new@catchsecu.test");
  // 티켓 재사용 차단 — state가 소비됐다
  const replay = await emailRegister(req("/auth/org/email-register", "", "POST", { ...registration, email: "other@catchsecu.test" }));
  expect(replay.status).toBeGreaterThanOrEqual(400);
});

test("startSso(state) 흐름: link 모드로 기존 사용자 계정에 org 계정을 연결한다", async () => {
  const { cookie, user } = await ownerCookie();
  const provider = await makeGpki(cookie);
  await addDirectory(cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "홍길동", email: "hong@catchsecu.test", pin: "4321" });
  const { startSso, orgLogin } = await routes();
  const started = await startSso(req(`/auth/sso/${provider.id}?mode=link`, cookie));
  expect(started.status).toBe(302);
  const location = new URL(origin + started.headers.get("location")!);
  expect(location.pathname).toBe("/login/gpki");
  const state = location.searchParams.get("state")!;
  // link 모드는 현재 로그인 사용자의 계정에 연결되므로 세션 쿠키가 필요하다.
  const linked = await orgLogin(req("/auth/org/login", cookie, "POST", loginBody({ state })));
  expect(linked.status).toBe(200);
  expect((await linked.json()).redirect).toBe("/link/oauth2/verified");
  const account = await db.account.findFirstOrThrow({ where: { providerId: "sso:" + provider.id, userId: user.id } });
  expect(account.accountId).toBe("urn:virtual:gpki|ORG-1:EMP-1");
  // state 재사용 → 401
  const replay = await orgLogin(req("/auth/org/login", "", "POST", loginBody({ state })));
  expect(replay.status).toBe(401);
});

test("테넌트 격리: 다른 회사 디렉터리·공급자에 접근할 수 없고 비활성 공급자는 로그인을 거부한다", async () => {
  const { cookie } = await ownerCookie();
  const provider = await makeGpki(cookie);
  await addDirectory(cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "홍길동", email: "hong@catchsecu.test", pin: "4321" });
  const other = await ownerCookie("other-" + randomUUID() + "@catchsecu.test");
  const { listDirectory, addMember } = await routes();
  for (const attempt of [
    () => listDirectory(req(`/security/sso/${provider.id}/directory`, other.cookie)),
    () => addMember(req(`/security/sso/${provider.id}/directory`, other.cookie, "POST", { orgCode: "XX", employeeNo: "YY", name: "n", pin: "1234" }, randomUUID())),
  ]) expect((await attempt()).status).toBe(404);
  // 공급자 비활성화 → 로그인 거부
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: false } });
  const { orgLogin } = await routes();
  expect((await orgLogin(req("/auth/org/login", "", "POST", loginBody()))).status).toBe(404);
});

async function emailChallenge(ticket: string, email: string) {
  const { POST } = await import("@/app/api/v1/auth/org/email-register/challenge/route");
  const response = await POST(req("/auth/org/email-register/challenge", "", "POST", { ticket, email }));
  expect(response.status).toBe(200);
  const { challengeId } = await response.json();
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:org-email:" + challengeId } });
  const mail = decrypt<{ to: string; text: string }>(job.payloadCipher);
  expect(mail.to).toBe(email.toLowerCase());
  const code = mail.text.match(/인증번호: (\d{6})/)![1];
  return { ticket, email, challengeId, code };
}

async function pendingEmailRegistration(email = "registration@catchsecu.test") {
  const owner = await ownerCookie();
  const provider = await makeGpki(owner.cookie);
  const { member } = await addDirectory(owner.cookie, provider.id,
    { orgCode: "ORG-1", employeeNo: "EMP-1", name: "등록 대기", pin: "4321" });
  const { orgLogin, emailRegister } = await routes();
  const response = await orgLogin(req("/auth/org/login", "", "POST", loginBody()));
  expect(response.status).toBe(200);
  const { ticket } = await response.json();
  const state = await db.ssoState.findFirstOrThrow({ where: { orgMemberId: member.id } });
  const registration = await emailChallenge(ticket, email);
  return { ...owner, provider, member, state, ticket, emailRegister, registration };
}
async function assertRegistrationRolledBack(memberId: string, stateId: string) {
  expect(await db.virtualOrgMember.findUniqueOrThrow({ where: { id: memberId } }))
    .toMatchObject({ emailCipher: null, version: 1 });
  expect(await db.ssoState.findUnique({ where: { id: stateId } })).not.toBeNull();
  expect(await db.auditEvent.count({ where: { action: "org_auth.email_registered", resourceId: memberId } })).toBe(0);
}

test("티켓 발급 후 공급자를 정지하면 이메일·버전·등록 감사가 남지 않는다", async () => {
  const fixture = await pendingEmailRegistration();
  await db.ssoProvider.update({ where: { id: fixture.provider.id }, data: { enabled: false } });
  const response = await fixture.emailRegister(req("/auth/org/email-register", "", "POST",
    fixture.registration));
  expect(response.status).toBe(409);
  expect(response.headers.get("set-cookie")).toBeNull();
  await assertRegistrationRolledBack(fixture.member.id, fixture.state.id);
});

test("기존 계정 이메일 충돌은 등록을 롤백하고 같은 티켓으로 올바른 이메일을 재시도할 수 있다", async () => {
  const fixture = await pendingEmailRegistration();
  await db.orgEmailChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 61000) } });
  const collision = await emailChallenge(fixture.ticket, fixture.user.email);
  const rejected = await fixture.emailRegister(req("/auth/org/email-register", "", "POST", collision));
  expect(rejected.status).toBe(409);
  await assertRegistrationRolledBack(fixture.member.id, fixture.state.id);
  await db.orgEmailChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 61000) } });
  const corrected = await emailChallenge(fixture.ticket, "corrected@catchsecu.test");
  expect((await fixture.emailRegister(req("/auth/org/email-register", "", "POST", corrected))).status).toBe(200);
});

test("로그인 감사가 실패하면 디렉터리·티켓·JIT 계정·세션까지 모두 롤백한다", async () => {
  const fixture = await pendingEmailRegistration("audit-rollback@catchsecu.test");
  const original = auditModule.audit;
  const spy = vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    if (args[3] === "sso.login") throw new Error("TEST_LOGIN_AUDIT_FAILED");
    return original(...args);
  });
  try {
    const response = await fixture.emailRegister(req("/auth/org/email-register", "", "POST",
      fixture.registration));
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    await assertRegistrationRolledBack(fixture.member.id, fixture.state.id);
    expect(await db.user.findUnique({ where: { email: "audit-rollback@catchsecu.test" } })).toBeNull();
    expect(await db.account.count({ where: { providerId: "sso:" + fixture.provider.id } })).toBe(0);
  } finally { spy.mockRestore(); }
});

test("로그인 완료 직전 티켓이 만료되면 등록 변경도 함께 롤백한다", async () => {
  const fixture = await pendingEmailRegistration("expired-rollback@catchsecu.test");
  const original = auditModule.audit;
  vi.useFakeTimers({ toFake: ["Date"] });
  const spy = vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    await original(...args);
    if (args[3] === "sso.login") vi.setSystemTime(new Date(fixture.state.expiresAt.getTime() + 1));
  });
  try {
    const response = await fixture.emailRegister(req("/auth/org/email-register", "", "POST",
      fixture.registration));
    expect(response.status).toBe(401);
    await assertRegistrationRolledBack(fixture.member.id, fixture.state.id);
    expect(await db.user.findUnique({ where: { email: "expired-rollback@catchsecu.test" } })).toBeNull();
  } finally { spy.mockRestore(); vi.useRealTimers(); }
});

test("동시 이메일 등록은 한 회차만 성공하고 계정·감사를 한 번만 만든다", async () => {
  const fixture = await pendingEmailRegistration();
  const responses = await Promise.all([1, 2].map(() =>
    fixture.emailRegister(req("/auth/org/email-register", "", "POST", fixture.registration))));
  expect(responses.filter(response => response.status === 200)).toHaveLength(1);
  expect(responses.filter(response => response.status >= 400)).toHaveLength(1);
  expect(await db.account.count({ where: { providerId: "sso:" + fixture.provider.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "org_auth.email_registered", resourceId: fixture.member.id } })).toBe(1);
  expect(await db.ssoState.findUnique({ where: { id: fixture.state.id } })).toBeNull();
});

test.each(["closed", "ip-blocked"])("회사 접근을 회수한 뒤 %s 등록 요청은 디렉터리를 변경하지 않는다", async kind => {
  const fixture = await pendingEmailRegistration();
  if (kind === "closed") await db.company.update({ where: { id: fixture.company.id }, data: { status: "closed" } });
  else {
    await db.ipRule.create({ data: { tenantId: fixture.company.id, cidr: "192.0.2.1/32", enabled: true } });
    await db.ipAccessPolicy.create({ data: { tenantId: fixture.company.id, enabled: true } });
  }
  const response = await fixture.emailRegister(req("/auth/org/email-register", "", "POST",
    fixture.registration));
  expect(response.status).toBe(403);
  await assertRegistrationRolledBack(fixture.member.id, fixture.state.id);
});

test("티켓 발급 뒤 디렉터리 버전이 바뀌면 기존 티켓으로 등록할 수 없다", async () => {
  const fixture = await pendingEmailRegistration();
  await db.virtualOrgMember.update({ where: { id: fixture.member.id }, data: { version: { increment: 1 } } });
  const response = await fixture.emailRegister(req("/auth/org/email-register", "", "POST",
    fixture.registration));
  expect(response.status).toBe(409);
  expect(await db.virtualOrgMember.findUniqueOrThrow({ where: { id: fixture.member.id } }))
    .toMatchObject({ emailCipher: null, version: 2 });
  expect(await db.ssoState.findUnique({ where: { id: fixture.state.id } })).not.toBeNull();
});

test.each(["removed", "changed"])("PIN 확인 뒤 디렉터리가 %s 상태가 되면 진행 중인 로그인도 거절한다", async kind => {
  const { cookie } = await ownerCookie();
  const provider = await makeGpki(cookie);
  const { member } = await addDirectory(cookie, provider.id,
    { orgCode: "ORG-1", employeeNo: "EMP-1", name: "회수 대상", email: "revoked-directory@catchsecu.test", pin: "4321" });
  const { orgLogin } = await routes();
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const original = ssoModule.completeSso;
  const spy = vi.spyOn(ssoModule, "completeSso").mockImplementation(async (...args) => {
    reached(); await resume; return original(...args);
  });
  const pending = orgLogin(req("/auth/org/login", "", "POST", loginBody()));
  try {
    await entered;
    if (kind === "removed") await db.virtualOrgMember.delete({ where: { id: member.id } });
    else await db.virtualOrgMember.update({ where: { id: member.id }, data: { version: { increment: 1 } } });
    release();
    const response = await pending;
    expect(response.status).toBe(kind === "removed" ? 401 : 409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await db.user.findUnique({ where: { email: "revoked-directory@catchsecu.test" } })).toBeNull();
    expect(await db.account.count({ where: { providerId: "sso:" + provider.id } })).toBe(0);
  } finally { release(); await pending; spy.mockRestore(); }
});

async function requestCode(ticket: string, email: string) {
  const { POST } = await import("@/app/api/v1/auth/org/email-register/challenge/route");
  return POST(req("/auth/org/email-register/challenge", "", "POST", { ticket, email }));
}
const submitRegistration = async (f: Awaited<ReturnType<typeof pendingEmailRegistration>>, override = {}) =>
  f.emailRegister(req("/auth/org/email-register", "", "POST", { ...f.registration, ...override }));

test("PIN 티켓만으로 이메일을 검증 완료로 선점할 수 없다", async () => {
  const f = await pendingEmailRegistration();
  const res = await f.emailRegister(req("/auth/org/email-register", "", "POST", { ticket: f.ticket, email: f.registration.email }));
  expect(res.status).toBe(422);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(await db.user.findUnique({ where: { email: f.registration.email } })).toBeNull();
  await assertRegistrationRolledBack(f.member.id, f.state.id);
});

test("번호가 티켓·이메일·challenge에 결합되고 잘못된 번호 5회가 영속 제한된다", async () => {
  const f = await pendingEmailRegistration();
  for (const override of [{ email: "different@catchsecu.test" }, { challengeId: randomUUID() }, { ticket: "x".repeat(43) }]) {
    expect((await submitRegistration(f, override)).status).toBeGreaterThanOrEqual(400);
  }
  const wrong = f.registration.code === "000000" ? "111111" : "000000";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await submitRegistration(f, { code: wrong });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe(attempt === 5 ? "ORG_EMAIL_ATTEMPTS_EXCEEDED" : "ORG_EMAIL_CODE_INVALID");
    expect((await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: f.registration.challengeId } })).attempts).toBe(attempt);
  }
  expect((await submitRegistration(f)).status).toBe(422);
  await assertRegistrationRolledBack(f.member.id, f.state.id);
  expect(await db.user.findUnique({ where: { email: f.registration.email } })).toBeNull();
});

test("동시 잘못된 번호 6건도 시도 횟수가 5를 넘지 않는다", async () => {
  const f = await pendingEmailRegistration();
  const wrong = f.registration.code === "000000" ? "111111" : "000000";
  const responses = await Promise.all(Array.from({ length: 6 }, () => submitRegistration(f, { code: wrong })));
  expect(responses.every(response => response.status === 422)).toBe(true);
  expect((await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: f.registration.challengeId } })).attempts).toBe(5);
});

test("재발급은 60초 대기 후 이전 번호와 대기 메일을 무효화한다", async () => {
  const f = await pendingEmailRegistration();
  expect((await requestCode(f.ticket, f.registration.email)).status).toBe(429);
  await db.orgEmailChallenge.update({ where: { id: f.registration.challengeId }, data: { createdAt: new Date(Date.now() - 61000) } });
  const replacement = await emailChallenge(f.ticket, "replacement@catchsecu.test");
  expect((await submitRegistration(f)).status).toBe(422);
  expect((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:org-email:" + f.registration.challengeId } })).status).toBe("cancelled");
  expect((await f.emailRegister(req("/auth/org/email-register", "", "POST", replacement))).status).toBe(200);
  expect(await db.orgEmailChallenge.count({ where: { stateId: f.state.id } })).toBe(0);
});

test("다른 티켓에서 발급된 올바른 번호는 같은 이메일이어도 거절한다", async () => {
  const f = await pendingEmailRegistration();
  const { orgLogin } = await routes();
  const another = await (await orgLogin(req("/auth/org/login", "", "POST", loginBody()))).json();
  const response = await submitRegistration(f, { ticket: another.ticket });
  expect(response.status).toBe(404);
  expect((await submitRegistration(f)).status).toBe(200);
});

test.each(["expired", "audit-expired"])("이메일 번호 %s 상태면 계정·세션·디렉터리를 변경하지 않는다", async kind => {
  const f = await pendingEmailRegistration();
  const challenge = await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: f.registration.challengeId } });
  vi.useFakeTimers({ toFake: ["Date"] });
  const original = auditModule.audit;
  const spy = vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    await original(...args);
    if (kind === "audit-expired" && args[3] === "sso.login") vi.setSystemTime(new Date(challenge.expiresAt.getTime() + 1));
  });
  try {
    if (kind === "expired") vi.setSystemTime(new Date(challenge.expiresAt.getTime() + 1));
    const response = await submitRegistration(f);
    expect(response.status).toBe(kind === "expired" ? 422 : 401);
    await assertRegistrationRolledBack(f.member.id, f.state.id);
    expect(await db.orgEmailChallenge.findUnique({ where: { id: challenge.id } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { email: f.registration.email } })).toBeNull();
  } finally { spy.mockRestore(); vi.useRealTimers(); }
});

test("발송 감사 실패는 challenge와 메일 outbox를 함께 롤백한다", async () => {
  const f = await pendingEmailRegistration();
  await db.orgEmailChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 61000) } });
  const original = auditModule.audit;
  const spy = vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    if (args[3] === "org_auth.email_challenge_requested") throw new Error("TEST_MAIL_AUDIT_FAILURE");
    return original(...args);
  });
  try {
    expect((await requestCode(f.ticket, "rollback@catchsecu.test")).status).toBe(500);
    expect(await db.orgEmailChallenge.count({ where: { stateId: f.state.id } })).toBe(1);
    expect((await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: f.registration.challengeId } })).revokedAt).toBeNull();
    expect(await db.job.count({ where: { tenantId: f.company.id, dedupeKey: { startsWith: "mail:org-email:" } } })).toBe(1);
  } finally { spy.mockRestore(); }
});

test("공급자 링크의 login state에서도 이메일 없는 구성원은 등록 단계로 이어진다", async () => {
  const owner = await ownerCookie(), provider = await makeGpki(owner.cookie);
  const { member } = await addDirectory(owner.cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "링크 신규", pin: "4321" });
  const { startSso, orgLogin, emailRegister } = await routes();
  const started = await startSso(req(`/auth/sso/${provider.id}`));
  const publicState = new URL(started.headers.get("location")!, origin).searchParams.get("state")!;
  const oldState = await db.ssoState.findFirstOrThrow({ where: { providerId: provider.id } });
  const response = await orgLogin(req("/auth/org/login", "", "POST", loginBody({ state: publicState })));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ status: "email-register", protocol: "gpki", expiresAt: oldState.expiresAt.toISOString() });
  expect(result.ticket).not.toBe(publicState);
  const state = await db.ssoState.findUniqueOrThrow({ where: { id: oldState.id } });
  expect(state.orgMemberId).toBe(member.id);
  expect((await orgLogin(req("/auth/org/login", "", "POST", loginBody({ state: publicState })))).status).toBe(401);
  const verified = await emailChallenge(result.ticket, "started-state@catchsecu.test");
  expect((await emailRegister(req("/auth/org/email-register", "", "POST", verified))).status).toBe(200);
});

test.each(["delivered", "expired", "directory-changed", "provider-stopped", "company-closed", "policy-changed"])("인증메일 worker는 %s 상태를 실제 발송 시 재검사한다", async kind => {
  const f = await pendingEmailRegistration();
  const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:org-email:" + f.registration.challengeId } });
  if (kind === "expired") await db.orgEmailChallenge.update({ where: { id: f.registration.challengeId }, data: { expiresAt: new Date(Date.now() - 1), createdAt: new Date(Date.now() - 60000) } });
  if (kind === "directory-changed") await db.virtualOrgMember.update({ where: { id: f.member.id }, data: { version: { increment: 1 } } });
  if (kind === "provider-stopped") await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: false } });
  if (kind === "company-closed") await db.company.update({ where: { id: f.company.id }, data: { status: "closed" } });
  if (kind === "policy-changed") await db.ssoLoginPolicy.create({ data: { tenantId: f.company.id, mode: "GOOGLE" } });
  const { runOneJob } = await import("@/server/jobs");
  expect(await runOneJob("org-email-test", { tenantId: f.company.id, jobId: job.id })).toBe(true);
  const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(current.status).toBe(kind === "delivered" ? "done" : "cancelled");
  if (kind === "delivered" && env.MAIL_TRANSPORT === "local") {
    const { readFile } = await import("node:fs/promises");
    const mail = JSON.parse(await readFile(env.LOCAL_MAIL_DIR + "/" + job.id + ".json", "utf8"));
    expect(mail.to).toBe(f.registration.email);
    expect(mail.text).toContain(f.registration.code);
  }
});

test("인증번호는 평문 DB·응답에 없고 다른 회사 state 연결은 DB에서 거절한다", async () => {
  const f = await pendingEmailRegistration();
  const row = await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: f.registration.challengeId } });
  expect(row.emailCipher).not.toContain(f.registration.email);
  expect(row.codeHash).toHaveLength(64);
  const other = await ownerCookie();
  await expect(db.orgEmailChallenge.create({ data: { ...row, id: randomUUID(), tenantId: other.company.id } })).rejects.toThrow();
  await expect(db.orgEmailChallenge.update({ where: { id: row.id }, data: { attempts: 6 } })).rejects.toThrow();
});

test("다른 Origin에서 인증번호 발송·등록을 요청할 수 없다", async () => {
  const f = await pendingEmailRegistration();
  const { POST } = await import("@/app/api/v1/auth/org/email-register/challenge/route");
  for (const [handler, path, value] of [
    [POST, "/auth/org/email-register/challenge", { ticket: f.ticket, email: f.registration.email }],
    [f.emailRegister, "/auth/org/email-register", f.registration],
  ] as const) {
    const request = req(path, "", "POST", value); request.headers.set("origin", "https://other.test");
    expect((await handler(request)).status).toBe(403);
  }
});

test.each(["accepted", "revoked", "wrong-email"])("초대 state를 이메일 등록으로 전환한 뒤 %s 조건을 다시 검증한다", async kind => {
  const owner = await ownerCookie(), provider = await makeGpki(owner.cookie);
  const { member } = await addDirectory(owner.cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "초대 신규", pin: "4321" });
  const inviter = await db.membership.findFirstOrThrow({ where: { tenantId: owner.company.id, userId: owner.user.id } });
  const token = opaqueToken();
  const invitation = await db.invitation.create({ data: { tenantId: owner.company.id, invitedBy: inviter.id,
    email: "invited@catchsecu.test", role: "viewer", serviceIds: [], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 600000) } });
  const { POST: start } = await import("@/app/api/v1/invitations/sso/start/route");
  const started = await browser.wrap(start)(req("/invitations/sso/start", "", "POST", { token, providerId: provider.id }));
  expect(started.status).toBe(200);
  const state = new URL((await started.json()).redirect, origin).searchParams.get("state")!;
  const { orgLogin, emailRegister } = await routes();
  const logged = await orgLogin(req("/auth/org/login", "", "POST", loginBody({ state })));
  expect(logged.status).toBe(200);
  const ticket = (await logged.json()).ticket;
  const preserved = await db.ssoState.findFirstOrThrow({ where: { orgMemberId: member.id } });
  expect(preserved).toMatchObject({ mode: "invite", invitationId: invitation.id, invitationVersion: invitation.version, invitationTokenHash: invitation.tokenHash });
  const registration = await emailChallenge(ticket, kind === "wrong-email" ? "wrong-invite@catchsecu.test" : invitation.email);
  if (kind === "revoked") await db.invitation.update({ where: { id: invitation.id }, data: { status: "revoked", version: { increment: 1 } } });
  const result = await emailRegister(req("/auth/org/email-register", "", "POST", registration));
  expect(result.status).toBe(kind === "accepted" ? 200 : 410);
  if (kind === "accepted") {
    expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("accepted");
    const user = await db.user.findUniqueOrThrow({ where: { email: invitation.email } });
    expect(await db.membership.count({ where: { tenantId: owner.company.id, userId: user.id } })).toBe(1);
  } else {
    await assertRegistrationRolledBack(member.id, preserved.id);
    expect(await db.user.findUnique({ where: { email: registration.email } })).toBeNull();
  }
});

test("만료 티켓과 재전송 간격 위반은 새 티켓의 구성원 발급 한도를 소모하지 않는다", async () => {
  const f = await pendingEmailRegistration();
  for (let i = 0; i < 3; i++) expect((await requestCode(f.ticket, f.registration.email)).status).toBe(429);
  await db.ssoState.update({ where: { id: f.state.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  for (let i = 0; i < 10; i++) expect((await requestCode(f.ticket, f.registration.email)).status).toBe(401);
  expect((await db.apiRateLimit.findUniqueOrThrow({ where: { key: "org-email-member:" + f.member.id } })).count).toBe(1);
  const { orgLogin } = await routes();
  const fresh = await (await orgLogin(req("/auth/org/login", "", "POST", loginBody()))).json();
  expect((await requestCode(fresh.ticket, f.registration.email)).status).toBe(200);
});

test("이미 연결된 MFA 계정은 이메일 확인 뒤에도 최종 세션 대신 추가 인증을 요구한다", async () => {
  const f = await pendingEmailRegistration();
  await db.account.create({ data: { providerId: "sso:" + f.provider.id, accountId: "urn:virtual:gpki|ORG-1:EMP-1", userId: f.user.id } });
  await db.user.update({ where: { id: f.user.id }, data: { twoFactorEnabled: true } });
  const before = await db.session.count({ where: { userId: f.user.id } });
  const response = await submitRegistration(f);
  expect(response.status).toBe(200);
  expect((await response.json()).redirect).toContain("/login-otp?");
  expect(response.headers.get("set-cookie")).toContain("two_factor=");
  expect(await db.session.count({ where: { userId: f.user.id } })).toBe(before);
  expect(await db.ssoSessionProof.count({ where: { tenantId: f.company.id } })).toBe(0);
  expect(await db.ssoState.count({ where: { id: f.state.id } })).toBe(0);
  expect((await db.virtualOrgMember.findUniqueOrThrow({ where: { id: f.member.id } })).version).toBe(2);
});

test.each(["missing", "other", "duplicate", "legacy"])("E1 이메일 티켓 %s 브라우저는 발급·오답·완료를 바꾸지 못한다", async variant => {
  const f = await pendingEmailRegistration();
  const { POST: issue } = await import("@/app/api/v1/auth/org/email-register/challenge/route");
  const { POST: complete } = await import("@/app/api/v1/auth/org/email-register/route");
  const cookie = variant === "missing" ? "" : variant === "other" ? browser.cookie().split("=", 1)[0] + "=" + "x".repeat(43)
    : variant === "duplicate" ? browser.cookie() + "; " + browser.cookie() : browser.cookie();
  if (variant === "legacy") await db.ssoState.update({ where: { id: f.state.id }, data: { browserHash: null } });
  const before = { jobs: await db.job.count(), audits: await db.auditEvent.count(), sessions: await db.session.count() };
  for (const [handler, path, body] of [
    [issue, "/auth/org/email-register/challenge", { ticket: f.ticket, email: f.registration.email }],
    [complete, "/auth/org/email-register", { ...f.registration, code: "000000" }],
    [complete, "/auth/org/email-register", f.registration],
  ] as const) {
    const response = await handler(new Request(origin + "/api/v1" + path, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(401); expect((await response.json()).error.code).toBe("SSO_BROWSER_MISMATCH");
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  expect((await db.orgEmailChallenge.findUniqueOrThrow({ where: { id: f.registration.challengeId } })).attempts).toBe(0);
  expect({ jobs: await db.job.count(), audits: await db.auditEvent.count(), sessions: await db.session.count() }).toEqual(before);
  await assertRegistrationRolledBack(f.member.id, f.state.id);
});
test.each(["login", "link", "invite"])("E1 조직 %s public state는 다른 브라우저에서 소비·티켓 전환할 수 없다", async mode => {
  const owner = await ownerCookie(), provider = await makeGpki(owner.cookie);
  await addDirectory(owner.cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "브라우저 경계", pin: "4321" });
  const { startSso } = await routes();
  let started: Response;
  if (mode === "invite") {
    const inviter = await db.membership.findFirstOrThrow({ where: { userId: owner.user.id, tenantId: owner.company.id } });
    const token = opaqueToken();
    await db.invitation.create({ data: { tenantId: owner.company.id, invitedBy: inviter.id, tokenHash: tokenHash(token), role: "viewer", email: "binding@catchsecu.test", serviceIds: [], expiresAt: new Date(Date.now() + 600000) } });
    const { POST } = await import("@/app/api/v1/invitations/sso/start/route");
    started = await browser.wrap(POST)(req("/invitations/sso/start", "", "POST", { token, providerId: provider.id }));
  } else started = await startSso(req("/auth/sso/" + provider.id + "?mode=" + mode, owner.cookie));
  expect(started.status).toBe(mode === "invite" ? 200 : 302);
  const body = mode === "invite" ? await started.json() : null;
  if (body) expect(Object.keys(body)).toEqual(["redirect"]);
  const state = new URL(body?.redirect ?? started.headers.get("location")!, origin).searchParams.get("state")!;
  const { POST: rawLogin } = await import("@/app/api/v1/auth/org/login/route");
  const denied = await rawLogin(new Request(origin + "/api/v1/auth/org/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(loginBody({ state })) }));
  expect(denied.status).toBe(401); expect((await denied.json()).error.code).toBe("SSO_BROWSER_MISMATCH");
  expect((await db.ssoState.findFirstOrThrow()).orgMemberId).toBeNull();
});
test("E1 직접 PIN 내부 상태도 명시적 로컬 HTTP 허용 없이는 로그인할 수 없다", async () => {
  const owner = await ownerCookie(), provider = await makeGpki(owner.cookie);
  await addDirectory(owner.cookie, provider.id, { orgCode: "ORG-1", employeeNo: "EMP-1", name: "전송 경계", pin: "4321", email: "transport@catchsecu.test" });
  const { orgLogin: direct } = await import("@/server/org-auth");
  const before = await db.session.count(), previous = env.ALLOW_LOCAL_SSO;
  env.ALLOW_LOCAL_SSO = "0";
  try { await expect(direct({ protocol: "gpki", orgCode: "ORG-1", employeeNo: "EMP-1", pin: "4321" }, new Headers({ origin }))).rejects.toMatchObject({ code: "SSO_HTTPS_REQUIRED" }); }
  finally { env.ALLOW_LOCAL_SSO = previous; }
  expect(await db.session.count()).toBe(before); expect(await db.ssoState.count()).toBe(0);
});
