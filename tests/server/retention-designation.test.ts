import { grantSecurityTestTrials } from "../fixtures/security-subscription";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { policyDefaults } from "@/contracts/security";
import { updatePolicy } from "@/server/security-policy";
import { GET as listForms, POST as createForm } from "@/app/api/v1/forms/route";
import { GET, PATCH, POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicPost } from "@/app/api/v1/public/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const password = "Retention-policy!123";
function req(path: string, cookie = "", method = "GET", input?: unknown, key?: string) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(input === undefined ? {} : { "content-type": "application/json" }),
    ...(key ? { "idempotency-key": key } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function owner() {
  const email = "retention-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "보유 기간 검증", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "보유 기간 회사", publicName: "보유 기간", policy: { create: { retentionDays: 365, allowRetentionDesignation: true } },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "보유 서비스", externalName: "보유" } } }, include: { services: true, policy: true } });
  await grantSecurityTestTrials();
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password })); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return { company, cookie, serviceId: company.services[0].id };
}
function content(retentionDays: number | null) {
  return { body: "보유 기간 본문", questions: [{ id: randomUUID(), type: "단문형 답변" as const, label: "이름", required: true }],
    consentRequired: true, consentPurpose: "보유 기간 시험", retentionDays, maxResponses: 5 };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("미지정 폼은 제출 시점의 회사 보유 기간을 저장하고 사후 지정은 한 번만 허용한다", async () => {
  const account = await owner();
  const created = await createForm(req("/forms", account.cookie, "POST", { serviceId: account.serviceId, title: "미지정 폼", content: content(null) }, randomUUID()));
  expect(created.status).toBe(201);
  const form = await created.json();
  expect(form.content.retentionDays).toBeNull();
  const published = await formAction(req("/forms/" + form.id + "/publish", account.cookie, "POST", { version: form.version }, randomUUID()));
  expect(published.status).toBe(201);
  const publication = await published.json();
  await db.securityPolicy.update({ where: { tenantId: account.company.id }, data: { retentionDays: 10 } });
  const questionId = form.content.questions[0].id;
  const submitted = await publicPost(req("/public/forms/" + publication.token + "/submissions", "", "POST", { consent: true, answers: { [questionId]: "홍길동" } }, randomUUID()));
  expect(submitted.status).toBe(201);
  const receipt = await submitted.json();
  const submission = await db.submission.findUniqueOrThrow({ where: { id: receipt.id }, include: { receipts: true } });
  const span = submission.retentionUntil.getTime() - submission.submittedAt.getTime();
  expect(span).toBeGreaterThan(9 * 86400000);
  expect(span).toBeLessThan(11 * 86400000);
  expect(submission.receipts[0].retentionDays).toBe(10);
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id } });
  expect(version.retentionDays).toBeNull();
  const designated = await PATCH(req("/forms/" + form.id + "/retention", account.cookie, "PATCH", { version: publication.version, retentionDays: 90 }));
  expect(designated.status).toBe(200);
  expect((await designated.json()).content.retentionDays).toBe(90);
  expect((await db.formVersion.findUniqueOrThrow({ where: { id: version.id } })).retentionDays).toBeNull();
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).designatedRetentionDays).toBe(90);
  const later = await publicPost(req("/public/forms/" + publication.token + "/submissions", "", "POST", { consent: true, answers: { [questionId]: "김영희" } }, randomUUID()));
  expect(later.status).toBe(201);
  const laterRow = await db.submission.findUniqueOrThrow({ where: { id: (await later.json()).id }, include: { receipts: true } });
  const laterSpan = laterRow.retentionUntil.getTime() - laterRow.submittedAt.getTime();
  expect(laterSpan).toBeGreaterThan(89 * 86400000);
  expect(laterSpan).toBeLessThan(91 * 86400000);
  expect(laterRow.receipts[0].retentionDays).toBe(90);
  const again = await PATCH(req("/forms/" + form.id + "/retention", account.cookie, "PATCH", { version: publication.version + 1, retentionDays: 30 }));
  expect(again.status).toBe(409);
  expect((await db.submission.findUniqueOrThrow({ where: { id: receipt.id } })).originalRetentionUntil.getTime()).toBe(submission.originalRetentionUntil.getTime());
});

test("이미 지정된 보유 기간은 사후 지정으로 바꾸지 않는다", async () => {
  const account = await owner();
  const created = await createForm(req("/forms", account.cookie, "POST", { serviceId: account.serviceId, title: "지정 폼", content: content(30) }, randomUUID()));
  const form = await created.json();
  const response = await PATCH(req("/forms/" + form.id + "/retention", account.cookie, "PATCH", { version: form.version, retentionDays: 90 }));
  expect(response.status).toBe(409);
  expect((await GET(req("/forms/" + form.id, account.cookie))).status).toBe(200);
});

test("사후 지정 정책이 꺼지면 지정 API와 목록 권한이 모두 차단되고 다시 켜면 허용한다", async () => {
  const account = await owner();
  const created = await createForm(req("/forms", account.cookie, "POST", { serviceId: account.serviceId, title: "정책 폼", content: content(null) }, randomUUID()));
  const form = await created.json();
  const listed = await listForms(req("/forms?serviceId=" + account.serviceId, account.cookie));
  expect((await listed.json()).permissions.canDesignateRetention).toBe(true);
  const ctx = await requireContext(req("/context", account.cookie).headers, "security.write");
  const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: account.company.id } });
  await updatePolicy(ctx, policy.version, { ...policyDefaults, allowRetentionDesignation: false }, randomUUID());
  const denied = await PATCH(req("/forms/" + form.id + "/retention", account.cookie, "PATCH", { version: form.version, retentionDays: 90 }));
  expect(denied.status).toBe(403);
  expect((await denied.json()).error?.code).toBe("RETENTION_DESIGNATION_DISABLED");
  const listedOff = await listForms(req("/forms?serviceId=" + account.serviceId, account.cookie));
  expect((await listedOff.json()).permissions.canDesignateRetention).toBe(false);
  const updated = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: account.company.id } });
  await updatePolicy(ctx, updated.version, { ...policyDefaults, allowRetentionDesignation: true }, randomUUID());
  const allowed = await PATCH(req("/forms/" + form.id + "/retention", account.cookie, "PATCH", { version: form.version, retentionDays: 90 }));
  expect(allowed.status).toBe(200);
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).designatedRetentionDays).toBe(90);
});

test("회사 기본 보유 기간을 바꾸면 미지정 폼의 진행 중 승인을 무효화한다", async () => {
  const account = await owner();
  await db.securityPolicy.update({ where: { tenantId: account.company.id }, data: { requireApproval: true, version: { increment: 1 } } });
  const created = await createForm(req("/forms", account.cookie, "POST", { serviceId: account.serviceId, title: "승인 폼", content: content(null) }, randomUUID()));
  const form = await created.json();
  const requested = await formAction(req("/forms/" + form.id + "/approvals", account.cookie, "POST", { version: form.version, message: "보유 기간 검토", reference: "" }, randomUUID()));
  expect(requested.status).toBe(201);
  const ctx = await requireContext(req("/context", account.cookie).headers, "security.write");
  const policy = await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: account.company.id } });
  await updatePolicy(ctx, policy.version, { ...policyDefaults, requireApproval: true, retentionDays: 30 }, randomUUID());
  expect((await db.approvalRequest.findFirstOrThrow({ where: { formId: form.id } })).status).toBe("superseded");
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).status).toBe("draft");
  expect((await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: account.company.id } })).approvalRevision).toBe(policy.approvalRevision + 1);
});
