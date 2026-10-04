import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { GET as list } from "@/app/api/v1/audit-events/route";
import { GET as dashboard } from "@/app/api/v1/analytics/dashboard/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required.");
const origin = env.BETTER_AUTH_URL, password = "Log-gate-password!123";
const companyA = randomUUID(), companyB = randomUUID(), serviceA = randomUUID(), serviceB = randomUUID();
let adminCookie = "", limitedCookie = "", adminId = "";
function request(path: string, cookie = "") {
  return new Request(origin + "/api/v1" + path, { method: "GET", headers: { origin, cookie } });
}
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
async function signup(email: string, role: "admin" | "privacy", tenantId = companyA) {
  expect((await auth.handler(new Request(origin + "/api/v1/auth/sign-up/email", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: email.split("@")[0], email, password }) }))).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  const signed = await auth.handler(new Request(origin + "/api/v1/auth/sign-in/email", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
  return { id: user.id, memberId: member.id, cookie: cookieOf(signed) };
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [{ id: companyA, name: "로그 회사 A", publicName: "A" }, { id: companyB, name: "로그 회사 B", publicName: "B" }] });
  await db.service.createMany({ data: [{ id: serviceA, tenantId: companyA, name: "svcA", externalName: "A" },
    { id: serviceB, tenantId: companyB, name: "svcB", externalName: "B" }] });
  const admin = await signup("lg-admin@test.local", "admin"); adminId = admin.id; adminCookie = admin.cookie;
  const limited = await signup("lg-privacy@test.local", "privacy"); limitedCookie = limited.cookie;
  await db.serviceGrant.create({ data: { tenantId: companyA, memberId: limited.memberId, serviceId: serviceA, capabilities: ["service.read", "audit.read"] } });
  // 0/1/11/100 경계용 25건 + 타사 이벤트
  await db.auditEvent.createMany({ data: Array.from({ length: 25 }, (_, i) => ({
    tenantId: companyA, serviceId: serviceA, actorId: admin.id, action: "service.updated", resource: "service",
    requestId: randomUUID(), createdAt: new Date(Date.now() - i * 60000), detail: { changedFields: [] } })) });
  await db.auditEvent.create({ data: { tenantId: companyB, serviceId: serviceB, actorId: admin.id, action: "service.updated",
    resource: "service", requestId: randomUUID(), detail: { changedFields: [] } } });
  await db.rateLimit.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

describe("P12-T04 로그 경로 게이트", () => {
  test("없는·타사·비UUID serviceId와 권한 밖 서비스는 거부된다", async () => {
    expect((await list(request("/audit-events?serviceId=not-a-uuid", adminCookie))).status).toBe(422);
    expect((await list(request("/audit-events?serviceId=" + randomUUID(), adminCookie))).status).toBe(404);
    expect((await list(request("/audit-events?serviceId=" + serviceB, adminCookie))).status).toBe(404);
    // privacy는 serviceA 범위만 — 범위 없는 요청은 scoped로 제한됨
    const scoped = await (await list(request("/audit-events", limitedCookie))).json();
    expect(scoped.items.every((row: { serviceId: string | null }) => row.serviceId === null || row.serviceId === serviceA)).toBe(true);
    expect(scoped.items.some((row: { serviceId: string | null }) => row.serviceId === serviceB)).toBe(false);
  });
  test("페이지네이션 경계 0·1·11·100이 정확하다", async () => {
    const empty = await (await list(request("/audit-events?kind=mail", adminCookie))).json();
    expect(empty.total).toBe(0); expect(empty.items).toEqual([]);
    const one = await (await list(request("/audit-events?kind=service&pageSize=1&page=1", adminCookie))).json();
    expect(one.items).toHaveLength(1); expect(one.total).toBe(25);
    const eleven = await (await list(request("/audit-events?kind=service&pageSize=11&page=1", adminCookie))).json();
    expect(eleven.items).toHaveLength(11); expect(eleven.total).toBe(25);
    const page3 = await (await list(request("/audit-events?kind=service&pageSize=11&page=3", adminCookie))).json();
    expect(page3.items).toHaveLength(3);
    const hundred = await (await list(request("/audit-events?kind=service&pageSize=100&page=1", adminCookie))).json();
    expect(hundred.items).toHaveLength(25); expect(hundred.total).toBe(25);
    // 범위를 넘는 페이지는 마지막 페이지로 고정
    const beyond = await (await list(request("/audit-events?kind=service&pageSize=10&page=99", adminCookie))).json();
    expect(beyond.page).toBe(3); expect(beyond.items).toHaveLength(5);
    expect((await list(request("/audit-events?pageSize=0", adminCookie))).status).toBe(422);
    expect((await list(request("/audit-events?pageSize=101", adminCookie))).status).toBe(422);
  });
  test("대량 로그 조회는 tenantId·createdAt 인덱스를 사용한다", async () => {
    // 소량에서는 seq scan이 정당하므로 충분한 행을 만들고 실행계획을 확인
    await db.$executeRawUnsafe(`INSERT INTO "AuditEvent" (id, "tenantId", "actorId", action, resource, "requestId", detail, "createdAt")
      SELECT gen_random_uuid()::text, $1, $2, 'bulk.test', 'service', gen_random_uuid()::text, '{}'::jsonb,
        now() - (g || ' seconds')::interval FROM generate_series(1, 4000) g`, companyA, adminId);
    await db.$executeRawUnsafe('ANALYZE "AuditEvent"');
    const plan = await db.$queryRawUnsafe<{ "QUERY PLAN": { Plan: { "Node Type": string; "Index Name"?: string; Plans?: unknown[] } } }[]>(
      `EXPLAIN (FORMAT JSON) SELECT id FROM "AuditEvent" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 20`, companyA);
    const text = JSON.stringify(plan);
    expect(text).toContain("AuditEvent_tenantId_createdAt_id_idx");
    expect(text).not.toMatch(/"Node Type": "Seq Scan"/);
  });
  test("서비스별 대시보드는 범위 밖·타사·없는 serviceId를 거부한다", async () => {
    expect((await dashboard(request("/analytics/dashboard?serviceId=" + serviceB, adminCookie))).status).toBe(404);
    expect((await dashboard(request("/analytics/dashboard?serviceId=" + randomUUID(), adminCookie))).status).toBe(404);
    expect((await dashboard(request("/analytics/dashboard?serviceId=bad", adminCookie))).status).toBe(422);
    const scoped = await dashboard(request("/analytics/dashboard?serviceId=" + serviceA, limitedCookie));
    expect(scoped.status).toBe(200);
    const body = await scoped.json();
    expect(body.services.map((row: { id: string }) => row.id)).toEqual([serviceA]);
  });
});
