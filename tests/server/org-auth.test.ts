import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto";
import { env } from "@/server/env";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Org-owner!12345";

function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function ownerCookie(email = "org-" + randomUUID() + "@catchsecu.test") {
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "소유자", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "조직 인증 회사", publicName: "ORG", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } } } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  return { cookie: login.headers.getSetCookie().map(v => v.split(";")[0]).join("; "), company, user };
}
beforeEach(async () => {
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
  return { createProvider, listProviders, patchProvider, listDirectory, addMember, removeMember, orgLogin, emailRegister, startSso };
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
  expect(first.headers.get("set-cookie")).toBeNull();
  // 잘못된 티켓·이메일 형식 거부
  expect((await emailRegister(req("/auth/org/email-register", "", "POST", { ticket: "x".repeat(43), email: "a@b.test" }))).status).toBeGreaterThanOrEqual(400);
  const done = await emailRegister(req("/auth/org/email-register", "", "POST", { ticket: body.ticket, email: "new@catchsecu.test" }));
  expect(done.status).toBe(200);
  expect((await done.json()).status).toBe("verified");
  expect(done.headers.get("set-cookie")).toContain("better-auth.session_token=");
  const member = await db.virtualOrgMember.findFirstOrThrow();
  expect(decrypt<string>(member.emailCipher!)).toBe("new@catchsecu.test");
  // 티켓 재사용 차단 — state가 소비됐다
  const replay = await emailRegister(req("/auth/org/email-register", "", "POST", { ticket: body.ticket, email: "other@catchsecu.test" }));
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
  const { listDirectory, addMember, removeMember } = await routes();
  for (const attempt of [
    () => listDirectory(req(`/security/sso/${provider.id}/directory`, other.cookie)),
    () => addMember(req(`/security/sso/${provider.id}/directory`, other.cookie, "POST", { orgCode: "XX", employeeNo: "YY", name: "n", pin: "1234" }, randomUUID())),
  ]) expect((await attempt()).status).toBe(404);
  // 공급자 비활성화 → 로그인 거부
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: false } });
  const { orgLogin } = await routes();
  expect((await orgLogin(req("/auth/org/login", "", "POST", loginBody()))).status).toBe(404);
});
