import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";
import * as auditModule from "@/server/audit";
import { GET as providers, POST as createProvider } from "@/app/api/v1/security/sso/route";
import { DELETE as deleteProvider } from "@/app/api/v1/security/sso/[id]/route";
import { GET as directory, POST as addMember } from "@/app/api/v1/security/sso/[id]/directory/route";
import * as memberRoutes from "@/app/api/v1/security/sso/[id]/directory/[memberId]/route";
import { POST as login } from "@/app/api/v1/auth/org/login/route";
import { POST as registerEmail } from "@/app/api/v1/auth/org/email-register/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const fixtureCompanies = new Map<string, string>();
function request(path: string, cookie: string, method = "GET", input?: unknown, key?: string) {
  if (path === "/security/sso" && method === "POST" && input && typeof input === "object") input = { tenantId: fixtureCompanies.get(cookie), ...input };
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function owner() {
  const email = `sso-crud-${randomUUID()}@catchsecu.test`, password = "Sso-crud-owner!12345";
  await auth.handler(request("/auth/sign-up/email", "", "POST", { name: "SSO 소유자", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "SSO CRUD 회사", publicName: "SSO",
    policy: { create: {} }, memberships: { create: { userId: user.id, role: "owner" } } } });
  const signed = await auth.handler(request("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  fixtureCompanies.set(cookie, company.id);
  return { user, company, cookie };
}
async function keepAnotherOwner(tenantId: string) {
  const user = await db.user.create({ data: { email: `remaining-owner-${randomUUID()}@catchsecu.test`, name: "남은 소유자", emailVerified: true } });
  await db.membership.create({ data: { tenantId, userId: user.id, role: "owner" } });
}
const providerInput = { protocol: "gpki", name: "가상 기관 시험" };
const input = { orgCode: "ORG-CRUD", employeeNo: "EMP-001", name: "처음 이름", pin: "4321" };
async function fixture() {
  const actor = await owner();
  const response = await createProvider(request("/security/sso", actor.cookie, "POST", providerInput, randomUUID()));
  expect(response.status).toBe(201);
  const provider = await response.json();
  await db.ssoProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  const path = `/security/sso/${provider.id}/directory`;
  const added = await addMember(request(path, actor.cookie, "POST", input, randomUUID()));
  expect(added.status).toBe(201);
  return { ...actor, provider, path, member: await added.json() };
}
function patch(path: string, cookie: string, value: unknown) {
  // This guard makes the initial red result explain the absent operation.
  const handler = (memberRoutes as Record<string, (r: Request) => Promise<Response>>).PATCH;
  expect(handler, "Directory update handler must exist").toBeTypeOf("function");
  return handler(request(path, cookie, "PATCH", value));
}
beforeEach(async () => { fixtureCompanies.clear(); await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SsoProvider" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("공급자 생성의 같은 키 동시 재시도는 한 공급자·한 감사이고 현재 DTO를 재조회한다", async () => {
  const actor = await owner(), key = randomUUID();
  const responses = await Promise.all(Array.from({ length: 2 }, () => createProvider(request("/security/sso", actor.cookie, "POST", providerInput, key))));
  expect(responses.map(row => row.status)).toEqual([201, 201]);
  const [first, second] = await Promise.all(responses.map(row => row.json()));
  expect(first.id).toBe(second.id);
  expect(await db.ssoProvider.count()).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "sso.provider_created" } })).toBe(1);
  await db.ssoProvider.update({ where: { id: first.id }, data: { name: "변경된 공급자", version: { increment: 1 } } });
  const replay = await createProvider(request("/security/sso", actor.cookie, "POST", providerInput, key));
  expect(await replay.json()).toMatchObject({ id: first.id, name: "변경된 공급자", version: 2 });
  expect((await createProvider(request("/security/sso", actor.cookie, "POST", { ...providerInput, name: "다른 요청" }, key))).status).toBe(409);
});

test("공급자 삭제 후 생성 키는 복구하지 않으며 현재 권한을 다시 검사한다", async () => {
  const actor = await owner(), key = randomUUID();
  const first = await (await createProvider(request("/security/sso", actor.cookie, "POST", providerInput, key))).json();
  const removed = await deleteProvider(request(`/security/sso/${first.id}`, actor.cookie, "DELETE", { version: first.version }));
  expect(removed.status).toBe(200);
  expect((await createProvider(request("/security/sso", actor.cookie, "POST", providerInput, key))).status).toBe(410);
  expect(await db.ssoProvider.count()).toBe(0);
  await keepAnotherOwner(actor.company.id);
  await db.membership.updateMany({ where: { userId: actor.user.id }, data: { role: "security" } });
  expect((await createProvider(request("/security/sso", actor.cookie, "POST", providerInput, key))).status).toBe(403);
});

test("디렉터리 생성 키는 중복 감사 방지·내용 충돌·최신 DTO·삭제 후 만료를 지킨다", async () => {
  const f = await fixture(), key = randomUUID(), payload = { ...input, employeeNo: "EMP-002" };
  const responses = await Promise.all([0, 1].map(() => addMember(request(f.path, f.cookie, "POST", payload, key))));
  expect(responses.map(row => row.status)).toEqual([201, 201]);
  const [first, second] = await Promise.all(responses.map(row => row.json()));
  expect(first.id).toBe(second.id);
  expect(await db.auditEvent.count({ where: { action: "org_auth.member_added", resourceId: first.id } })).toBe(1);
  expect((await addMember(request(f.path, f.cookie, "POST", { ...payload, name: "다른 요청" }, key))).status).toBe(409);
  const updated = await patch(`${f.path}/${first.id}`, f.cookie, { version: first.version, name: "새 이름" });
  expect(updated.status).toBe(200);
  expect(await (await addMember(request(f.path, f.cookie, "POST", payload, key))).json()).toMatchObject({ name: "새 이름", version: 2 });
  expect((await memberRoutes.DELETE(request(`${f.path}/${first.id}`, f.cookie, "DELETE", { version: 2 }))).status).toBe(200);
  expect((await addMember(request(f.path, f.cookie, "POST", payload, key))).status).toBe(410);
  const cached = await db.idempotencyRecord.findFirstOrThrow({ where: { resourceId: first.id } });
  expect(cached.responseCipher).toBeNull(); expect(cached.invalidatedAt).not.toBeNull();
});

test("디렉터리 수정은 조직 식별자를 유지하고 이름·이메일·PIN만 변경하며 이전 PIN을 거부한다", async () => {
  const f = await fixture();
  const response = await patch(`${f.path}/${f.member.id}`, f.cookie, { version: 1, name: "새 이름", email: "NEW@catchsecu.test", pin: "9876" });
  expect(response.status).toBe(200);
  const value = await response.json();
  expect(value).toMatchObject({ orgCode: input.orgCode, employeeNo: input.employeeNo, name: "새 이름", email: "new@catchsecu.test", version: 2 });
  expect(JSON.stringify(value)).not.toMatch(/9876|pinHash|Cipher/);
  const row = await db.virtualOrgMember.findUniqueOrThrow({ where: { id: f.member.id } });
  expect(row.nameCipher).not.toContain("새 이름"); expect(decrypt(row.nameCipher)).toBe("새 이름");
  const authBody = { protocol: "gpki", orgCode: input.orgCode, employeeNo: input.employeeNo, pin: input.pin };
  expect((await login(request("/auth/org/login", "", "POST", authBody))).status).toBe(401);
  expect((await login(request("/auth/org/login", "", "POST", { ...authBody, pin: "9876" }))).status).toBe(200);
});

test("수정으로 이미 연결된 사용자 이메일·계정·기존 세션은 바뀌지 않는다", async () => {
  const f = await fixture();
  await patch(`${f.path}/${f.member.id}`, f.cookie, { version: 1, email: "linked@catchsecu.test" });
  expect((await login(request("/auth/org/login", "", "POST", { protocol: "gpki", orgCode: input.orgCode, employeeNo: input.employeeNo, pin: input.pin }))).status).toBe(200);
  const linked = await db.user.findUniqueOrThrow({ where: { email: "linked@catchsecu.test" } });
  const before = await db.session.findMany({ where: { userId: linked.id } });
  expect((await patch(`${f.path}/${f.member.id}`, f.cookie, { version: 2, email: "directory@catchsecu.test", name: "디렉터리만 변경" })).status).toBe(200);
  expect(await db.user.findUniqueOrThrow({ where: { id: linked.id } })).toMatchObject({ email: "linked@catchsecu.test", name: input.name });
  expect(await db.session.findMany({ where: { userId: linked.id } })).toEqual(before);
  expect(await db.account.count({ where: { userId: linked.id, providerId: "sso:" + f.provider.id } })).toBe(1);
});

test.each(["update", "delete"])("%s가 대기 이메일 티켓을 무효화한다", async action => {
  const f = await fixture();
  const pending = await (await login(request("/auth/org/login", "", "POST", { protocol: "gpki", orgCode: input.orgCode, employeeNo: input.employeeNo, pin: input.pin }))).json();
  expect(pending.status).toBe("email-register");
  const changed = action === "update" ? await patch(`${f.path}/${f.member.id}`, f.cookie, { version: 1, name: "관리자 수정" })
    : await memberRoutes.DELETE(request(`${f.path}/${f.member.id}`, f.cookie, "DELETE", { version: 1 }));
  expect(changed.status).toBe(200);
  expect(await db.ssoState.count({ where: { orgMemberId: f.member.id } })).toBe(0);
  expect((await registerEmail(request("/auth/org/email-register", "", "POST", { ticket: pending.ticket, email: "stale@catchsecu.test", challengeId: randomUUID(), code: "000000" }))).status).toBe(401);
  expect(await db.user.findUnique({ where: { email: "stale@catchsecu.test" } })).toBeNull();
});

test("디렉터리 version 충돌·동시 수정은 한 번만 저장하고 변경 없는 patch는 거부한다", async () => {
  const f = await fixture(), path = `${f.path}/${f.member.id}`;
  const responses = await Promise.all(["수정 A", "수정 B"].map(name => patch(path, f.cookie, { version: 1, name })));
  expect(responses.map(row => row.status).sort()).toEqual([200, 409]);
  expect(await db.auditEvent.count({ where: { action: "org_auth.member_updated", resourceId: f.member.id } })).toBe(1);
  for (const body of [{ version: 2 }, { version: 2, orgCode: "CHANGED" }, { version: 2, employeeNo: "CHANGED" }, { version: 2, pin: "123" }, { version: 2, email: "invalid" }]) {
    expect((await patch(path, f.cookie, body)).status).toBe(422);
  }
  expect((await patch(path, f.cookie, { version: 2, email: null })).status).toBe(200);
});

test.each(["admin", "security"] as const)("%s는 읽기만 가능하고 공급자·디렉터리 쓰기는 owner로 제한한다", async role => {
  const f = await fixture();
  await keepAnotherOwner(f.company.id);
  await db.membership.updateMany({ where: { userId: f.user.id }, data: { role } });
  expect(await (await providers(request("/security/sso", f.cookie))).json()).toMatchObject({ canManage: false });
  expect(await (await directory(request(f.path, f.cookie))).json()).toMatchObject({ canManage: false });
  expect((await addMember(request(f.path, f.cookie, "POST", { ...input, employeeNo: "EMP-002" }, randomUUID()))).status).toBe(403);
  expect((await patch(`${f.path}/${f.member.id}`, f.cookie, { version: 1, name: "거부" })).status).toBe(403);
  expect((await memberRoutes.DELETE(request(`${f.path}/${f.member.id}`, f.cookie, "DELETE", { version: 1 }))).status).toBe(403);
});

test("다른 회사와 다른 공급자의 구성원 PATCH는 404이고 소유자 목록은 canManage=true다", async () => {
  const f = await fixture(), other = await owner();
  expect(await (await providers(request("/security/sso", f.cookie))).json()).toMatchObject({ canManage: true });
  expect(await (await directory(request(f.path, f.cookie))).json()).toMatchObject({ canManage: true });
  expect((await patch(`${f.path}/${f.member.id}`, other.cookie, { version: 1, name: "거부" })).status).toBe(404);
  const second = await (await createProvider(request("/security/sso", f.cookie, "POST", { ...providerInput, name: "다른 공급자" }))).json();
  expect((await patch(`/security/sso/${second.id}/directory/${f.member.id}`, f.cookie, { version: 1, name: "거부" })).status).toBe(404);
});

test("수정 감사 실패는 디렉터리 버전과 대기 티켓 정리를 함께 롤백한다", async () => {
  const f = await fixture();
  await login(request("/auth/org/login", "", "POST", { protocol: "gpki", orgCode: input.orgCode, employeeNo: input.employeeNo, pin: input.pin }));
  const original = auditModule.audit;
  const spy = vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    if (args[3] === "org_auth.member_updated") throw new Error("TEST_DIRECTORY_AUDIT_FAILED");
    return original(...args);
  });
  try {
    expect((await patch(`${f.path}/${f.member.id}`, f.cookie, { version: 1, name: "롤백 대상" })).status).toBe(500);
    expect(await db.virtualOrgMember.findUniqueOrThrow({ where: { id: f.member.id } })).toMatchObject({ version: 1 });
    expect(await db.ssoState.count({ where: { orgMemberId: f.member.id } })).toBe(1);
  } finally { spy.mockRestore(); }
});

test("생성 키의 형식을 검사하고 캐시 재조회에서도 현재 owner 권한을 요구한다", async () => {
  const f = await fixture(), key = randomUUID(), payload = { ...input, employeeNo: "REPLAY-OWNER" };
  expect((await createProvider(request("/security/sso", f.cookie, "POST", providerInput, "short"))).status).toBe(400);
  expect((await addMember(request(f.path, f.cookie, "POST", payload, "short"))).status).toBe(400);
  expect((await addMember(request(f.path, f.cookie, "POST", payload, key))).status).toBe(201);
  await keepAnotherOwner(f.company.id);
  await db.membership.updateMany({ where: { userId: f.user.id }, data: { role: "security" } });
  expect((await addMember(request(f.path, f.cookie, "POST", payload, key))).status).toBe(403);
  expect(await db.virtualOrgMember.count()).toBe(2);
});

test.each(["provider", "member"])("%s 생성 감사 실패는 생성 행과 재시도 캐시를 원자 롤백한다", async kind => {
  const f = await fixture(), key = randomUUID(), payload = { ...input, employeeNo: "AUDIT-ROLLBACK" };
  const send = () => kind === "provider" ? createProvider(request("/security/sso", f.cookie, "POST", providerInput, key))
    : addMember(request(f.path, f.cookie, "POST", payload, key));
  const original = auditModule.audit;
  const action = kind === "provider" ? "sso.provider_created" : "org_auth.member_added";
  const spy = vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    if (args[3] === action) throw new Error("TEST_CREATE_AUDIT_FAILED");
    return original(...args);
  });
  try {
    expect((await send()).status).toBe(500);
    expect(await db.ssoProvider.count()).toBe(1); expect(await db.virtualOrgMember.count()).toBe(1);
    expect(await db.idempotencyRecord.count({ where: { key } })).toBe(0);
  } finally { spy.mockRestore(); }
  expect((await send()).status).toBe(201);
  expect(await db.idempotencyRecord.count({ where: { key } })).toBe(1);
});

test("공급자 삭제는 디렉터리와 두 종류 생성 캐시의 응답을 함께 폐기한다", async () => {
  const f = await fixture();
  expect((await deleteProvider(request(`/security/sso/${f.provider.id}`, f.cookie, "DELETE", { version: 1 }))).status).toBe(200);
  expect(await db.virtualOrgMember.count()).toBe(0);
  const records = await db.idempotencyRecord.findMany({ where: { resourceId: { in: [f.provider.id, f.member.id] } } });
  expect(records).toHaveLength(2);
  for (const record of records) { expect(record.responseCipher).toBeNull(); expect(record.requestHash).toBeNull(); expect(record.invalidatedAt).not.toBeNull(); }
});

test.each(["update", "delete", "provider-disable", "company-close"])("로그인 스냅샷 이후 %s가 먼저 커밋하면 폐기된 이메일 티켓이 다시 생성되지 않는다", async action => {
  const f = await fixture();
  let snapshotReady!: () => void, resume!: () => void;
  const ready = new Promise<void>(resolve => { snapshotReady = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const original = db.virtualOrgMember.findUnique.bind(db.virtualOrgMember);
  const spy = vi.spyOn(db.virtualOrgMember, "findUnique").mockImplementationOnce(args => original(args).then(async row => {
    snapshotReady(); await gate; return row;
  }) as ReturnType<typeof original>);
  const pending = login(request("/auth/org/login", "", "POST", { protocol: "gpki", orgCode: input.orgCode, employeeNo: input.employeeNo, pin: input.pin }));
  try {
    await ready;
    if (action === "update") expect((await patch(`${f.path}/${f.member.id}`, f.cookie, { version: 1, name: "발급 전 수정" })).status).toBe(200);
    else if (action === "delete") expect((await memberRoutes.DELETE(request(`${f.path}/${f.member.id}`, f.cookie, "DELETE", { version: 1 }))).status).toBe(200);
    else if (action === "provider-disable") await db.ssoProvider.update({ where: { id: f.provider.id }, data: { enabled: false, version: { increment: 1 } } });
    else await db.company.update({ where: { id: f.company.id }, data: { status: "closed" } });
    resume();
    const response = await pending;
    expect(response.status).toBe(action === "delete" ? 401 : action === "company-close" ? 403 : 409);
    expect(await db.ssoState.count({ where: { orgMemberId: f.member.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "org_auth.email_register_required", resourceId: f.member.id } })).toBe(0);
  } finally { resume(); await pending; spy.mockRestore(); }
});

test("이메일 등록 필요 감사가 실패하면 티켓도 생성하지 않고 같은 자격으로 다시 시작할 수 있다", async () => {
  const f = await fixture(), original = auditModule.audit;
  const send = () => login(request("/auth/org/login", "", "POST", { protocol: "gpki", orgCode: input.orgCode, employeeNo: input.employeeNo, pin: input.pin }));
  const spy = vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    if (args[3] === "org_auth.email_register_required") throw new Error("TEST_TICKET_AUDIT_FAILED");
    return original(...args);
  });
  try { expect((await send()).status).toBe(500); expect(await db.ssoState.count({ where: { orgMemberId: f.member.id } })).toBe(0); }
  finally { spy.mockRestore(); }
  expect((await send()).status).toBe(200); expect(await db.ssoState.count({ where: { orgMemberId: f.member.id } })).toBe(1);
});
