import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireActor } from "@/server/context";
import { adminPlanCreate } from "@/contracts/admin-plans";
import { createAdminPlan, readAdminPlan, listAdminPlans, updateAdminPlan, archiveAdminPlan } from "@/server/admin-plans";
import * as auditModule from "@/server/audit";
import { GET as listPlansRoute, POST as createPlanRoute } from "@/app/api/v1/admin/plans/route";
import {
  DELETE as deletePlanRoute,
  GET as readPlanRoute,
  PATCH as updatePlanRoute,
} from "@/app/api/v1/admin/plans/[id]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (!["/catchsecu_test", "/catchsecu_mock_admin"].includes(database.pathname) || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Admin-plan-test!123";
const input = (version = {}) => ({ id: "mock-" + randomUUID(), name: "모의 상품", version: { number: 1, cycle: "month", priceKrw: 12000, ...version } });
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => { await db.$disconnect(); });
async function adminSession() {
  const email = "admin-" + randomUUID() + "@catchsecu.test";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  await auth.handler(request("sign-up/email", { email, password, name: "운영자" }));
  await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin: true } });
  const login = await auth.handler(request("sign-in/email", { email, password }));
  const cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  return { actor: await requireActor(new Headers({ cookie })), cookie };
}
async function actor() { return (await adminSession()).actor; }
function routeRequest(path: string, method: string, cookie: string, value?: unknown) {
  return new Request(origin + "/api/v1/admin/plans" + path, {
    method,
    headers: { origin, cookie, ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

test.each([{ currency: "USD" }, { priceKrw: 2147483648 }, { orderable: true, priceKrw: null }])("DB가 수용하지 않는 상품 계약을 입력 단계에서 거부한다: %j", version => {
  expect(adminPlanCreate.safeParse(input(version)).success).toBe(false);
});
test("0개 한도는 유효한 비활성 기능 한도이다", () => {
  expect(adminPlanCreate.safeParse(input({ serviceLimit: 0 })).success).toBe(true);
});
test("현재 시점보다 과거인 종료일은 422이고 생성 전체가 롤백된다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input({ effectiveTo: "2000-01-01T00:00:00.000Z" }));
  await expect(createAdminPlan(a, parsed, randomUUID())).rejects.toMatchObject({ status: 422, code: "INVALID_PERIOD" });
  expect(await db.billingPlan.findUnique({ where: { id: parsed.id } })).toBeNull();
});
test("미판매·미사용 상품 CRUD 및 버전 삭제가 가능하고 감사가 남는다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input());
  expect((await createAdminPlan(a, parsed, randomUUID())).status).toBe(201);
  expect((await readAdminPlan(a, parsed.id)).versions).toHaveLength(1);
  expect((await updateAdminPlan(a, parsed.id, { name: "변경됨" }, randomUUID())).name).toBe("변경됨");
  expect((await listAdminPlans(a)).items.some(p => p.id === parsed.id)).toBe(true);
  await archiveAdminPlan(a, parsed.id, randomUUID());
  expect(await db.billingPlan.findUnique({ where: { id: parsed.id } })).toBeNull();
  expect(await db.auditEvent.count({ where: { resourceId: parsed.id, action: "plan.deleted" } })).toBe(1);
});
test("운영자 권한 회수 후 이전 actor로 상품을 변경하거나 조회할 수 없다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input());
  await createAdminPlan(a, parsed, randomUUID());
  await db.user.update({ where: { id: a.user.id }, data: { platformAdmin: false } });
  for (const call of [() => listAdminPlans(a), () => readAdminPlan(a, parsed.id), () => createAdminPlan(a, adminPlanCreate.parse(input()), randomUUID()), () => updateAdminPlan(a, parsed.id, { name: "탈취" }, randomUUID()), () => archiveAdminPlan(a, parsed.id, randomUUID())])
    await expect(call()).rejects.toMatchObject({ status: 403 });
});
test("같은 식별자 상품 동시 생성은 하나만 성공하고 나머지는 409이다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input());
  const results = await Promise.allSettled([createAdminPlan(a, parsed, randomUUID()), createAdminPlan(a, parsed, randomUUID())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409, code: "PLAN_EXISTS" } });
});
test("감사 실패는 상품과 버전을 함께 롤백하고 서버 오류를 충돌로 숨기지 않는다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input());
  vi.spyOn(auditModule, "audit").mockRejectedValue(new Error("audit unavailable"));
  await expect(createAdminPlan(a, parsed, randomUUID())).rejects.toThrow("audit unavailable");
  expect(await db.billingPlan.findUnique({ where: { id: parsed.id } })).toBeNull();
});
test("주문 가능한 버전의 삭제와 모든 가격 UPDATE는 DB에서도 차단한다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input({ orderable: true }));
  const created = await createAdminPlan(a, parsed, randomUUID());
  await expect(archiveAdminPlan(a, parsed.id, randomUUID())).rejects.toMatchObject({ status: 409, code: "PLAN_ORDERABLE" });
  await expect(db.billingPlanVersion.delete({ where: { id: created.body.versions[0].id } })).rejects.toThrow();
  await expect(db.billingPlanVersion.update({ where: { id: created.body.versions[0].id }, data: { priceKrw: 1 } })).rejects.toThrow();
});

test("미판매 버전도 과거 취소 구독이 참조하면 삭제를 거부한다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input());
  const created = await createAdminPlan(a, parsed, randomUUID());
  const company = await db.company.create({ data: { name: "참조 보호", publicName: "참조 보호" } });
  await db.billingSubscription.create({ data: { tenantId: company.id, planId: parsed.id, planVersionId: created.body.versions[0].id, status: "cancelled", priceKrw: 12000, currency: "KRW" } });
  await expect(archiveAdminPlan(a, parsed.id, randomUUID())).rejects.toMatchObject({ status: 409, code: "PLAN_IN_USE" });
  await expect(db.billingPlanVersion.delete({ where: { id: created.body.versions[0].id } })).rejects.toThrow();
});
test("버전 기간 오류는 이름 변경까지 함께 롤백한다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input());
  await createAdminPlan(a, parsed, randomUUID());
  await expect(updateAdminPlan(a, parsed.id, { name: "실패해야 함", version: { ...parsed.version, number: 2, effectiveTo: "2000-01-01T00:00:00.000Z" } }, randomUUID())).rejects.toMatchObject({ status: 422 });
  expect((await readAdminPlan(a, parsed.id)).name).toBe(parsed.name);
});
test("관리자 상품 HTTP 경로가 동일한 PostgreSQL CRUD와 권한 경계를 사용한다", async () => {
  const { cookie } = await adminSession(), value = input();
  const createdResponse = await createPlanRoute(routeRequest("", "POST", cookie, value));
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(createdResponse.headers.get("location")).toBe(`/api/v1/admin/plans/${created.id}`);

  const listed = await listPlansRoute(routeRequest("", "GET", cookie));
  expect(listed.status).toBe(200);
  expect((await listed.json()).items.some((plan: { id: string }) => plan.id === created.id)).toBe(true);

  const detail = await readPlanRoute(routeRequest("/" + created.id, "GET", cookie));
  expect(detail.status).toBe(200);
  expect((await detail.json()).id).toBe(created.id);

  const changed = await updatePlanRoute(routeRequest("/" + created.id, "PATCH", cookie, { name: "HTTP 변경 상품" }));
  expect(changed.status).toBe(200);
  expect((await changed.json()).name).toBe("HTTP 변경 상품");

  expect((await deletePlanRoute(routeRequest("/" + created.id, "DELETE", cookie))).status).toBe(204);
  expect((await readPlanRoute(routeRequest("/" + created.id, "GET", cookie))).status).toBe(404);
  expect(await db.auditEvent.count({ where: { resourceId: created.id } })).toBe(3);
});
test("상품 생성 중 세션이 만료되면 상품·감사가 함께 롤백된다", async () => {
  const a = await actor(), parsed = adminPlanCreate.parse(input());
  const realAudit = auditModule.audit;
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    await realAudit(...args);
    if (args[3] === "plan.created") {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(a.session.expiresAt.getTime() + 1000);
    }
  });
  await expect(createAdminPlan(a, parsed, randomUUID())).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  expect(await db.billingPlan.findUnique({ where: { id: parsed.id } })).toBeNull();
  expect(await db.auditEvent.count({ where: { resourceId: parsed.id } })).toBe(0);
});
