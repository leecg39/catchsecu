import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { createDocument, publishDocument, readDisplay, updateDisplay } from "@/server/documents";
import { emptyDisplay } from "@/contracts/documents";
import { POST as createPurpose } from "@/app/api/v1/processing-purposes/route";

const clock = vi.hoisted(() => ({ advance: false }));
vi.mock("@/server/audit", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    await actual.audit(...args);
    if (clock.advance && args[3] === "service.consent_display_updated") vi.setSystemTime(Date.now() + 120_000);
  } };
});
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated local test DB required.");
const email = "display-authority@example.test", password = "Display-authority!123", origin = new URL(env.BETTER_AUTH_URL).origin;
let userId: string, ctx: Context, serviceId: string, cookie: string;
function request(path: string, input?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { origin, cookie: cookie ?? "",
    ...(input ? { "content-type": "application/json", "idempotency-key": randomUUID() } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  expect((await auth.handler(request("/auth/sign-up/email", { email, password, name: "표시 설정 검증" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
});
beforeEach(async () => {
  clock.advance = false; vi.useRealTimers();
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "표시 설정 검증", publicName: "표시 설정 검증",
    memberships: { create: { userId, role: "owner" } }, services: { create: { name: "표시 서비스", externalName: "표시 서비스" } },
  }, include: { services: true } });
  serviceId = company.services[0].id;
  const signed = await auth.handler(request("/auth/sign-in/email", { email, password }));
  expect(signed.status).toBe(200); cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(request("/context").headers, "service.manage");
});
afterAll(async () => { clock.advance = false; vi.useRealTimers(); await db.$disconnect(); });
const operations = {
  read: () => readDisplay(ctx, serviceId, "collection"),
  write: () => updateDisplay(ctx, serviceId, "collection", { ...emptyDisplay(), startText: "저장하면 안 되는 문구" }, randomUUID()),
};
for (const operation of ["read", "write"] as const) {
  test(`${operation}: 요청 인증 후 선택 회사 변경을 거부한다`, async () => {
    const other = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
    await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: other.id } });
    await expect(operations[operation]()).rejects.toMatchObject({ code: "COMPANY_CHANGED", status: 403 });
    expect(await db.serviceConsentDisplay.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  });
  test(`${operation}: 요청 인증 후 추가된 MFA 정책을 적용한다`, async () => {
    await db.securityPolicy.create({ data: { tenantId: ctx.tenantId, requireMfa: true, passwordMonths: 0 } });
    await expect(operations[operation]()).rejects.toMatchObject({ code: "MFA_REQUIRED", status: 403 });
    expect(await db.serviceConsentDisplay.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  });
  test(`${operation}: 요청 인증 후 삭제된 세션을 거부한다`, async () => {
    await db.session.delete({ where: { id: ctx.session.id } });
    await expect(operations[operation]()).rejects.toMatchObject({ status: 401 });
  });
}
test("감사 저장 후 세션이 만료되면 표시 설정과 감사를 함께 롤백한다", async () => {
  const count = await db.auditEvent.count({ where: { tenantId: ctx.tenantId } });
  await db.session.update({ where: { id: ctx.session.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
  await expect(operations.write()).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  expect(await db.serviceConsentDisplay.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(count);
});
test("저장 중 게시 기간이 끝나면 만료된 처리방침 연결을 롤백한다", async () => {
  const purposeResponse = await createPurpose(request("/processing-purposes", { serviceId, name: "안내 목적", purpose: "시험 안내", lawfulBasis: "consent", basisReference: "",
    items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] }));
  expect(purposeResponse.status).toBe(201); const purpose = await purposeResponse.json();
  const doc = await db.$transaction(tx => createDocument(tx, ctx, { serviceId, type: "privacy_policy", title: "시험 처리방침", body: "시험 본문", refusalNotice: "거부 가능", rightsContact: "시험 창구", effectiveDate: "2026-10-01", purposeIds: [purpose.id], recipientIds: [] }, randomUUID()));
  const published = await publishDocument(ctx, doc.id, { version: doc.version, expiresAt: new Date(Date.now() + 90_000).toISOString() }, randomUUID());
  const count = await db.auditEvent.count({ where: { tenantId: ctx.tenantId } });
  vi.useFakeTimers({ toFake: ["Date"] }); clock.advance = true;
  await expect(updateDisplay(ctx, serviceId, "collection", { ...emptyDisplay(), policyMode: "document", publicationId: published.publicationId }, randomUUID())).rejects.toMatchObject({ status: 422, code: "INVALID_POLICY_LINK" });
  expect(await db.serviceConsentDisplay.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(count);
});
