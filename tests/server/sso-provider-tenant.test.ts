import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { env } from "@/server/env";
import { GET as list, POST as create } from "@/app/api/v1/security/sso/route";
import { PATCH as patch } from "@/app/api/v1/security/sso/[id]/route";
import { POST as selectCompany } from "@/app/api/v1/context/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function fixture() {
  const email = "tenant-" + randomUUID() + "@example.test", password = "Tenant-QA!" + randomUUID();
  await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "회사 전환 QA", email, password }));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const companies = await Promise.all(["A", "B"].map(name => db.company.create({ data: { name, publicName: name,
    policy: { create: { passwordMonths: 0 } }, memberships: { create: { userId: user.id, role: "owner" } } } })));
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(v => v.split(";", 1)[0]).join("; ");
  expect((await selectCompany(req("/context", cookie, "POST", { companyId: companies[0].id }))).status).toBe(200);
  return { user, a: companies[0], b: companies[1], cookie };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SsoProvider" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("E4 공급자 목록은 실제 조회 회사 ID를 반환한다", async () => {
  const f = await fixture();
  expect(await (await list(req("/security/sso", f.cookie))).json()).toMatchObject({ tenantId: f.a.id, items: [] });
  await selectCompany(req("/context", f.cookie, "POST", { companyId: f.b.id }));
  expect(await (await list(req("/security/sso", f.cookie))).json()).toMatchObject({ tenantId: f.b.id, items: [] });
});
test("E4 회사가 명시되지 않은 생성 요청은 현재 회사로 추측하지 않는다", async () => {
  const f = await fixture();
  await selectCompany(req("/context", f.cookie, "POST", { companyId: f.b.id }));
  const response = await create(req("/security/sso", f.cookie, "POST", { protocol: "gpki", name: "A에서 작성한 입력" }, randomUUID()));
  expect(response.status).toBe(422);
  expect(await db.ssoProvider.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "sso.provider_created" } })).toBe(0);
});
test("E4 A 화면 입력 후 공유 세션이 B로 전환되면 어느 회사에도 생성하지 않는다", async () => {
  const f = await fixture(); await selectCompany(req("/context", f.cookie, "POST", { companyId: f.b.id }));
  const response = await create(req("/security/sso", f.cookie, "POST", { tenantId: f.a.id, protocol: "gpki", name: "A 입력" }, randomUUID()));
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("COMPANY_CHANGED");
  expect(await db.ssoProvider.count()).toBe(0);
  expect(await db.idempotencyRecord.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "sso.provider_created" } })).toBe(0);
});
test("E4 생성 재전송도 화면 회사를 확인하고 원래 회사로 복귀하면 기존 행을 반환한다", async () => {
  const f = await fixture(), key = randomUUID(), input = { tenantId: f.a.id, protocol: "gpki", name: "A 공급자" };
  const first = await create(req("/security/sso", f.cookie, "POST", input, key)); expect(first.status).toBe(201);
  const provider = await first.json(); await selectCompany(req("/context", f.cookie, "POST", { companyId: f.b.id }));
  const retry = await create(req("/security/sso", f.cookie, "POST", input, key)); expect(retry.status).toBe(403);
  expect((await retry.json()).error.code).toBe("COMPANY_CHANGED");
  await selectCompany(req("/context", f.cookie, "POST", { companyId: f.a.id }));
  const restored = await create(req("/security/sso", f.cookie, "POST", input, key)); expect(restored.status).toBe(201);
  expect((await restored.json()).id).toBe(provider.id);
  expect(await db.ssoProvider.count()).toBe(1);
  expect(await db.auditEvent.count({ where: { action: "sso.provider_created" } })).toBe(1);
});
test("E4 수정은 요청 회사와 현재 회사 불일치를 거절하고 기존 행을 보존한다", async () => {
  const f = await fixture();
  const provider = await db.ssoProvider.create({ data: { tenantId: f.a.id, name: "원래 이름", protocol: "gpki", issuer: "urn:virtual:gpki", clientId: "virtual:gpki", authorizationUrl: "", preflightOk: true } });
  const response = await patch(req("/security/sso/" + provider.id, f.cookie, "PATCH", { tenantId: f.b.id, version: 1, name: "틀린 회사 입력" }));
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("COMPANY_CHANGED");
  expect(await db.ssoProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ name: "원래 이름", version: 1 });
});
