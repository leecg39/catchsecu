import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET as list, POST as create } from "@/app/api/v1/access-requests/route";
import { PATCH as decide, DELETE as cancel } from "@/app/api/v1/access-requests/[id]/route";
import { GET as context } from "@/app/api/v1/context/route";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Access request fixtures require the isolated local test database.");
const origin = env.BETTER_AUTH_URL;
const password = "Test-only-password!123";
const companyA = randomUUID(), companyB = randomUUID();
let ownerA = "", viewerA = "", ownerB = "", viewerId = "", serviceA = "", serviceB = "";
function req(path: string, method = "GET", cookie = "", value?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, ...(cookie ? { cookie } : {}),
    ...(value !== undefined ? { "content-type": "application/json" } : {}), ...extra },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function user(email: string, tenantId: string, role: "owner" | "viewer") {
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name: email.split("@")[0], email, password }))).status).toBe(200);
  const row = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: row.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: row.id, role } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password }));
  expect(response.status).toBe(200);
  return { cookie: cookies(response), memberId: member.id };
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [{ id: companyA, name: "Access A", publicName: "Access A" },
    { id: companyB, name: "Access B", publicName: "Access B" }] });
  ownerA = (await user("access-owner-a@test.local", companyA, "owner")).cookie;
  const viewer = await user("access-viewer-a@test.local", companyA, "viewer"); viewerA = viewer.cookie; viewerId = viewer.memberId;
  ownerB = (await user("access-owner-b@test.local", companyB, "owner")).cookie;
  serviceA = (await db.service.create({ data: { tenantId: companyA, name: "A 서비스", externalName: "A" } })).id;
  serviceB = (await db.service.create({ data: { tenantId: companyB, name: "B 서비스", externalName: "B" } })).id;
  await db.rateLimit.deleteMany();
  await db.job.updateMany({ data: { status: "cancelled" } });
});
afterAll(async () => { await db.$disconnect(); });

describe("서비스 접근 요청 PostgreSQL·HTTP 권한 흐름", () => {
  test("소속 회사 서비스만 제안하고 인증·출처·입력을 검증한다", async () => {
    expect((await list(req("/access-requests"))).status).toBe(401);
    const own = await list(req("/access-requests", "GET", viewerA));
    expect(own.status).toBe(200);
    expect((await own.json()).availableServices).toEqual([{ id: serviceA, name: "A 서비스" }]);
    const foreign = await list(req("/access-requests", "GET", ownerB));
    expect((await foreign.json()).availableServices).toEqual([]);
    expect((await list(req("/access-requests?scope=review", "GET", viewerA))).status).toBe(403);
    expect((await create(req("/access-requests", "POST", viewerA, { serviceId: serviceB }))).status).toBe(404);
    expect((await create(req("/access-requests", "POST", viewerA, { serviceId: "invalid" }))).status).toBe(422);
    expect((await create(req("/access-requests", "POST", viewerA, { serviceId: serviceA }, { origin: "https://foreign.invalid" }))).status).toBe(403);
  });
  test("동일 서비스 중복 요청은 한 건으로 수렴하고 승인 후 실제 권한이 생긴다", async () => {
    const [first, repeat] = await Promise.all([
      create(req("/access-requests", "POST", viewerA, { serviceId: serviceA, reason: "업무 검토" })),
      create(req("/access-requests", "POST", viewerA, { serviceId: serviceA, reason: "업무 검토" })),
    ]);
    expect([first.status, repeat.status].sort()).toEqual([200, 201]);
    const item = await first.json();
    expect((await repeat.json()).id).toBe(item.id);
    expect(await db.accessRequest.count({ where: { tenantId: companyA, requesterId: viewerId, serviceId: serviceA } })).toBe(1);
    expect((await context(req("/context", "GET", viewerA))).status).toBe(200);
    expect((await (await context(req("/context", "GET", viewerA))).json()).services).toEqual([]);
    expect((await decide(req("/access-requests/" + item.id, "PATCH", viewerA,
      { version: 1, decision: "approve" }))).status).toBe(403);
    expect((await decide(req("/access-requests/" + item.id, "PATCH", ownerB,
      { version: 1, decision: "approve" }))).status).toBe(404);
    const approved = await decide(req("/access-requests/" + item.id, "PATCH", ownerA,
      { version: 1, decision: "approve", note: "허용" }));
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ status: "approved", version: 2, decisionNote: "허용" });
    expect(await db.serviceGrant.findFirst({ where: { tenantId: companyA, memberId: viewerId, serviceId: serviceA } }))
      .toMatchObject({ capabilities: expect.arrayContaining(["service.read"]) });
    expect((await (await context(req("/context", "GET", viewerA))).json()).services).toMatchObject([{ id: serviceA }]);
    expect((await decide(req("/access-requests/" + item.id, "PATCH", ownerA,
      { version: 1, decision: "approve" }))).status).toBe(409);
    expect((await create(req("/access-requests", "POST", viewerA, { serviceId: serviceA }))).status).toBe(409);
    expect(await db.auditEvent.count({ where: { tenantId: companyA, resourceId: item.id } })).toBe(2);
  });
  test("요청 취소와 거절은 권한을 만들지 않고, DB가 잘못된 상태를 거부한다", async () => {
    const extra = await db.service.create({ data: { tenantId: companyA, name: "추가 서비스", externalName: "Extra" } });
    const created = await create(req("/access-requests", "POST", viewerA, { serviceId: extra.id }));
    const item = await created.json();
    expect((await cancel(req("/access-requests/" + item.id, "DELETE", ownerB, undefined, { "if-match": "1" }))).status).toBe(404);
    expect((await cancel(req("/access-requests/" + item.id, "DELETE", viewerA, undefined, { "if-match": "1" }))).status).toBe(204);
    expect((await cancel(req("/access-requests/" + item.id, "DELETE", viewerA, undefined, { "if-match": "1" }))).status).toBe(409);
    const another = await create(req("/access-requests", "POST", viewerA, { serviceId: extra.id }));
    expect(another.status).toBe(201);
    const next = await another.json();
    expect(next.id).not.toBe(item.id);
    expect((await decide(req("/access-requests/" + next.id, "PATCH", ownerA,
      { version: 1, decision: "reject", note: "담당 업무 확인 필요" }))).status).toBe(200);
    expect(await db.serviceGrant.findFirst({ where: { tenantId: companyA, memberId: viewerId, serviceId: extra.id } })).toBeNull();
    await expect(db.accessRequest.create({ data: { tenantId: companyA, requesterId: viewerId, serviceId: extra.id,
      status: "approved" } })).rejects.toThrow();
  });
});
