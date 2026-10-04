import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { closeComplianceMonth, complianceCloseCsv, readComplianceClose } from "@/server/compliance-close";

const faults = vi.hoisted(() => ({ audit: false, advance: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (args[3] === "compliance.closed") {
      if (faults.audit) throw new Error("synthetic audit failure");
      if (faults.advance) vi.setSystemTime(Date.now() + 120_000);
    }
  } };
});
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const email = "close-authority@example.test", password = "Close-authority!123", month = "2026-09";
let userId: string, ctx: Context, serviceId: string, otherServiceId: string;
function request(path: string, input?: unknown, cookie = "") {
  return new Request(origin + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin, cookie,
    ...(input ? { "content-type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(request("/auth/sign-up/email", { email, password, name: "마감 권한 검증" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
});
beforeEach(async () => {
  vi.useRealTimers(); faults.audit = false; faults.advance = false;
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "마감 권한 검증", publicName: "검증",
    memberships: { create: { userId, role: "owner" } }, services: { create: [{ name: "A", externalName: "A" }, { name: "B", externalName: "B" }] },
  }, include: { services: true } });
  [serviceId, otherServiceId] = company.services.map(service => service.id);
  const signed = await auth.handler(request("/auth/sign-in/email", { email, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(request("/context", undefined, cookie).headers, "service.read");
});
afterAll(async () => { faults.audit = false; faults.advance = false; vi.useRealTimers(); await db.$disconnect(); });
async function restrict() {
  const backup = await db.user.create({ data: { id: randomUUID(), name: "합성 소유자", email: randomUUID() + "@example.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: backup.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await db.serviceGrant.create({ data: { tenantId: ctx.tenantId, memberId: ctx.member.id, serviceId, capabilities: ["service.read"] } });
}
const create = (selected?: string) => closeComplianceMonth(ctx, { month, serviceId: selected }, randomUUID());
for (const operation of ["read", "replay", "csv"] as const) {
  for (const wholeCompany of [false, true]) test(`${operation}: 기존 ${wholeCompany ? "회사 전체" : "다른 서비스"} 마감에서 현재 권한을 검사한다`, async () => {
    const selected = wholeCompany ? undefined : otherServiceId;
    const saved = await create(selected); await restrict();
    const action = operation === "read" ? () => readComplianceClose(ctx, { month, serviceId: selected })
      : operation === "replay" ? () => create(selected) : () => complianceCloseCsv(ctx, saved.close.id);
    await expect(action()).rejects.toMatchObject({ status: wholeCompany ? 403 : 404 });
  });
}
test("제한된 구성원이 회사 전체 키에 일부 집계를 저장하지 못한다", async () => {
  await restrict();
  await expect(create()).rejects.toMatchObject({ status: 403 });
  expect(await db.complianceClose.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  const saved = await create(serviceId);
  expect(saved.close.totals.services).toBe(1);
  expect((await readComplianceClose(ctx, { month, serviceId })).close?.id).toBe(saved.close.id);
  expect(await complianceCloseCsv(ctx, saved.close.id)).toContain('"A"');
});
for (const operation of ["read", "replay", "csv"] as const) test(`${operation}: 인증 이후 세션이 삭제되면 저장된 기록도 거부한다`, async () => {
  const saved = await create(serviceId);
  await db.session.delete({ where: { id: ctx.session.id } });
  const action = operation === "read" ? () => readComplianceClose(ctx, { month, serviceId })
    : operation === "replay" ? () => create(serviceId) : () => complianceCloseCsv(ctx, saved.close.id);
  await expect(action()).rejects.toMatchObject({ status: 401 });
});
test("감사 실패 시 마감과 집계 조회 감사까지 함께 롤백한다", async () => {
  const before = await db.auditEvent.count({ where: { tenantId: ctx.tenantId } }); faults.audit = true;
  await expect(create()).rejects.toThrow("synthetic audit failure");
  expect(await db.complianceClose.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(before);
});
test("감사 후 세션 만료도 마감과 감사를 롤백한다", async () => {
  await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  const before = await db.auditEvent.count({ where: { tenantId: ctx.tenantId } });
  vi.useFakeTimers({ toFake: ["Date"] }); faults.advance = true;
  await expect(create()).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  expect(await db.complianceClose.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(before);
});
test("동시 마감은 하나의 기록과 생성 감사만 남긴다", async () => {
  const results = await Promise.all([create(serviceId), create(serviceId), create(serviceId)]);
  expect(new Set(results.map(result => result.close.id)).size).toBe(1);
  expect(results.filter(result => result.created)).toHaveLength(1);
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId, action: "compliance.closed" } })).toBe(1);
});
for (const operation of ["read", "replay", "csv"] as const) {
  for (const change of ["grant", "archive", "company", "mfa"] as const) test(`${operation}: 저장 후 ${change} 변경을 적용한다`, async () => {
    const saved = await create(serviceId); await restrict();
    if (change === "grant") await db.serviceGrant.deleteMany({ where: { memberId: ctx.member.id } });
    if (change === "archive") await db.service.update({ where: { id: serviceId }, data: { status: "archived" } });
    if (change === "company") {
      const other = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
      await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: other.id } });
    }
    if (change === "mfa") await db.securityPolicy.create({ data: { tenantId: ctx.tenantId, requireMfa: true, passwordMonths: 0 } });
    const action = operation === "read" ? () => readComplianceClose(ctx, { month, serviceId })
      : operation === "replay" ? () => create(serviceId) : () => complianceCloseCsv(ctx, saved.close.id);
    await expect(action()).rejects.toMatchObject({ status: ["grant", "archive"].includes(change) ? 404 : 403 });
  });
}
test("조회와 CSV 감사는 현재 서비스와 연결되고 거부 요청은 성공 감사를 남기지 않는다", async () => {
  const saved = await create(serviceId), viewId = randomUUID(), exportId = randomUUID();
  await readComplianceClose(ctx, { month, serviceId }, viewId);
  await complianceCloseCsv(ctx, saved.close.id, exportId);
  const events = await db.auditEvent.findMany({ where: { tenantId: ctx.tenantId, requestId: { in: [viewId, exportId] } } });
  expect(events).toHaveLength(2);
  expect(events.every(event => event.serviceId === serviceId && event.resourceId === saved.close.id)).toBe(true);
  await restrict(); await db.serviceGrant.deleteMany({ where: { memberId: ctx.member.id } });
  const deniedId = randomUUID();
  await expect(complianceCloseCsv(ctx, saved.close.id, deniedId)).rejects.toMatchObject({ status: 404 });
  expect(await db.auditEvent.count({ where: { requestId: deniedId } })).toBe(0);
});
test("서비스 키와 스냅샷 범위가 다른 손상 기록은 반환하지 않는다", async () => {
  const saved = await create(serviceId);
  const row = await db.complianceClose.findUniqueOrThrow({ where: { id: saved.close.id } });
  await expect(db.complianceClose.update({ where: { id: row.id }, data: { snapshot: { ...row.snapshot as object, serviceId: otherServiceId } } })).rejects.toMatchObject({ code: "P2039" });
  await expect(db.complianceClose.delete({ where: { id: row.id } })).rejects.toMatchObject({ code: "P2039" });
  // Legacy malformed inserts remain readable only through validation; updates are now blocked by the DB.
  const badMonth = "2026-08";
  const bad = await db.complianceClose.create({ data: { tenantId: ctx.tenantId, serviceKey: serviceId, month: badMonth, createdBy: ctx.user.id,
    snapshot: { ...row.snapshot as object, month: badMonth, serviceId: otherServiceId } } });
  await expect(readComplianceClose(ctx, { month: badMonth, serviceId })).rejects.toMatchObject({ status: 409, code: "CLOSE_INVALID" });
  await expect(closeComplianceMonth(ctx, { month: badMonth, serviceId }, randomUUID())).rejects.toMatchObject({ status: 409, code: "CLOSE_INVALID" });
  await expect(complianceCloseCsv(ctx, bad.id)).rejects.toMatchObject({ status: 409, code: "CLOSE_INVALID" });
});
