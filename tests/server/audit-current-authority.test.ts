import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { parse } from "csv-parse/sync";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireActor, requireContext, type Context } from "@/server/context";
import { auditEventQuery, listAuditEvents, exportAuditEvents, listOwnAuditEvents } from "@/server/audit-events";
import { GET as companyList } from "@/app/api/v1/audit-events/route";
import { GET as companyExport } from "@/app/api/v1/audit-events/export/route";
import { GET as ownList } from "@/app/api/v1/me/audit-events/route";
import { GET as ownExport } from "@/app/api/v1/me/audit-events/export/route";

const faults = vi.hoisted(() => ({ fail: false, expire: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, auditAccess: async (...args: Parameters<typeof actual.auditAccess>) => {
    await actual.auditAccess(...args);
    if (faults.fail) throw new Error("synthetic audit write failure");
    if (faults.expire) vi.setSystemTime(Date.now() + 120000);
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const email = "audit-current@example.test", password = "Audit-current!123456";
let userId: string, backupId: string, cookie = "", ctx: Context, serviceId: string, siblingId: string, otherCompanyId: string;
function req(path: string, input?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin, cookie,
    ...(input ? { "content-type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(req("/auth/sign-up/email", { email, password, name: "감사 주체" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  backupId = (await db.user.create({ data: { id: randomUUID(), name: "합성 소유자", email: randomUUID() + "@example.test", emailVerified: true } })).id;
  otherCompanyId = (await db.company.create({ data: { name: "다른 감사 회사", publicName: "시험", memberships: { create: { userId: backupId, role: "owner" } } } })).id;
});
beforeEach(async () => {
  faults.fail = false; faults.expire = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  await db.user.update({ where: { id: userId }, data: { emailVerified: true, status: "active" } });
  const company = await db.company.create({ data: { name: "감사 현재 권한", publicName: "시험", policy: { create: {} },
    memberships: { create: [{ userId, role: "owner" }, { userId: backupId, role: "owner" }] },
    services: { create: [{ name: "허용", externalName: "A" }, { name: "회수", externalName: "B" }] } }, include: { services: true } });
  [serviceId, siblingId] = company.services.map(s => s.id);
  const login = await auth.handler(req("/auth/sign-in/email", { email, password })); expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const actor = await requireActor(req("/context").headers);
  await db.session.update({ where: { id: actor.session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(req("/context").headers, "audit.read");
  await db.auditEvent.createMany({ data: [serviceId, siblingId].map(id => ({ tenantId: ctx.tenantId, serviceId: id, actorId: userId,
    requestId: randomUUID(), action: "submission.viewed", resource: "submission", resourceId: randomUUID(),
    detail: { email: "never-return@example.test", token: "private-secret" } })) });
});
afterAll(async () => { faults.fail = false; faults.expire = false; vi.useRealTimers(); await db.$disconnect(); });
const query = () => auditEventQuery.parse({ scope: "company", kind: "info" });
function action(operation: "list" | "export", requestId = randomUUID()) {
  return operation === "list" ? listAuditEvents(ctx, query(), requestId) : exportAuditEvents(ctx, query(), requestId);
}
const invalidations = [
  ["role", 403], ["membership", 403], ["company", 403], ["session", 401],
  ["expiry", 401], ["selection", 403], ["email", 401], ["mfa", 403], ["policy-timeout", 401],
] as const;
for (const operation of ["list", "export"] as const) {
  for (const [change, status] of invalidations) test(`${operation}: 초기 인증 뒤 ${change} 변경을 현재 상태로 검사한다`, async () => {
    if (change === "role") await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
    if (change === "membership") await db.membership.update({ where: { id: ctx.member.id }, data: { status: "revoked" } });
    if (change === "company") await db.company.update({ where: { id: ctx.tenantId }, data: { status: "suspended" } });
    if (change === "session") await db.session.delete({ where: { id: ctx.session.id } });
    if (change === "expiry") await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    if (change === "selection") await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: otherCompanyId } });
    if (change === "email") await db.user.update({ where: { id: userId }, data: { emailVerified: false } });
    if (change === "mfa") await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
    if (change === "policy-timeout") {
      await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { sessionMinutes: 5 } });
      await db.session.update({ where: { id: ctx.session.id }, data: { updatedAt: new Date(Date.now() - 360000) } });
    }
    const id = randomUUID();
    await expect(action(operation, id)).rejects.toMatchObject({ status });
    expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
  });
  test(`${operation}: owner에서 서비스 제한 역할로 바뀌면 현재 grant와 마스킹을 적용한다`, async () => {
    await db.membership.update({ where: { id: ctx.member.id }, data: { role: "privacy" } });
    await db.serviceGrant.create({ data: { tenantId: ctx.tenantId, memberId: ctx.member.id, serviceId, capabilities: ["audit.read", "service.read"] } });
    const value = await action(operation);
    if (typeof value === "string") {
      const rows = parse(value, { bom: true }) as string[][];
      expect(rows).toHaveLength(2); expect(rows[1][3]).toBe("비공개"); expect(rows[1][6]).toBe("");
    } else {
      expect(value.total).toBe(1); expect(value.items[0]).toMatchObject({ serviceId, resourceId: null, actorName: null });
    }
    expect(JSON.stringify(value)).not.toContain("private-secret");
    expect(JSON.stringify(value)).not.toContain("never-return@example.test");
  });
  test(`${operation}: 감사 쓰기 실패는 민감 결과를 반환하지 않고 열람 감사를 롤백한다`, async () => {
    const id = randomUUID(); faults.fail = true;
    try { await expect(action(operation, id)).rejects.toThrow("synthetic audit write failure"); }
    finally { faults.fail = false; }
    expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
  });
  test(`${operation}: 감사 저장 도중 세션 기한이 지나면 결과와 감사를 거절한다`, async () => {
    await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
    const id = randomUUID(); faults.expire = true;
    try { await expect(action(operation, id)).rejects.toMatchObject({ status: 401 }); }
    finally { faults.expire = false; vi.useRealTimers(); }
    expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
  });
}
test("감사 목록 열람도 요청 ID로 기록하고 현재 조회 결과에는 새 열람 이벤트를 끼워 넣지 않는다", async () => {
  const id = randomUUID(), input = auditEventQuery.parse({ search: "submission.viewed", serviceId });
  const result = await listAuditEvents(ctx, input, id);
  expect(result.total).toBe(1);
  const event = await db.auditEvent.findFirstOrThrow({ where: { requestId: id } });
  expect(event).toMatchObject({ action: "audit.viewed", actorId: userId, tenantId: ctx.tenantId, serviceId,
    detail: { scope: "company", rowCount: 1, hasSearch: true } });
  expect(result.items.map(row => row.id)).not.toContain(event.id);
  expect(JSON.stringify(event.detail)).not.toContain("submission.viewed");
});
test("목록의 마지막 페이지가 비면 서버가 존재하는 페이지로 보정한다", async () => {
  const result = await listAuditEvents(ctx, auditEventQuery.parse({ kind: "info", page: 100, pageSize: 10 }));
  expect(result).toMatchObject({ total: 2, page: 1, pageSize: 10 }); expect(result.items).toHaveLength(2);
});
test("본인 활동 열람은 회사와 무관하게 본인에게만 연결하고 원문 검색어를 기록하지 않는다", async () => {
  const actor = await requireActor(req("/me").headers), id = randomUUID();
  const result = await listOwnAuditEvents(actor, auditEventQuery.parse({ scope: "mine", search: "submission.viewed" }), id);
  expect(result.items.every(row => row.resourceId === null && row.serviceId === null)).toBe(true);
  const event = await db.auditEvent.findFirstOrThrow({ where: { requestId: id } });
  expect(event).toMatchObject({ actorId: userId, tenantId: null, action: "audit.viewed", detail: { scope: "mine", hasSearch: true } });
  expect(JSON.stringify(event.detail)).not.toContain("submission.viewed");
});
test("회사/본인 목록·CSV는 중복 검색 조건을 덮어쓰지 않는다", async () => {
  for (const [handler, path, duplicate] of [
    [companyList, "/audit-events", "kind=info&kind=all"],
    [companyExport, "/audit-events/export", "serviceId=" + serviceId + "&serviceId=" + siblingId],
    [ownList, "/me/audit-events", "scope=mine&scope=mine"],
    [ownExport, "/me/audit-events/export", "search=a&search=b"],
  ] as const) {
    const response = await handler(req(path + "?" + duplicate));
    expect(response.status).toBe(422); expect((await response.json()).error.code).toBe("DUPLICATE_QUERY");
  }
});
