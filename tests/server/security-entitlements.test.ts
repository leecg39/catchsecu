import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { lockSecurityEntitlements } from "@/server/feature-entitlements";
import { planCapabilities, securityCapabilities, type SecurityCapability } from "@/contracts/feature-entitlements";
import { readPolicy, updatePolicy, policyDefaults } from "@/server/security-policy";
import { createIpRule, updateIpRule, deleteIpRule, changeIpAccess, listIpRules } from "@/server/ip-access";
import { createMfaException, updateMfaException, deleteMfaException, changeMfaPolicy, listMfaMembers } from "@/server/mfa-policy";
import { ipRuleQuery } from "@/contracts/ip-access";
import { mfaMemberQuery } from "@/contracts/mfa-policy";
import { signClientIp } from "@/server/client-ip";
import * as auditModule from "@/server/audit";
import { expireSubscriptions } from "@/server/subscription-worker";

const url = new URL(env.DATABASE_URL);
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Feature-entitlement!123", key = randomBytes(32).toString("hex"), oldKey = process.env.APP_IP_SIGNING_KEY;
let ctx: Context, targetId: string;
const cookieOf = (r: Response) => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
beforeEach(async () => {
  process.env.APP_IP_SIGNING_KEY = key;
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  const tenant = await db.company.create({ data: { name: "기능 계약 시험", publicName: "기능 계약", policy: { create: { passwordMonths: 0 } } } });
  let cookie = "";
  const call = (path: string, body: unknown) => auth.handler(new Request(origin + "/api/v1/auth/" + path,
    { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
  for (const role of ["owner", "admin"] as const) {
    const email = role + "@feature.test";
    expect((await call("sign-up/email", { email, password, name: role })).status).toBe(200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    const member = await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role } });
    if (role === "admin") targetId = member.id;
  }
  cookie = cookieOf(await call("sign-in/email", { email: "owner@feature.test", password }));
  const enabled = await call("two-factor/enable", { password }); expect(enabled.status).toBe(200);
  const payload = await enabled.json(); cookie = cookieOf(enabled) || cookie;
  const secret = new TextDecoder().decode(base32.decode(new URL(payload.totpURI).searchParams.get("secret")!));
  const verified = await call("two-factor/verify-totp", { code: await createOTP(secret, { digits: 6, period: 30 }).totp() });
  expect(verified.status).toBe(200); cookie = cookieOf(verified) || cookie;
  ctx = await requireContext(new Headers({ cookie, "x-catchsecu-client-ip": "192.0.2.1", "x-catchsecu-ip-proof": signClientIp("192.0.2.1", key) }), "security.read");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => { if (oldKey === undefined) delete process.env.APP_IP_SIGNING_KEY; else process.env.APP_IP_SIGNING_KEY = oldKey; await db.$disconnect(); });

async function trial(capabilities: SecurityCapability[] = [...securityCapabilities], options: { tenantId?: string; start?: Date; cancelAt?: Date } = {}) {
  const version = await db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000) + 100,
    cycle: "trial", priceKrw: 0, features: [], capabilities } });
  const periodStart = options.start ?? new Date();
  return db.billingSubscription.create({ data: { tenantId: options.tenantId ?? ctx.tenantId, planId: "trial", planVersionId: version.id,
    status: "trialing", activationSource: "trial", priceKrw: 0, periodStart, periodEnd: new Date(periodStart.getTime() + 7 * 86400000), cancelAt: options.cancelAt } });
}
const access = () => db.$transaction(async tx => (await lockSecurityEntitlements(tx, ctx.tenantId)).snapshot());
const createIp = (requestKey = randomUUID()) => createIpRule(ctx, { tenantId: ctx.tenantId, cidr: "192.0.2.1", description: "기능 검증", enabled: true }, requestKey, randomUUID());
const createException = () => createMfaException(ctx, { tenantId: ctx.tenantId, memberId: targetId, reason: "인증 기기 교체", expiresAt: new Date(Date.now() + 3600000).toISOString() }, randomUUID(), randomUUID());

test.each(["unsubscribed", "not_included", "expired", "pending", "included"] as const)("구독 상태 %s를 실제 저장된 행으로 구분한다", async state => {
  if (state !== "unsubscribed") await trial(state === "not_included" ? [] : undefined,
    state === "expired" ? { start: new Date(Date.now() - 8 * 86400000) } : state === "pending" ? { start: new Date(Date.now() + 86400000) } : {});
  expect((await access())["security.ip_access"]).toMatchObject({ state, available: state === "included" });
  expect((await readPolicy(ctx)).canManage).toBe(state === "included");
  expect((await listIpRules(ctx, ipRuleQuery.parse({}))).policy.canManage).toBe(state === "included");
  expect((await listMfaMembers(ctx, mfaMemberQuery.parse({}))).policy.canManage).toBe(state === "included");
});
test("타회사 구독은 권한을 부여하지 않는다", async () => {
  const foreign = await db.company.create({ data: { name: "타회사", publicName: "타회사" } });
  await trial(undefined, { tenantId: foreign.id });
  await expect(createIp()).rejects.toMatchObject({ status: 402, code: "SUBSCRIPTION_REQUIRED" });
});
test("예약 해지 기한은 worker가 실행되기 전에도 즉시 적용된다", async () => {
  await trial(undefined, { start: new Date(Date.now() - 3600000), cancelAt: new Date(Date.now() - 1000) });
  expect((await access())["security.ip_access"].state).toBe("expired");
  await expect(createIp()).rejects.toMatchObject({ status: 402 });
});
test("회사 정책의 MFA 변경 우회도 별도 기능 권한을 요구한다", async () => {
  await trial(["security.company_policy"]);
  await expect(updatePolicy(ctx, 1, { ...policyDefaults, requireMfa: true }, randomUUID())).rejects.toMatchObject({ code: "FEATURE_NOT_INCLUDED" });
  expect((await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } })).version).toBe(1);
});
test("포함된 기능은 실제 CRUD가 되고 MFA 예외 및 IP 삭제도 반영된다", async () => {
  await trial();
  const rule = (await createIp()).body;
  await updateIpRule(ctx, rule.id, { ...rule, version: 1, description: "변경" }, randomUUID());
  await changeIpAccess(ctx, { tenantId: ctx.tenantId, version: 0, enabled: true }, randomUUID());
  await changeIpAccess(ctx, { tenantId: ctx.tenantId, version: 1, enabled: false }, randomUUID());
  await deleteIpRule(ctx, rule.id, { tenantId: ctx.tenantId, version: 2 }, randomUUID());
  const exception = (await createException()).body;
  await updateMfaException(ctx, exception.id, { tenantId: ctx.tenantId, version: 1, reason: "교체 기기 수령", expiresAt: exception.expiresAt }, randomUUID());
  await deleteMfaException(ctx, exception.id, { tenantId: ctx.tenantId, version: 2 }, randomUUID());
  await changeMfaPolicy(ctx, { tenantId: ctx.tenantId, version: 1, required: true }, randomUUID());
  expect(await db.ipRule.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
  expect(await db.mfaException.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
});
test.each(["policy", "ip-create", "ip-update", "ip-delete", "ip-toggle", "mfa-create", "mfa-update", "mfa-delete", "mfa-toggle", "ip-replay", "mfa-replay"])("만료 후 %s 경로는 쓰기·감사 추가 없이 거부한다", async operation => {
  const end = new Date(Date.now() + 60000), sub = await trial(undefined, { cancelAt: end });
  const ipKey = randomUUID(), rule = (await createIp(ipKey)).body;
  const payload = { tenantId: ctx.tenantId, memberId: targetId, reason: "인증 기기 교체", expiresAt: new Date(Date.now() + 3600000).toISOString() }, mfaKey = randomUUID();
  const exception = (await createMfaException(ctx, payload, mfaKey, randomUUID())).body;
  const before = await db.auditEvent.count({ where: { tenantId: ctx.tenantId } });
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(end.getTime() + 1);
  const operations: Record<string, () => Promise<unknown>> = {
    policy: () => updatePolicy(ctx, 1, policyDefaults, randomUUID()), "ip-create": () => createIp(),
    "ip-update": () => updateIpRule(ctx, rule.id, { ...rule, description: "금지" }, randomUUID()),
    "ip-delete": () => deleteIpRule(ctx, rule.id, rule, randomUUID()),
    "ip-toggle": () => changeIpAccess(ctx, { tenantId: ctx.tenantId, version: 0, enabled: true }, randomUUID()),
    "mfa-create": createException, "mfa-update": () => updateMfaException(ctx, exception.id, { ...exception, reason: "금지된 수정" }, randomUUID()),
    "mfa-delete": () => deleteMfaException(ctx, exception.id, exception, randomUUID()),
    "mfa-toggle": () => changeMfaPolicy(ctx, { tenantId: ctx.tenantId, version: 1, required: true }, randomUUID()),
    "ip-replay": () => createIp(ipKey), "mfa-replay": () => createMfaException(ctx, payload, mfaKey, randomUUID()),
  };
  await expect(operations[operation]()).rejects.toMatchObject({ status: 402, code: "SUBSCRIPTION_REQUIRED" });
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(before);
  expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("trialing");
  expect((await db.ipRule.findUniqueOrThrow({ where: { id: rule.id } })).version).toBe(1);
  expect((await db.mfaException.findUniqueOrThrow({ where: { id: exception.id } })).version).toBe(1);
});
test.each(["ip", "policy", "mfa"])("%s 저장 도중 구독이 만료되면 데이터와 감사를 롤백한다", async feature => {
  const end = new Date(Date.now() + 60000); await trial(undefined, { cancelAt: end });
  const countBefore = await db.auditEvent.count({ where: { tenantId: ctx.tenantId } });
  const realAudit = auditModule.audit;
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => { await realAudit(...args); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(end.getTime() + 1); });
  await expect(feature === "ip" ? createIp() : feature === "mfa" ? createException() : updatePolicy(ctx, 1, policyDefaults, randomUUID())).rejects.toMatchObject({ status: 402 });
  expect(await db.ipRule.count()).toBe(0); expect(await db.mfaException.count()).toBe(0);
  expect((await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } })).version).toBe(1);
  expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId } })).toBe(countBefore);
});
test("기능 배열은 표시 문구와 분리되고 잘못된 키·중복·기존 버전 수정은 거부된다", async () => {
  expect(planCapabilities.safeParse(["Enterprise"]).success).toBe(false);
  expect(planCapabilities.safeParse(["security.ip_access", "security.ip_access"]).success).toBe(false);
  const sub = await trial([]);
  await expect(db.billingPlanVersion.update({ where: { id: sub.planVersionId }, data: { capabilities: ["security.ip_access"] } })).rejects.toThrow();
  for (const capabilities of [["unknown"], ["security.ip_access", "security.ip_access"]]) {
    await expect(db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000), cycle: "trial", priceKrw: 0, features: [], capabilities } })).rejects.toThrow();
  }
});
test("설정 저장 중 구독 해지 변경은 실제 DB 행 잠금으로 직렬화된다", async () => {
  const sub = await trial();
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const realAudit = auditModule.audit;
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    await realAudit(...args); if (args[3] === "ip_rule.created") { entered(); await barrier; }
  });
  const saving = createIp();
  try {
    await reached;
    await expect(db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
      return tx.billingSubscription.update({ where: { id: sub.id }, data: { cancelAt: new Date(Date.now() + 60000), version: { increment: 1 } } });
    })).rejects.toThrow(/lock timeout/);
  } finally { release(); }
  expect((await saving).status).toBe(201);
  expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).cancelAt).toBeNull();
  await db.billingSubscription.update({ where: { id: sub.id }, data: { cancelAt: new Date(Date.now() + 60000), version: { increment: 1 } } });
  expect((await db.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).version).toBe(2);
});
test("구독이 만료되어도 저장된 IP·MFA 보호는 집행된다", async () => {
  await trial(undefined, { start: new Date(Date.now() - 8 * 86400000) });
  await db.ipRule.create({ data: { tenantId: ctx.tenantId, cidr: "198.51.100.1/32", enabled: true } });
  await db.ipAccessPolicy.create({ data: { tenantId: ctx.tenantId, enabled: true } });
  await expect(readPolicy(ctx)).rejects.toMatchObject({ code: "IP_NOT_ALLOWED" });
  await db.ipAccessPolicy.update({ where: { tenantId: ctx.tenantId }, data: { enabled: false, version: { increment: 1 } } });
  const login = await auth.handler(new Request(origin + "/api/v1/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: "admin@feature.test", password }) }));
  const admin = await requireContext(new Headers({ cookie: cookieOf(login) }), "security.read");
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
  await expect(readPolicy(admin)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
});
test("구독 만료 worker와 설정 저장은 잠금 순서가 뒤집혀 교착하지 않는다", async () => {
  await trial(undefined, { start: new Date(Date.now() - 8 * 86400000) });
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const realAudit = auditModule.audit;
  vi.spyOn(auditModule, "audit").mockImplementation(async (...args) => {
    if (args[3] === "billing.trial_expired") { entered(); await barrier; } await realAudit(...args);
  });
  const worker = expireSubscriptions();
  await reached;
  const writing = createIp();
  // Attach rejection handling before releasing the deterministic transaction barrier.
  const results = Promise.allSettled([worker, writing]);
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
      const rows = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS blocked`;
      blocked = rows[0].blocked; if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(blocked).toBe(true);
  } finally { release(); }
  const [expired, saved] = await results;
  expect(expired).toMatchObject({ status: "fulfilled", value: 1 });
  expect(saved, saved.status === "rejected" ? JSON.stringify({ code: saved.reason.code, deadlock: /deadlock detected/i.test(String(saved.reason.message)) }) : "unexpected save")
    .toMatchObject({ status: "rejected", reason: { status: 402, code: "SUBSCRIPTION_REQUIRED" } });
});
