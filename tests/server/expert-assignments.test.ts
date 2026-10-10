import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET as list, POST as create } from "@/app/api/v1/expert-assignments/route";
import { GET as options } from "@/app/api/v1/expert-assignments/options/route";
import { GET as detail, PATCH as patch, DELETE as revoke } from "@/app/api/v1/expert-assignments/[id]/route";
import { GET as context, POST as selectContext } from "@/app/api/v1/context/route";
import { GET as services } from "@/app/api/v1/services/route";
import { GET as serviceDetail } from "@/app/api/v1/services/[id]/route";
import { PATCH as updateMember, DELETE as deleteMember } from "@/app/api/v1/members/[...segments]/route";
import { expireExpertAssignments } from "@/server/expert-assignments";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Expert fixtures require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Test-only-password!123";
const a = randomUUID(), b = randomUUID();
let adminCookie = "", expertCookie = "", ownerCookie = "", adminId = "", expertId = "", ownerId = "";
let a1 = "", a2 = "", b1 = "", assignmentA = "", assignmentB = "", expertMemberA = "";
function req(path: string, method = "GET", cookie = "", value?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, ...(cookie ? { cookie } : {}),
    ...(value !== undefined ? { "content-type": "application/json" } : {}), ...extra },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function addUser(email: string, platformAdmin = false, tenantId?: string) {
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name: email.split("@")[0], email, password }))).status).toBe(200);
  const row = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: row.id }, data: { emailVerified: true, platformAdmin } });
  if (tenantId) await db.membership.create({ data: { tenantId, userId: row.id, role: "owner" } });
  const signed = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password }));
  expect(signed.status).toBe(200);
  return { id: row.id, cookie: cookies(signed) };
}
const expiry = () => new Date(Date.now() + 30 * 86400000).toISOString();
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [{ id: a, name: "고객 A", publicName: "A" }, { id: b, name: "고객 B", publicName: "B" }] });
  const admin = await addUser("expert-admin@test.local", true); adminCookie = admin.cookie; adminId = admin.id;
  const expert = await addUser("expert-person@test.local"); expertCookie = expert.cookie; expertId = expert.id;
  const owner = await addUser("expert-owner@test.local", false, a); ownerCookie = owner.cookie; ownerId = owner.id;
  a1 = (await db.service.create({ data: { tenantId: a, name: "A1", externalName: "A1" } })).id;
  a2 = (await db.service.create({ data: { tenantId: a, name: "A2", externalName: "A2" } })).id;
  b1 = (await db.service.create({ data: { tenantId: b, name: "B1", externalName: "B1" } })).id;
  await db.rateLimit.deleteMany();
  await db.job.updateMany({ data: { status: "cancelled" } });
});
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); });

describe("전문가 배정 PostgreSQL·API·회사 선택", () => {
  test("비운영자 배정 차단과 실제 계정·회사·서비스 검증", async () => {
    expect((await list(req("/expert-assignments"))).status).toBe(401);
    expect((await list(req("/expert-assignments?scope=admin", "GET", expertCookie))).status).toBe(403);
    expect((await options(req("/expert-assignments/options", "GET", ownerCookie))).status).toBe(403);
    expect((await options(req("/expert-assignments/options", "GET", adminCookie))).status).toBe(200);
    expect((await create(req("/expert-assignments", "POST", ownerCookie,
      { companyId: a, expertEmail: "expert-person@test.local", serviceIds: [a1], expiresAt: expiry() }))).status).toBe(403);
    expect((await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: a, expertEmail: "expert-person@test.local", serviceIds: [b1], expiresAt: expiry() }))).status).toBe(404);
    expect((await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: a, expertEmail: "expert-owner@test.local", serviceIds: [a1], expiresAt: expiry() }))).status).toBe(409);
    expect((await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: a, expertEmail: "expert-admin@test.local", serviceIds: [a1], expiresAt: expiry() }))).status).toBe(404);
    expect((await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: a, expertEmail: "expert-person@test.local", serviceIds: [a1], expiresAt: expiry() },
      { origin: "https://foreign.invalid" }))).status).toBe(403);
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: a }))).status).toBe(404);
  });
  test("배정된 회사와 서비스만 조회하고 일반 구성원 관리로 승격할 수 없다", async () => {
    const created = await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: a, expertEmail: "expert-person@test.local", serviceIds: [a1], expiresAt: expiry() }));
    expect(created.status).toBe(201);
    const row = await created.json(); assignmentA = row.id;
    expect(row).toMatchObject({ companyId: a, expertUserId: expertId, status: "active", canSelect: true });
    expertMemberA = (await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: a, userId: expertId } } })).id;
    expect(await db.membership.findUnique({ where: { id: expertMemberA } })).toMatchObject({ role: "viewer", accessKind: "expert", expertAssignmentId: assignmentA });
    expect((await detail(req("/expert-assignments/" + assignmentA, "GET", expertCookie))).status).toBe(200);
    expect((await list(req("/expert-assignments?scope=mine", "GET", expertCookie))).status).toBe(200);
    expect((await (await context(req("/context", "GET", expertCookie))).json()).company).toBeNull();
    expect((await services(req("/services", "GET", expertCookie))).status).toBe(403);
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: a }))).status).toBe(200);
    const ownContext = await (await context(req("/context", "GET", expertCookie))).json();
    expect(ownContext.services.map((item: { id: string }) => item.id)).toEqual([a1]);
    const scoped = await (await services(req("/services", "GET", expertCookie))).json();
    expect(scoped.items.map((item: { id: string }) => item.id)).toEqual([a1]);
    await db.serviceGrant.create({ data: { tenantId: a, memberId: expertMemberA, serviceId: a2,
      capabilities: ["service.read"] } });
    expect((await (await services(req("/services", "GET", expertCookie))).json()).items.map((item: { id: string }) => item.id)).toEqual([a1]);
    expect((await serviceDetail(req("/services/" + a2, "GET", expertCookie))).status).toBe(403);
    await db.serviceGrant.delete({ where: { tenantId_memberId_serviceId: { tenantId: a, memberId: expertMemberA, serviceId: a2 } } });
    await expect(db.membership.update({ where: { id: expertMemberA }, data: { role: "admin" } })).rejects.toThrow();
    const member = await db.membership.findUniqueOrThrow({ where: { id: expertMemberA } });
    expect((await updateMember(req("/members/" + member.id, "PATCH", ownerCookie,
      { version: member.version, role: "admin", serviceIds: [a1, a2] }))).status).toBe(409);
    expect((await deleteMember(req("/members/" + member.id, "DELETE", ownerCookie, undefined,
      { "if-match": String(member.version) }))).status).toBe(409);
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: b }))).status).toBe(404);
    expect((await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: a, expertEmail: "expert-person@test.local", serviceIds: [a2], expiresAt: expiry() }))).status).toBe(409);
  });
  test("두 번째 회사 선택, 범위 수정, 회수 직후 접근 차단", async () => {
    const createdB = await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: b, expertEmail: "expert-person@test.local", serviceIds: [b1], expiresAt: expiry() }));
    expect(createdB.status).toBe(201); assignmentB = (await createdB.json()).id;
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: b }))).status).toBe(200);
    expect((await (await context(req("/context", "GET", expertCookie))).json()).company.id).toBe(b);
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: a }))).status).toBe(200);
    const changed = await patch(req("/expert-assignments/" + assignmentA, "PATCH", adminCookie,
      { version: 1, serviceIds: [a2], expiresAt: expiry() }));
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ version: 2, services: [{ id: a2 }] });
    expect((await (await context(req("/context", "GET", expertCookie))).json()).services.map((item: { id: string }) => item.id)).toEqual([a2]);
    expect((await patch(req("/expert-assignments/" + assignmentA, "PATCH", adminCookie,
      { version: 1, serviceIds: [a1] }))).status).toBe(409);
    expect((await revoke(req("/expert-assignments/" + assignmentA, "DELETE", adminCookie, undefined,
      { "if-match": "2" }))).status).toBe(204);
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: a }))).status).toBe(404);
    expect((await (await context(req("/context", "GET", expertCookie))).json()).company).toBeNull();
    expect((await services(req("/services", "GET", expertCookie))).status).toBe(403);
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: b }))).status).toBe(200);
    expect(await db.serviceGrant.count({ where: { tenantId: a, memberId: expertMemberA } })).toBe(0);
    expect((await revoke(req("/expert-assignments/" + assignmentA, "DELETE", adminCookie, undefined,
      { "if-match": "2" }))).status).toBe(409);
    const restored = await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: a, expertEmail: "expert-person@test.local", serviceIds: [a1], expiresAt: expiry() }));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ id: assignmentA, version: 4, status: "active" });
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: a }))).status).toBe(200);
  });
  test("만료 즉시 API 차단과 DB 회사 범위 제약", async () => {
    await db.expertAssignment.update({ where: { id: assignmentB }, data: { expiresAt: new Date(Date.now() + 120000) } });
    const now = Date.now(); vi.setSystemTime(now + 180000);
    expect((await (await list(req("/expert-assignments?scope=mine", "GET", expertCookie))).json()).items
      .find((item: { id: string }) => item.id === assignmentB).status).toBe("expired");
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: b }))).status).toBe(404);
    expect(await expireExpertAssignments(new Date(now + 180000))).toBe(1);
    expect(await expireExpertAssignments(new Date(now + 180000))).toBe(0);
    expect(await db.membership.findUnique({ where: { tenantId_userId: { tenantId: b, userId: expertId } } })).toMatchObject({ status: "revoked" });
    expect(await db.serviceGrant.count({ where: { tenantId: b, serviceId: b1 } })).toBe(0);
    vi.setSystemTime(now);
    const renewed = await create(req("/expert-assignments", "POST", adminCookie,
      { companyId: b, expertEmail: "expert-person@test.local", serviceIds: [b1], expiresAt: expiry() }));
    expect(renewed.status).toBe(200);
    expect(await renewed.json()).toMatchObject({ id: assignmentB, status: "active" });
    expect((await selectContext(req("/context", "POST", expertCookie, { companyId: b }))).status).toBe(200);
    await db.service.update({ where: { id: b1 }, data: { status: "archived" } });
    expect((await (await context(req("/context", "GET", expertCookie))).json()).services).toEqual([]);
    expect((await serviceDetail(req("/services/" + b1, "GET", expertCookie))).status).toBe(404);
    await expect(db.expertAssignmentService.create({ data: { tenantId: a, assignmentId: assignmentA, serviceId: b1 } })).rejects.toThrow();
    expect(await db.auditEvent.count({ where: { resource: "expert_assignment", actorId: adminId } })).toBeGreaterThanOrEqual(5);
    expect(ownerId).toBeTruthy();
  });
});
