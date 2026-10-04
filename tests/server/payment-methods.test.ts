import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { resolveMethodToken } from "@/server/payment-methods";
import { GET as listMethods, POST as createMethod } from "@/app/api/v1/billing/methods/route";
import { PATCH as updateMethod, DELETE as removeMethod } from "@/app/api/v1/billing/methods/[id]/route";
import { POST as createOrder } from "@/app/api/v1/billing/orders/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Payment-method!123";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function account(role: Role) {
  const email = "pm-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "결제", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "회사" + randomUUID().slice(0, 8), publicName: "회사", policy: { create: {} }, memberships: { create: { userId: user.id, role } } } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password }));
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return { company, cookie };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("등록·목록·대표수단 전환과 DTO 비밀 미노출", async () => {
  const { company, cookie } = await account("owner");
  const first = await createMethod(req("/billing/methods", cookie, "POST", { token: "pm_first_token_abcd", kind: "card", label: "법인카드" }));
  expect(first.status).toBe(201);
  const one = await first.json();
  expect(one.isDefault).toBe(true);
  expect(JSON.stringify(one)).not.toMatch(/tokenHash|tokenCipher|pm_first/);
  const second = await createMethod(req("/billing/methods", cookie, "POST", { token: "pm_second_token_efgh", kind: "transfer", label: "계좌이체" }));
  expect((await second.json()).isDefault).toBe(false);
  await createMethod(req("/billing/methods", cookie, "POST", { token: "pm_third_token_ijkl", kind: "card", label: "대표전환", setDefault: true }));
  const list = await (await listMethods(req("/billing/methods", cookie))).json();
  expect(list).toHaveLength(3);
  expect(list.filter((m: { isDefault: boolean }) => m.isDefault)).toHaveLength(1);
  expect(list[0].label).toBe("대표전환");
  expect(await resolveMethodToken(company.id, list[0].id)).toBe("pm_third_token_ijkl");
});

test("카드 원문·중복 토큰·버전 경합·권한 경계", async () => {
  const { company, cookie } = await account("owner");
  const viewer = await account("viewer");
  const panToken = await createMethod(req("/billing/methods", cookie, "POST", { token: "pm_4111111111111111", kind: "card", label: "x" }));
  expect(panToken.status).toBe(422);
  const panLabel = await createMethod(req("/billing/methods", cookie, "POST", { token: "pm_ok_token_1234", kind: "card", label: "카드 4111-1111-1111-1111" }));
  expect(panLabel.status).toBe(422);
  expect(await db.paymentMethod.count()).toBe(0);
  const badToken = await createMethod(req("/billing/methods", cookie, "POST", { token: "4111111111111111", kind: "card", label: "x" }));
  expect(badToken.status).toBe(422);
  const made = await (await createMethod(req("/billing/methods", cookie, "POST", { token: "pm_dup_token_aaaa", kind: "card", label: "A" }))).json();
  expect((await createMethod(req("/billing/methods", cookie, "POST", { token: "pm_dup_token_aaaa", kind: "card", label: "B" }))).status).toBe(409);
  expect((await updateMethod(req("/billing/methods/" + made.id, cookie, "PATCH", { version: made.version + 5, label: "stale" }))).status).toBe(409);
  expect((await updateMethod(req("/billing/methods/" + made.id, cookie, "PATCH", { version: made.version, label: "새이름" }))).status).toBe(200);
  expect((await updateMethod(req("/billing/methods/" + made.id, viewer.cookie, "PATCH", { version: made.version + 1, label: "x" }))).status).toBe(403);
  expect((await listMethods(req("/billing/methods", viewer.cookie))).status).toBe(403);
  expect((await listMethods(req("/billing/methods"))).status).toBe(401);
  const other = await db.paymentMethod.findFirstOrThrow({ where: { tenantId: company.id } });
  expect(other.label).toBe("새이름");
});

test("대표 삭제 승격·삭제 경합·타사 격리·주문 연결", async () => {
  const a = await account("owner");
  const b = await account("owner");
  const m1 = await (await createMethod(req("/billing/methods", a.cookie, "POST", { token: "pm_m1_token_0001", kind: "card", label: "첫째" }))).json();
  const m2 = await (await createMethod(req("/billing/methods", a.cookie, "POST", { token: "pm_m2_token_0002", kind: "card", label: "둘째" }))).json();
  const m3 = await (await createMethod(req("/billing/methods", a.cookie, "POST", { token: "pm_m3_token_0003", kind: "card", label: "셋째" }))).json();
  expect((await removeMethod(req("/billing/methods/" + m2.id, b.cookie, "DELETE", { version: m2.version }))).status).toBe(404);
  expect((await removeMethod(req("/billing/methods/" + m1.id, a.cookie, "DELETE", { version: m1.version + 9 }))).status).toBe(409);
  const removed = await (await removeMethod(req("/billing/methods/" + m1.id, a.cookie, "DELETE", { version: m1.version }))).json();
  expect(removed.status).toBe("revoked");
  const after = await (await listMethods(req("/billing/methods", a.cookie))).json();
  expect(after).toHaveLength(2);
  expect(after.filter((m: { isDefault: boolean }) => m.isDefault)).toHaveLength(1);
  expect(after.find((m: { id: string }) => m.id === m2.id).isDefault).toBe(true);
  const withRevoked = await (await listMethods(req("/billing/methods?includeRevoked=true", a.cookie))).json();
  expect(withRevoked).toHaveLength(3);
  expect((await removeMethod(req("/billing/methods/" + m1.id, a.cookie, "DELETE", { version: removed.version }))).status).toBe(404);

  const plan = await db.billingPlan.create({ data: { id: "plan-" + randomUUID(), name: "유료" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000, currency: "KRW", features: {}, orderable: true, effectiveFrom: new Date("2026-01-01") } });
  const subscription = await db.billingSubscription.create({ data: { tenantId: a.company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000, currency: "KRW" } });
  const bSubscription = await db.billingSubscription.create({ data: { tenantId: b.company.id, planId: plan.id, planVersionId: version.id, status: "pending", priceKrw: 12000, currency: "KRW" } });
  const crossOrder = await createOrder(req("/billing/orders", b.cookie, "POST", { subscriptionId: bSubscription.id, methodId: m3.id }, randomUUID()));
  expect(crossOrder.status).toBe(404);
  const revokedMethodOrder = await createOrder(req("/billing/orders", a.cookie, "POST", { subscriptionId: subscription.id, methodId: m1.id }, randomUUID()));
  expect(revokedMethodOrder.status).toBe(409);
  const ok = await createOrder(req("/billing/orders", a.cookie, "POST", { subscriptionId: subscription.id, methodId: m3.id }, randomUUID()));
  expect(ok.status).toBe(201);
  expect((await ok.json()).methodId).toBe(m3.id);
  expect((await removeMethod(req("/billing/methods/" + m3.id, a.cookie, "DELETE", { version: m3.version }))).status).toBe(409);
});
