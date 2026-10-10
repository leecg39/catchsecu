import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { listInvoices, listUsageEvents } from "@/server/billing-reads";
import { GET as listInvoicesRoute } from "@/app/api/v1/invoices/route";
import { GET as listUsageEventsRoute } from "@/app/api/v1/usage-events/route";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
const email = "billing-read-" + randomUUID() + "@catchsecu.test", password = "Billing-read!123";
let userId: string, ownerId: string, ctx: Context, activeCookie: string;
function request(path: string, body: unknown) {
  return new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(request("sign-up/email", { email, password, name: "청구 조회 담당자" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
  ownerId = (await db.user.create({ data: { name: "소유자", email: randomUUID() + "@catchsecu.test", emailVerified: true } })).id;
});
beforeEach(async () => {
  await db.rateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "청구 조회", publicName: "청구 조회", policy: { create: { passwordMonths: 0 } }, memberships: { create: [{ userId, role: "billing" }, { userId: ownerId, role: "owner" }] } } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  activeCookie = cookie;
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(new Headers({ cookie }), "billing.read");
});
afterAll(async () => { await db.$disconnect(); });
for (const [name, read] of Object.entries({ invoices: listInvoices, usage: listUsageEvents })) {
  test(`${name}: 현재 권한이 있는 빈 회사는 페이지를 반환한다`, async () => {
    expect(await read(ctx, {})).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
  });
  test(`${name}: 문맥 생성 후 역할 회수는 조회를 거부한다`, async () => {
    await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
    await expect(read(ctx, {})).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
  test(`${name}: 문맥 생성 후 세션 회수는 조회를 거부한다`, async () => {
    await db.session.delete({ where: { id: ctx.session.id } });
    await expect(read(ctx, {})).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
  });
  test(`${name}: 변경된 MFA 정책은 조회에 즉시 적용된다`, async () => {
    await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
    await expect(read(ctx, {})).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
  });
  test(`${name}: 다른 회사로 전환된 세션은 이전 회사 조회를 거부한다`, async () => {
    const other = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사" } });
    await db.session.update({ where: { id: ctx.session.id }, data: { activeCompanyId: other.id } });
    await expect(read(ctx, {})).rejects.toMatchObject({ status: 403, code: "COMPANY_CHANGED" });
  });
}
test("청구서·사용량 HTTP 조회 경로가 현재 billing 권한과 빈 페이지를 반환한다", async () => {
  for (const [path, handler] of [["/invoices", listInvoicesRoute], ["/usage-events", listUsageEventsRoute]] as const) {
    const response = await handler(new Request(origin + "/api/v1" + path, { headers: { origin, cookie: activeCookie } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
    expect((await handler(new Request(origin + "/api/v1" + path, { headers: { origin } }))).status).toBe(401);
  }
});
