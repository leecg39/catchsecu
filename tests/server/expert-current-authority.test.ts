import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireActor } from "@/server/context";
import { createExpertAssignment, updateExpertAssignment, revokeExpertAssignment, listExpertAssignments, getExpertAssignment, expertOptions } from "@/server/expert-assignments";

const clock = vi.hoisted(() => ({ advanceAfterAudit: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (clock.advanceAfterAudit) vi.setSystemTime(Date.now() + 120_000);
  } };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Expert authority tests require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Expert-authority-test!123";
const adminEmail = "expert-authority-admin@example.test", expertEmail = "expert-authority-person@example.test";
let adminId: string, expertId: string, actor: Awaited<ReturnType<typeof requireActor>>, tenantId: string, serviceId: string, assignmentId: string;
function request(path: string, cookie = "", data?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: data ? "POST" : "GET", headers: {
    origin, cookie, ...(data ? { "content-type": "application/json" } : {}),
  }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const expiry = () => new Date(Date.now() + 86400000).toISOString();
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  for (const email of [adminEmail, expertEmail]) {
    expect((await auth.handler(request("/auth/sign-up/email", "", { email, name: email, password }))).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true, platformAdmin: email === adminEmail } });
    if (email === adminEmail) adminId = user.id; else expertId = user.id;
  }
});
beforeEach(async () => {
  vi.useRealTimers(); clock.advanceAfterAudit = false;
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  await db.user.update({ where: { id: adminId }, data: { platformAdmin: true } });
  const company = await db.company.create({ data: { name: "전문가 권한 검사", publicName: "전문가 권한 검사",
    services: { create: { name: "서비스", externalName: "서비스" } },
  }, include: { services: true } });
  tenantId = company.id; serviceId = company.services[0].id;
  const signed = await auth.handler(request("/auth/sign-in/email", "", { email: adminEmail, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  actor = await requireActor(request("/context", cookie).headers);
  assignmentId = (await createExpertAssignment(actor, { companyId: tenantId, expertEmail, serviceIds: [serviceId], expiresAt: expiry() }, randomUUID())).body.id;
});
afterAll(async () => { clock.advanceAfterAudit = false; vi.useRealTimers(); await db.$disconnect(); });
const operations = {
  create: async () => {
    const other = await db.company.create({ data: { name: "신규 배정", publicName: "신규 배정", services: { create: { name: "새 서비스", externalName: "새 서비스" } } }, include: { services: true } });
    return createExpertAssignment(actor, { companyId: other.id, expertEmail, serviceIds: [other.services[0].id], expiresAt: expiry() }, randomUUID());
  },
  update: () => updateExpertAssignment(actor, assignmentId, { version: 1, expiresAt: expiry() }, randomUUID()),
  revoke: () => revokeExpertAssignment(actor, assignmentId, 1, randomUUID()),
  list: () => listExpertAssignments(actor, { scope: "admin", page: 1, pageSize: 20, search: "" }),
  detail: () => getExpertAssignment(actor, assignmentId),
  options: () => expertOptions(actor, { companyId: tenantId, search: "" }),
};
for (const condition of ["session", "admin"] as const) {
  test.each(Object.keys(operations) as (keyof typeof operations)[])(`%s rejects revoked ${condition} after request authentication`, async operation => {
    const audits = await db.auditEvent.count(), assignments = await db.expertAssignment.count();
    if (condition === "session") await db.session.delete({ where: { id: actor.session.id } });
    else await db.user.update({ where: { id: adminId }, data: { platformAdmin: false } });
    await expect(operations[operation]()).rejects.toMatchObject({ status: condition === "session" ? 401 : operation === "detail" ? 404 : 403 });
    expect(await db.expertAssignment.findUnique({ where: { id: assignmentId } })).toMatchObject({ status: "active", version: 1 });
    expect(await db.expertAssignment.count()).toBe(assignments);
    expect(await db.auditEvent.count()).toBe(audits);
  });
}
test.each(["create", "update", "revoke"] as const)("%s rolls back when the administrator session expires before commit", async operation => {
  const audits = await db.auditEvent.count(), assignments = await db.expertAssignment.count();
  await db.session.update({ where: { id: actor.session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  clock.advanceAfterAudit = true;
  try { await expect(operations[operation]()).rejects.toMatchObject({ status: 401 }); }
  finally { clock.advanceAfterAudit = false; vi.useRealTimers(); }
  expect(await db.expertAssignment.findUnique({ where: { id: assignmentId } })).toMatchObject({ status: "active", version: 1 });
  expect(await db.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: expertId } } })).toMatchObject({ status: "active", version: 1 });
  expect(await db.serviceGrant.count({ where: { tenantId } })).toBe(1);
  expect(await db.expertAssignment.count()).toBe(assignments);
  expect(await db.auditEvent.count()).toBe(audits);
});
