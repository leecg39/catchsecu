import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireActor, requireContext, type Context } from "@/server/context";
import { selectCompany, selectService } from "@/server/context-selection";
import { POST as selectRoute } from "@/app/api/v1/context/route";

const fault = vi.hoisted(() => ({ fail: false, expire: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (!args[3].startsWith("context.")) return;
    if (fault.fail) throw new Error("synthetic context audit failure");
    if (fault.expire) vi.setSystemTime(Date.now() + 120000);
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const email = "context-audit@example.test", password = "Context-audit!123456";
let userId: string, backupId: string, companyA: string, companyB: string, serviceA: string, serviceB: string;
let memberA: string, memberB: string, cookie: string, ctx: Context;
function req(input?: unknown) {
  return new Request(origin + "/api/v1/context", { method: input ? "POST" : "GET", headers: { origin, cookie,
    ...(input ? { "content-type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  expect((await auth.handler(new Request(origin + "/api/v1/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password, name: "선택 감사" }) }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  backupId = (await db.user.create({ data: { id: randomUUID(), email: randomUUID() + "@example.test", name: "합성 소유자", emailVerified: true } })).id;
});
beforeEach(async () => {
  vi.useRealTimers(); fault.fail = false; fault.expire = false;
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  await db.user.update({ where: { id: userId }, data: { status: "active", emailVerified: true } });
  companyA = (await db.company.create({ data: { name: "선택 회사 A", publicName: "합성", policy: { create: {} }, memberships: { create: [{ userId: backupId, role: "owner" }, { userId, role: "privacy" }] } } })).id;
  companyB = (await db.company.create({ data: { name: "선택 회사 B", publicName: "합성", policy: { create: {} }, memberships: { create: [{ userId: backupId, role: "owner" }, { userId, role: "privacy" }] } } })).id;
  memberA = (await db.membership.findFirstOrThrow({ where: { tenantId: companyA, userId } })).id;
  memberB = (await db.membership.findFirstOrThrow({ where: { tenantId: companyB, userId } })).id;
  serviceA = (await db.service.create({ data: { tenantId: companyA, name: "선택 서비스 A", externalName: "A" } })).id;
  serviceB = (await db.service.create({ data: { tenantId: companyA, name: "선택 서비스 B", externalName: "B" } })).id;
  for (const serviceId of [serviceA, serviceB]) await db.serviceGrant.create({ data: { tenantId: companyA, memberId: memberA, serviceId, capabilities: ["service.read"] } });
  const login = await auth.handler(new Request(origin + "/api/v1/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
  expect(login.status).toBe(200); cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const actor = await requireActor(req().headers);
  await db.session.update({ where: { id: actor.session.id }, data: { activeCompanyId: companyA, activeServiceId: null } });
  ctx = await requireContext(req().headers);
});
afterAll(async () => { fault.fail = false; fault.expire = false; vi.useRealTimers(); await db.$disconnect(); });
const action = (kind: "company" | "service", id: string) => kind === "company"
  ? selectCompany(ctx, companyB, ctx.clientIp, id) : selectService(ctx, serviceA, id);
for (const kind of ["company", "service"] as const) {
  test(`${kind}: selection and one request-linked safe audit commit together`, async () => {
    const response = await selectRoute(req(kind === "company" ? { companyId: companyB } : { serviceId: serviceA }));
    expect(response.status).toBe(200);
    const rows = await db.auditEvent.findMany({ where: { requestId: response.headers.get("x-request-id")! } });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ actorId: userId, tenantId: kind === "company" ? companyB : companyA,
      action: "context." + kind + "_selected", resource: "session", resourceId: ctx.session.id,
      serviceId: kind === "service" ? serviceA : null });
    expect(rows[0].detail).toEqual({ changedFields: kind === "company" ? ["activeCompanyId", "activeServiceId"] : ["activeServiceId"] });
    expect(await db.session.findUnique({ where: { id: ctx.session.id } })).toMatchObject(kind === "company"
      ? { activeCompanyId: companyB, activeServiceId: null } : { activeCompanyId: companyA, activeServiceId: serviceA });
  });
  test(`${kind}: audit failure rolls back both selection and inserted event`, async () => {
    const id = randomUUID(); fault.fail = true;
    await expect(action(kind, id)).rejects.toThrow("synthetic context audit failure"); fault.fail = false;
    expect(await db.session.findUnique({ where: { id: ctx.session.id } })).toMatchObject({ activeCompanyId: companyA, activeServiceId: null });
    expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
  });
  test(`${kind}: deadline crossed after audit insertion rolls back selection and event`, async () => {
    await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
    const id = randomUUID(); fault.expire = true;
    await expect(action(kind, id)).rejects.toMatchObject({ status: 401 }); fault.expire = false; vi.useRealTimers();
    expect(await db.session.findUnique({ where: { id: ctx.session.id } })).toMatchObject({ activeCompanyId: companyA, activeServiceId: null });
    expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
  });
  test(`${kind}: revoked session after authentication cannot select or audit`, async () => {
    await db.session.delete({ where: { id: ctx.session.id } }); const id = randomUUID();
    await expect(action(kind, id)).rejects.toMatchObject({ status: 401 });
    expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
  });
  test(`${kind}: current unverified account cannot select or audit`, async () => {
    await db.user.update({ where: { id: userId }, data: { emailVerified: false } }); const id = randomUUID();
    await expect(action(kind, id)).rejects.toMatchObject({ status: 401 });
    expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
  });
}
test("revoked target-company membership is checked inside the selection transaction", async () => {
  await db.membership.update({ where: { id: memberB }, data: { status: "revoked" } }); const id = randomUUID();
  await expect(selectCompany(ctx, companyB, ctx.clientIp, id)).rejects.toMatchObject({ status: 404 });
  expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
});
test("current service grant removal blocks a captured request context", async () => {
  await db.serviceGrant.deleteMany({ where: { memberId: memberA, serviceId: serviceA } }); const id = randomUUID();
  await expect(selectService(ctx, serviceA, id)).rejects.toMatchObject({ status: 404 });
  expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
});
test("archived service cannot be selected and creates no selection event", async () => {
  await db.service.update({ where: { id: serviceA }, data: { status: "archived" } }); const id = randomUUID();
  await expect(selectService(ctx, serviceA, id)).rejects.toMatchObject({ status: 409 });
  expect(await db.auditEvent.count({ where: { requestId: id } })).toBe(0);
});
test("another-company service remains unavailable", async () => {
  const other = await db.service.create({ data: { tenantId: companyB, name: "다른 회사", externalName: "합성" } });
  await expect(selectService(ctx, other.id, randomUUID())).rejects.toMatchObject({ status: 404 });
});
test("concurrent selections serialize and each produces one committed event", async () => {
  const ids = [randomUUID(), randomUUID()];
  await Promise.all([selectService(ctx, serviceA, ids[0]), selectService(ctx, serviceB, ids[1])]);
  const rows = await db.auditEvent.findMany({ where: { requestId: { in: ids } } }); expect(rows).toHaveLength(2);
  expect(rows.map(r => r.serviceId).sort()).toEqual([serviceA, serviceB].sort());
  expect([serviceA, serviceB]).toContain((await db.session.findUniqueOrThrow({ where: { id: ctx.session.id } })).activeServiceId);
});
test.each([{}, { companyId: "a" }, { companyId: "placeholder", serviceId: "placeholder" }])("ambiguous or invalid selection is rejected before audit", async value => {
  const input = value.companyId === "placeholder" ? { companyId: companyB, serviceId: serviceA } : value;
  const response = await selectRoute(req(input)); expect(response.status).toBe(422);
  expect(await db.auditEvent.count({ where: { requestId: response.headers.get("x-request-id")! } })).toBe(0);
});
