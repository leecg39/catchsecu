import { beforeEach as beforeSecurityCase } from "vitest";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { signClientIp } from "@/server/client-ip";
import { encrypt } from "@/server/crypto";
import { GET as policyGet, PATCH as policyPatchRoute } from "@/app/api/v1/security/policy/route";
import { GET as ipRulesGet, POST as ipRulesPost, PATCH as ipSettingsPatch } from "@/app/api/v1/security/ip-rules/[[...segments]]/route";
import { GET as membersGet } from "@/app/api/v1/members/route";
import { GET as memberGet, PATCH as memberPatch } from "@/app/api/v1/members/[...segments]/route";
import { GET as contextGet } from "@/app/api/v1/context/route";
import { GET as auditList } from "@/app/api/v1/audit-events/route";
import { POST as ssoCreate } from "@/app/api/v1/security/sso/route";
import { PATCH as ssoPatch } from "@/app/api/v1/security/sso/[id]/route";
import { POST as dirAdd } from "@/app/api/v1/security/sso/[id]/directory/route";
import { POST as orgLogin } from "@/app/api/v1/auth/org/login/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required.");
const origin = env.BETTER_AUTH_URL, key = randomBytes(32).toString("hex"), priorKey = process.env.APP_IP_SIGNING_KEY;
const tenant = randomUUID(), serviceId = randomUUID(), password = "Security-gate!12345";
let owner = "", ownerCookie = "", memberCookie = "", memberId = "", ownerTotp = "";
function request(path: string, method = "GET", cookie = "", value?: unknown, ip = "10.8.0.5", extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    "x-catchsecu-client-ip": ip, "x-catchsecu-ip-proof": signClientIp(ip, key), ...extra,
    ...(value !== undefined ? { "content-type": "application/json" } : {}) },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
const cookieOf = (r: Response) => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
async function signup(email: string, role: string) {
  expect((await auth.handler(request("/auth/sign-up/email", "POST", "", { name: email.split("@")[0], email, password })))).toBeTruthy();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const memberRow = await db.membership.create({ data: { tenantId: tenant, userId: user.id, role: role as "owner" } });
  const signed = await auth.handler(request("/auth/sign-in/email", "POST", "", { email, password }));
  return { id: user.id, memberId: memberRow.id, cookie: cookieOf(signed) };
}
const settingKeys = ["minPassword", "passwordMonths", "passwordReuse", "passwordDeferral", "sessionMinutes",
  "requireMfa", "requireApproval", "approvalRoles", "approvalReferenceRequired", "approvalRequestTemplate",
  "automaticDestruction", "allowRetentionAdjustment", "allowRetentionDesignation", "retentionDays", "activityReviewRetentionDays"] as const;
async function patchPolicy(overrides: Record<string, unknown>, cookie = ownerCookie, pass = password) {
  const current = await (await policyGet(request("/security/policy", "GET", cookie))).json();
  const settings = Object.fromEntries(settingKeys.map(k => [k, current[k]]));
  return policyPatchRoute(request("/security/policy", "PATCH", cookie,
    { tenantId: tenant, version: current.version, password: pass, ...settings, ...overrides }));
}
beforeAll(async () => {
  process.env.APP_IP_SIGNING_KEY = key;
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.create({ data: { id: tenant, name: "보안 게이트 회사", publicName: "게이트", policy: { create: { passwordMonths: 0 } } } });
  await db.service.create({ data: { id: serviceId, tenantId: tenant, name: "게이트 서비스", externalName: "gate" } });
  const o = await signup("sg-owner@test.local", "owner"); owner = o.id; ownerCookie = o.cookie;
  const m = await signup("sg-member@test.local", "admin"); memberId = m.memberId; memberCookie = m.cookie;
  // owner는 2단계 인증을 먼저 등록해야 requireMfa 정책을 켤 수 있다
  const enabled = await auth.handler(request("/auth/two-factor/enable", "POST", ownerCookie, { password }));
  const body = await enabled.json();
  ownerTotp = new TextDecoder().decode(base32.decode(new URL(body.totpURI).searchParams.get("secret")!));
  const code = await createOTP(ownerTotp, { digits: 6, period: 30 }).totp();
  const verified = await auth.handler(request("/auth/two-factor/verify-totp", "POST", "", { code },
    "10.8.0.5", { cookie: cookieOf(enabled) || ownerCookie }));
  expect(verified.status).toBe(200);
  ownerCookie = cookieOf(verified);
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
});
afterAll(async () => {
  if (priorKey === undefined) delete process.env.APP_IP_SIGNING_KEY; else process.env.APP_IP_SIGNING_KEY = priorKey;
  await db.$disconnect();
});

describe("P11-T05 보안 모듈 통합 체인", () => {
  test("정책→로그인→IP→2FA→회수→세션 만료→감사가 하나의 흐름으로 집행된다", async () => {
    // 1) 정책 변경은 owner만 + 현재 비밀번호
    expect((await patchPolicy({ sessionMinutes: 120 }, memberCookie)).status).toBe(403);
    expect((await patchPolicy({ sessionMinutes: 120 }, ownerCookie, "wrong-password")).status).toBe(401);
    const ok = await patchPolicy({ sessionMinutes: 120 });
    expect(ok.status).toBe(200);

    // 2) IP 허용 정책 ON → 허용 대역 밖 요청 차단
    const created = await ipRulesPost(request("/security/ip-rules", "POST", ownerCookie,
      { tenantId: tenant, cidr: "10.8.0.0/16", enabled: true, description: "사내망" }, "10.8.0.5", { "idempotency-key": randomUUID() }));
    expect(created.status).toBe(201);
    const ipPolicy = (await (await ipRulesGet(request("/security/ip-rules", "GET", ownerCookie))).json()).policy;
    expect((await ipSettingsPatch(request("/security/ip-rules/settings", "PATCH", ownerCookie,
      { tenantId: tenant, version: ipPolicy.version, enabled: true, password }))).status).toBe(200);
    expect((await contextGet(request("/context", "GET", memberCookie, undefined, "192.0.2.99"))).status).toBe(403);
    expect((await contextGet(request("/context", "GET", memberCookie, undefined, "10.8.0.7"))).status).toBe(200);
    const ipPolicy2 = (await (await ipRulesGet(request("/security/ip-rules", "GET", ownerCookie))).json()).policy;
    await ipSettingsPatch(request("/security/ip-rules/settings", "PATCH", ownerCookie,
      { tenantId: tenant, version: ipPolicy2.version, enabled: false, password }));

    // 3) 2FA 강제 → 미등록 구성원 MFA_REQUIRED, 예외 부여 시 통과, 예외 만료 시 재차단
    expect((await patchPolicy({ requireMfa: true })).status).toBe(200);
    // /context는 설정 화면 이동을 위해 허용 — requireMfa 플래그만 확인. 능력 게이트 경로는 차단.
    const flagCtx = await (await contextGet(request("/context", "GET", memberCookie))).json();
    expect(flagCtx.requireMfa).toBe(true);
    const denied = await membersGet(request("/members", "GET", memberCookie));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("MFA_REQUIRED");
    const ownerMember = await db.membership.findFirstOrThrow({ where: { tenantId: tenant, userId: owner } });
    await db.mfaException.create({ data: { tenantId: tenant, memberId, createdById: ownerMember.id,
      reasonCipher: encrypt("장애로 2FA 등록 지연"), expiresAt: new Date(Date.now() + 1500) } });
    expect((await membersGet(request("/members", "GET", memberCookie))).status).toBe(200);
    // DB 제약으로 과거 만료를 직접 설정할 수 없으므로 실제 만료 시각까지 대기
    await new Promise(r => setTimeout(r, 1600));
    expect((await membersGet(request("/members", "GET", memberCookie))).status).toBe(403);
    await db.mfaException.delete({ where: { tenantId_memberId: { tenantId: tenant, memberId } } });
    await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
    expect((await patchPolicy({ requireMfa: false })).status).toBe(200);
    expect((await membersGet(request("/members", "GET", memberCookie))).status).toBe(200);

    // 4) 계정 회수: 정지 → 세션 즉시 파기 → 모든 요청 401
    const members = await (await membersGet(request("/members", "GET", ownerCookie))).json();
    const row = members.items.find((r: { id: string }) => r.id === memberId) ?? (await (await memberGet(request("/members/" + memberId, "GET", ownerCookie))).json());
    const suspended = await memberPatch(request("/members/" + memberId, "PATCH", ownerCookie,
      { version: row.version, status: "suspended" }));
    expect(suspended.status).toBe(200);
    expect((await contextGet(request("/context", "GET", memberCookie))).status).toBe(401);

    // 재로그인해도 suspended 멤버십은 컨텍스트 없음 — 회사/권한이 비어 있고 보호 API는 403
    const relogin = await auth.handler(request("/auth/sign-in/email", "POST", "", { email: "sg-member@test.local", password }));
    const reloginCookie = cookieOf(relogin);
    const reloginCtx = await (await contextGet(request("/context", "GET", reloginCookie))).json();
    expect(reloginCtx.company).toBeNull();
    expect(reloginCtx.services).toEqual([]);
    expect(reloginCtx.capabilities).toEqual([]);
    expect((await membersGet(request("/members", "GET", reloginCookie))).status).toBe(403);

    // 5) 세션 정책 만료: owner 세션 updatedAt을 정책 한도 이전으로 되돌림 → 다음 요청 401
    await patchPolicy({ sessionMinutes: 30 });
    const ownerSession = await db.session.findFirstOrThrow({ where: { userId: owner }, orderBy: { updatedAt: "desc" } });
    await db.session.update({ where: { id: ownerSession.id }, data: { updatedAt: new Date(Date.now() - 31 * 60000) } });
    expect((await contextGet(request("/context", "GET", ownerCookie))).status).toBe(401);

    // 6) 감사: 정책 변경·IP 규칙·멤버 상태 변경이 audit 이벤트로 기록됐는지 확인(새 owner 세션, 2FA 단계 포함)
    const freshLogin = await auth.handler(request("/auth/sign-in/email", "POST", "", { email: "sg-owner@test.local", password }));
    const otp = await createOTP(ownerTotp, { digits: 6, period: 30 }).totp();
    const verifiedLogin = await auth.handler(request("/auth/two-factor/verify-totp", "POST", "", { code: otp },
      "10.8.0.5", { cookie: cookieOf(freshLogin) }));
    expect(verifiedLogin.status).toBe(200);
    const freshCookie = cookieOf(verifiedLogin);
    const eventsRes = await auditList(request("/audit-events?pageSize=100", "GET", freshCookie));
    expect(eventsRes.status).toBe(200);
    const events = await eventsRes.json();
    const actions = events.items.map((e: { action: string }) => e.action);
    expect(actions).toContain("policy.updated");
    expect(actions.some((a: string) => a.startsWith("member."))).toBe(true);
    // IP 허용 정책 변경 자체도 감사에 남는지 확인
    const ipEvents = await db.auditEvent.findMany({ where: { tenantId: tenant, action: { contains: "ip" } }, select: { action: true } });
    expect(ipEvents.length).toBeGreaterThan(0);
    expect(events.total).toBeGreaterThan(0);
  });

  test("SSO(가상 어댑터) 단계: 디렉터리 로그인→JIT→구성원 정지→세션 파기→감사가 같은 체인에서 집행된다", async () => {
    // 이전 단계에서 owner 세션이 정책 만료로 파기됐으므로 2FA 포함 재로그인으로 새 세션을 얻는다.
    const relogin = await auth.handler(request("/auth/sign-in/email", "POST", "", { email: "sg-owner@test.local", password }));
    const otp = await createOTP(ownerTotp, { digits: 6, period: 30 }).totp();
    const verifiedLogin = await auth.handler(request("/auth/two-factor/verify-totp", "POST", "", { code: otp },
      "10.8.0.5", { cookie: cookieOf(relogin) }));
    expect(verifiedLogin.status).toBe(200);
    const gateCookie = cookieOf(verifiedLogin);

    // 1) owner가 가상 GPKI 공급자를 등록·활성화하고 디렉터리 구성원을 추가한다.
    const created = await ssoCreate(request("/security/sso", "POST", gateCookie,
      { tenantId: tenant, protocol: "gpki", name: "게이트 가상 GPKI" }, "10.8.0.5", { "idempotency-key": randomUUID() }));
    expect(created.status).toBe(201);
    const provider = await created.json();
    const enabled = await ssoPatch(request(`/security/sso/${provider.id}`, "PATCH", gateCookie, { version: provider.version, enabled: true }));
    expect((await enabled.json()).enabled).toBe(true);
    const member = await dirAdd(request(`/security/sso/${provider.id}/directory`, "POST", gateCookie,
      { orgCode: "GATE-ORG", employeeNo: "EMP-7", name: "게이트 직원", email: "sg-org@test.local", pin: "4321" }, "10.8.0.5", { "idempotency-key": randomUUID() }));
    expect(member.status).toBe(201);

    // 2) 디렉터리 자격으로 로그인 → completeSso 실경로로 JIT viewer 소속+세션 발급
    const login = await orgLogin(request("/auth/org/login", "POST", "",
      { protocol: "gpki", orgCode: "GATE-ORG", employeeNo: "EMP-7", pin: "4321" }));
    expect(login.status).toBe(200);
    const orgCookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const orgUser = await db.user.findUniqueOrThrow({ where: { email: "sg-org@test.local" } });
    const orgMember = await db.membership.findFirstOrThrow({ where: { tenantId: tenant, userId: orgUser.id } });
    expect(orgMember.role).toBe("viewer");
    const orgCtx = await (await contextGet(request("/context", "GET", orgCookie))).json();
    expect(orgCtx.company?.id).toBe(tenant);

    // 3) owner가 JIT 구성원을 정지 → SSO 세션도 즉시 파기되고 보호 경로가 차단된다
    const suspended = await memberPatch(request("/members/" + orgMember.id, "PATCH", gateCookie,
      { version: orgMember.version, status: "suspended" }));
    expect(suspended.status).toBe(200);
    expect((await contextGet(request("/context", "GET", orgCookie))).status).toBe(401);

    // 4) 디렉터리 재로그인은 자격은 통과하지만 소속 해제로 SSO_MEMBERSHIP_REQUIRED
    const retry = await orgLogin(request("/auth/org/login", "POST", "",
      { protocol: "gpki", orgCode: "GATE-ORG", employeeNo: "EMP-7", pin: "4321" }));
    expect(retry.status).toBe(403);

    // 5) 감사: SSO 계정 연결·구성원 상태 변경 이벤트가 남는다
    const audit = await db.auditEvent.findMany({ where: { tenantId: tenant,
      action: { in: ["sso.account_linked", "org_auth.failed", "member.status_changed"] } }, select: { action: true } });
    expect(audit.map(a => a.action)).toContain("sso.account_linked");
  });
});

beforeSecurityCase(grantSecurityTestTrials);
