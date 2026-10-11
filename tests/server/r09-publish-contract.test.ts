import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { requireContext } from "@/server/context";
import type { Role } from "@/generated/prisma/client";
import { type Capability, roleCapabilities } from "@/server/permissions";
import { requestApproval, decideApproval } from "@/server/approvals";
import { createFixedUrl } from "@/server/fixed-urls";
import { publishForm } from "@/server/forms";
import { GET as formGet, POST as action } from "@/app/api/v1/forms/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as serviceCreate } from "@/app/api/v1/services/route";
import { POST as decide } from "@/app/api/v1/approvals/[...segments]/route";
import { POST as fixedCreate } from "@/app/api/v1/fixed-urls/route";
import { GET as resolveUrl } from "@/app/api/v1/public/urls/[slug]/route";
import { GET as publicGet } from "@/app/api/v1/public/forms/[...segments]/route";

const fault = vi.hoisted(() => ({ actions: new Set<string>() }));
vi.mock("@/server/audit", async original => {
  const actual = await original<typeof import("@/server/audit")>();
  return { ...actual, audit: async (...args: Parameters<typeof actual.audit>) => {
    if (fault.actions.has(args[3])) throw new Error("synthetic R09 audit storage failure");
    return actual.audit(...args);
  } };
});

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
const origin = env.BETTER_AUTH_URL, password = "R09-contract!123";
function req(path: string, cookie = "", method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie,
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function person(name: string) {
  const email = "r09-" + name + "-" + randomUUID() + "@test.local";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name, email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password })); expect(login.status).toBe(200);
  return { user, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function member(tenantId: string, serviceId: string, name: string, role: Role, capabilities?: Capability[]) {
  const p = await person(name);
  const row = await db.membership.create({ data: { tenantId, userId: p.user.id, role } });
  if (!["owner", "admin"].includes(role))
    await db.serviceGrant.create({ data: { tenantId, memberId: row.id, serviceId, capabilities: capabilities ?? [...roleCapabilities(role)] } });
  return { ...p, member: row };
}
const content = { body: "R09 계약 본문", questions: [{ id: randomUUID(), type: "단문형 답변", label: "참가자", required: true }],
  consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 };
type Member = Awaited<ReturnType<typeof member>>;
type Fixture = { company: { id: string }; serviceId: string } & Record<string, Member>;
async function fixture(roles: ("owner" | "editor" | "admin" | "security")[] = ["owner", "editor"], trial = true) {
  const company = await db.company.create({ data: { name: "R09 계약 회사", publicName: "R09", policy: { create: {} },
    services: { create: [{ name: "R09 서비스", externalName: "R09" }] } }, include: { services: true } });
  if (trial) await grantSecurityTestTrials();
  const serviceId = company.services[0].id, result = { company, serviceId } as unknown as Fixture;
  for (const role of roles) result[role] = await member(company.id, serviceId, role, role);
  return result;
}
// 결제 공급자를 흉내내지 않고 DB의 정상 pending→active 전이로 이미 끝난 유료 구독을 만든다.
async function expiredSubscription(tenantId: string) {
  const plan = await db.billingPlan.create({ data: { id: randomUUID(), name: "R09 유료" } });
  const version = await db.billingPlanVersion.create({ data: { planId: plan.id, number: 1, cycle: "month", priceKrw: 12000,
    features: {}, orderable: true, effectiveFrom: new Date(Date.now() - 90 * 86400e3) } });
  const pending = await db.billingSubscription.create({ data: { tenantId, planId: plan.id, planVersionId: version.id,
    status: "pending", priceKrw: 12000, currency: "KRW", events: { create: { version: 1, kind: "purchase_requested", detail: {} } } } });
  const order = await db.paymentOrder.create({ data: { tenantId, subscriptionId: pending.id, amount: 12000, currency: "KRW", status: "paid" } });
  const active = await db.billingSubscription.update({ where: { id: pending.id }, data: { status: "active",
    activationSource: "payment", periodStart: new Date(Date.now() - 31 * 86400e3), periodEnd: new Date(Date.now() - 86400e3),
    version: { increment: 1 }, events: { create: { version: 2, kind: "activated", detail: { orderId: order.id } } } } });
  await db.billingSubscription.update({ where: { id: active.id }, data: { status: "expired", version: { increment: 1 },
    events: { create: { version: 3, kind: "expired", detail: { reason: "period_end" } } } } });
}
async function newForm(fx: Fixture, who = "editor", title = "R09 계약 폼") {
  const response = await formCreate(req("/forms", fx[who].cookie, "POST", { serviceId: fx.serviceId, title, content }, { "idempotency-key": randomUUID() }));
  expect(response.status).toBe(201); return response.json();
}
async function readForm(fx: Fixture, id: string, who = "editor") {
  const response = await formGet(req("/forms/" + id, fx[who].cookie)); expect(response.status).toBe(200); return response.json();
}
async function request(fx: Fixture, formId: string, who = "editor") {
  const form = await readForm(fx, formId, who);
  const response = await action(req("/forms/" + formId + "/approvals", fx[who].cookie, "POST",
    { version: form.version, message: "R09 검토 요청", reference: "R09-REF" }, { "idempotency-key": randomUUID() }));
  expect(response.status).toBe(201); return response.json();
}
const publish = (fx: Fixture, formId: string, version: number, who = "editor") =>
  action(req("/forms/" + formId + "/publish", fx[who].cookie, "POST", { version }, { "idempotency-key": randomUUID() }));
const decision = (fx: Fixture, id: string, who: string, body: Record<string, unknown>) =>
  decide(req("/approvals/" + id + "/decision", fx[who].cookie, "POST", body));
beforeEach(async () => { fault.actions.clear();
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("구성된 승인 역할의 자기승인은 허용하고 미구성 역할의 자기 결정은 거부한다", async () => {
  const fx = await fixture(["owner", "editor", "admin", "security"]);
  await db.securityPolicy.update({ where: { tenantId: fx.company.id }, data: { requireApproval: true, approvalRoles: ["owner", "admin"] } });
  const form = await newForm(fx, "admin"), approval = await request(fx, form.id, "admin");
  expect((await decision(fx, approval.id, "admin", { version: 1, decision: "approved", reason: "본인 검토 후 승인" })).status).toBe(200);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "approved", decidedBy: fx.admin.member.id });
  const published = await publish(fx, form.id, (await readForm(fx, form.id, "admin")).version, "admin");
  expect(published.status).toBe(201);
  expect(await db.publication.findUniqueOrThrow({ where: { id: (await published.json()).id } })).toMatchObject({ approvalId: approval.id });
  const second = await newForm(fx), pending = await request(fx, second.id);
  const unconfigured = await decision(fx, pending.id, "security", { version: 1, decision: "approved", reason: "역할 미구성" });
  expect(unconfigured.status).toBe(403); expect((await unconfigured.json()).error.code).toBe("REVIEWER_FORBIDDEN");
  expect((await decision(fx, pending.id, "editor", { version: 1, decision: "approved", reason: "작성자 자기 승인" })).status).toBe(403);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "pending", version: 1, decidedBy: null });
  expect(await db.publication.count({ where: { formId: second.id } })).toBe(0);
});

test("만료 구독은 신규 폼·서비스 생성만 402로 막고 기존 폼의 승인·게시·고정 URL은 계속 처리한다", async () => {
  const fx = await fixture(["owner", "editor"], false);
  const form = await newForm(fx);
  await expiredSubscription(fx.company.id);
  expect((await formCreate(req("/forms", fx.editor.cookie, "POST", { serviceId: fx.serviceId, title: "만료 후 신규 폼", content }, { "idempotency-key": randomUUID() }))).status).toBe(402);
  expect((await serviceCreate(req("/services", fx.owner.cookie, "POST", { name: "만료 후 서비스", externalName: "만료" }))).status).toBe(402);
  await db.securityPolicy.update({ where: { tenantId: fx.company.id }, data: { requireApproval: true } });
  const pending = await request(fx, form.id);
  expect((await decision(fx, pending.id, "owner", { version: 1, decision: "approved", reason: "만료 구독 승인" })).status).toBe(200);
  const published = await publish(fx, form.id, (await readForm(fx, form.id)).version);
  expect(published.status).toBe(201); const token = (await published.json()).token;
  const fixed = await fixedCreate(req("/fixed-urls", fx.editor.cookie, "POST", { name: "만료 후 고정 링크", formId: form.id }, { "idempotency-key": randomUUID() }));
  expect(fixed.status).toBe(201);
  const current = await readForm(fx, form.id);
  expect((await action(req("/forms/" + form.id + "/pause", fx.editor.cookie, "POST", { version: current.version }))).status).toBe(200);
  expect((await action(req("/forms/" + form.id + "/resume", fx.editor.cookie, "POST", { version: current.version + 1 }))).status).toBe(200);
  expect((await publicGet(req("/public/forms/" + token))).status).toBe(200);
});

test("같은 slug의 동시 고정 URL 생성은 하나만 커밋하고 409를 반환한다", async () => {
  const fx = await fixture();
  const form = await newForm(fx);
  expect((await publish(fx, form.id, form.version)).status).toBe(201);
  const slug = "race-" + randomUUID(), input = { name: "동시 주소", formId: form.id, slug };
  const responses = await Promise.all([
    fixedCreate(req("/fixed-urls", fx.editor.cookie, "POST", input, { "idempotency-key": randomUUID() })),
    fixedCreate(req("/fixed-urls", fx.owner.cookie, "POST", input, { "idempotency-key": randomUUID() }))]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  expect(await db.fixedUrl.count({ where: { slug } })).toBe(1);
});

test("폼 조회와 링크 복사만으로는 게시·응답·감사가 생기지 않는다", async () => {
  const fx = await fixture();
  const form = await newForm(fx), audits = await db.auditEvent.count();
  for (let index = 0; index < 3; index++) await readForm(fx, form.id, "owner");
  expect((await publicGet(req("/public/forms/" + form.id))).status).toBe(404);
  expect((await resolveUrl(req("/public/urls/" + randomUUID()))).status).toBe(404);
  expect(await db.publication.count({ where: { formId: form.id } })).toBe(0);
  expect(await db.fixedUrl.count()).toBe(0);
  expect(await db.auditEvent.count()).toBe(audits);
  const published = await publish(fx, form.id, (await readForm(fx, form.id)).version);
  expect(published.status).toBe(201); const token = (await published.json()).token;
  const slug = "copy-" + randomUUID();
  const resolved = await fixedCreate(req("/fixed-urls", fx.editor.cookie, "POST", { name: "복사용 링크", formId: form.id, slug }, { "idempotency-key": randomUUID() }));
  expect(resolved.status).toBe(201);
  for (let index = 0; index < 3; index++) {
    expect((await publicGet(req("/public/forms/" + token))).status).toBe(200);
    expect((await resolveUrl(req("/public/urls/" + slug))).status).toBe(200);
  }
  expect(await db.publication.count({ where: { formId: form.id } })).toBe(1);
  expect(await db.publication.findFirstOrThrow({ where: { formId: form.id } })).toMatchObject({ responseCount: 0 });
  expect(await db.submission.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "form.published" } })).toBe(1);
});

test("감사 저장 실패는 승인 요청·결정·게시·고정 URL 생성과 함께 원자 롤백한다", async () => {
  const fx = await fixture();
  await db.securityPolicy.update({ where: { tenantId: fx.company.id }, data: { requireApproval: true } });
  const form = await newForm(fx);
  const writeCtx = await requireContext(req("/context", fx.editor.cookie).headers, "form.write");
  const publishCtx = await requireContext(req("/context", fx.editor.cookie).headers, "form.publish");
  const approveCtx = await requireContext(req("/context", fx.owner.cookie).headers, "form.approve");
  fault.actions.add("approval.requested");
  await expect(db.$transaction(tx => requestApproval(tx, writeCtx, form.id, { version: 1, message: "롤백 요청", reference: "REF" }, randomUUID())))
    .rejects.toThrow("synthetic R09 audit storage failure");
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.form.findUniqueOrThrow({ where: { id: form.id } })).toMatchObject({ status: "draft" });
  fault.actions.clear();
  const pending = await request(fx, form.id);
  fault.actions.add("approval.approved");
  await expect(decideApproval(approveCtx, pending.id, { version: 1, decision: "approved", reason: "롤백 결정" }, randomUUID()))
    .rejects.toThrow("synthetic R09 audit storage failure");
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "pending", version: 1, decidedBy: null });
  fault.actions.clear();
  expect((await decision(fx, pending.id, "owner", { version: 1, decision: "approved", reason: "정상 승인" })).status).toBe(200);
  const version = (await readForm(fx, form.id)).version;
  fault.actions.add("form.published");
  await expect(db.$transaction(tx => publishForm(tx, publishCtx, form.id, { version }, randomUUID())))
    .rejects.toThrow("synthetic R09 audit storage failure");
  expect(await db.publication.count()).toBe(0);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "approved" });
  expect(await db.form.findUniqueOrThrow({ where: { id: form.id } })).toMatchObject({ publishedVersionId: null });
  fault.actions.clear();
  expect((await publish(fx, form.id, version)).status).toBe(201);
  fault.actions.add("fixed_url.created");
  await expect(db.$transaction(tx => createFixedUrl(publishCtx, { name: "롤백 링크", formId: form.id }, randomUUID(), tx)))
    .rejects.toThrow("synthetic R09 audit storage failure");
  expect(await db.fixedUrl.count()).toBe(0);
  fault.actions.clear();
});
