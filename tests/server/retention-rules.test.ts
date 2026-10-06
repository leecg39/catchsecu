import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { createRetentionRule, readRetentionRule, updateRetentionRule, archiveRetentionRule, listRetentionRules } from "@/server/retention-rules";
import * as auditModule from "@/server/audit";
const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (!["/catchsecu_test", "/catchsecu_mock_admin"].includes(database.pathname) || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Retention-rules!123";
function req(path: string, cookie = "", method = "GET", input?: unknown) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => { await db.$disconnect(); });
async function owner() {
  const email = "retention-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "보유 기간 검증", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "보유 기간 회사", publicName: "보유 기간", policy: { create: { retentionDays: 365, allowRetentionDesignation: true } },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "보유 서비스", externalName: "보유" } } }, include: { services: true, policy: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password })); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return { company, cookie, serviceId: company.services[0].id };
}
async function setup() {
  const f = await owner();
  const ctx = await requireContext(new Headers({ cookie: f.cookie }), "security.write");
  const input = { serviceId: f.serviceId, retentionDays: 30, reason: "모의 보유기간" }, key = randomUUID();
  const created = await createRetentionRule(ctx, input, key, randomUUID());
  return { ...f, ctx, input, key, rule: created.body };
}
test("생성 재요청은 현재 규칙을 반환하며 보관 뒤에는 410이다", async () => {
  const f = await setup();
  await updateRetentionRule(f.ctx, f.rule.id, { version: f.rule.version, retentionDays: 60 }, randomUUID());
  const replay = await createRetentionRule(f.ctx, f.input, f.key, randomUUID());
  expect(replay.body.retentionDays).toBe(60);
  expect(replay.body.version).toBe(2);
  await archiveRetentionRule(f.ctx, f.rule.id, 2, randomUUID());
  await expect(createRetentionRule(f.ctx, f.input, f.key, randomUUID())).rejects.toMatchObject({ status: 410 });
});
test("멤버 권한 회수 후 같은 생성 키의 재요청도 거부된다", async () => {
  const f = await setup();
  const successor = await db.user.create({ data: { name: "인계 소유자", email: "successor-" + randomUUID() + "@catchsecu.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: f.ctx.tenantId, userId: successor.id, role: "owner" } });
  await db.membership.update({ where: { id: f.ctx.member.id }, data: { role: "viewer" } });
  await expect(createRetentionRule(f.ctx, f.input, f.key, randomUUID())).rejects.toMatchObject({ status: 403 });
});
test("현재 보안 정책의 MFA 요구는 오래된 context의 조회·수정에도 적용된다", async () => {
  const f = await setup();
  await db.securityPolicy.update({ where: { tenantId: f.ctx.tenantId }, data: { requireMfa: true } });
  for (const call of [() => listRetentionRules(f.ctx, {}), () => readRetentionRule(f.ctx, f.rule.id), () => updateRetentionRule(f.ctx, f.rule.id, { version: 1, retentionDays: 90 }, randomUUID())])
    await expect(call()).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
});
test("보유기간 수정 중 세션이 만료되면 규칙과 감사가 롤백된다", async () => {
  const f = await setup(), realAudit = auditModule.audit;
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    await realAudit(...args);
    if (args[3] === "retention_rule.updated") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(f.ctx.session.expiresAt.getTime() + 1000); }
  });
  await expect(updateRetentionRule(f.ctx, f.rule.id, { version: 1, retentionDays: 90 }, randomUUID())).rejects.toMatchObject({ status: 401 });
  expect((await db.retentionRule.findUniqueOrThrow({ where: { id: f.rule.id } })).retentionDays).toBe(30);
  expect(await db.auditEvent.count({ where: { resourceId: f.rule.id, action: "retention_rule.updated" } })).toBe(0);
});
test("보관 규칙을 동시 재생성해도 한 요청만 활성화한다", async () => {
  const f = await setup();
  await archiveRetentionRule(f.ctx, f.rule.id, 1, randomUUID());
  const results = await Promise.allSettled([createRetentionRule(f.ctx, f.input, randomUUID(), randomUUID()), createRetentionRule(f.ctx, f.input, randomUUID(), randomUUID())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { status: 409, code: "RULE_EXISTS" } });
  expect((await db.retentionRule.findUniqueOrThrow({ where: { id: f.rule.id } })).version).toBe(3);
});
