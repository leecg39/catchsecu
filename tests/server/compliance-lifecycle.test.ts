import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { runOneDestruction } from "@/server/destruction-worker";
import { certificateDigest } from "@/server/destruction";
import { createComplianceExport, runOneComplianceExport, downloadComplianceExport } from "@/server/compliance-exports";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as submit } from "@/app/api/v1/public/forms/[...segments]/route";
import { POST as submissionAction, PATCH as correct, GET as readSubmission } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as destructionAction } from "@/app/api/v1/destruction-requests/[...segments]/route";
import { GET as dashboard } from "@/app/api/v1/analytics/dashboard/route";
import { GET as readClose, POST as closeMonth } from "@/app/api/v1/analytics/closes/route";
import { GET as csv } from "@/app/api/v1/analytics/closes/[id]/export/route";
import { GET as readExports } from "@/app/api/v1/analytics/exports/route";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
let cookie = "", tenantId: string, serviceId: string, siblingId: string;
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
function req(path: string, body?: unknown, method = body ? "POST" : "GET", anonymous = false) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: anonymous ? "" : cookie,
    ...(body ? { "content-type": "application/json", "idempotency-key": randomUUID() } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function ok(response: Response, status = 200) {
  const value = await response.json(); expect(response.status, value.error?.code).toBe(status); return value;
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  const email = "lifecycle-" + randomUUID() + "@example.test", password = "Lifecycle!123456";
  await ok(await auth.handler(req("/auth/sign-up/email", { email, password, name: "월마감 흐름" })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "월마감 흐름", publicName: "시험", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: [{ name: "A", externalName: "A" }, { name: "B", externalName: "B" }] } }, include: { services: true } });
  tenantId = company.id; [serviceId, siblingId] = company.services.map(s => s.id);
  const login = await auth.handler(req("/auth/sign-in/email", { email, password })); expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
});
afterAll(async () => { await db.$disconnect(); });

test("FLOW-12: 공개 접수·정정·철회·보존·파기 후 현재 집계는 변하고 기존 월마감과 출력은 유지된다", async () => {
  const question = randomUUID();
  async function makeForm(id: string) {
    const form = await ok(await createForm(req("/forms", { serviceId: id, title: "마감 연결", content: {
      body: "합성 흐름", questions: [{ id: question, type: "단문형 답변", label: "합성 값", required: true }],
      consentRequired: true, consentPurpose: "시험 자료 처리", retentionDays: 30, maxResponses: 10,
    } })), 201);
    return ok(await formAction(req(`/forms/${form.id}/publish`, { version: form.version })), 201);
  }
  const pubA = await makeForm(serviceId), pubB = await makeForm(siblingId);
  const privateValue = "파기할 원문 " + randomUUID();
  const target = await ok(await submit(req(`/public/forms/${pubA.token}/submissions`, { answers: { [question]: privateValue }, consent: true }, "POST", true)), 201);
  const held = await ok(await submit(req(`/public/forms/${pubA.token}/submissions`, { answers: { [question]: "보존 대상" }, consent: true }, "POST", true)), 201);
  const sibling = await ok(await submit(req(`/public/forms/${pubB.token}/submissions`, { answers: { [question]: "다른 서비스" }, consent: true }, "POST", true)), 201);
  const initial = await ok(await dashboard(req(`/analytics/dashboard?serviceId=${serviceId}`)));
  expect(initial.totals).toMatchObject({ services: 1, retainedSubmissions: 2, periodSubmissions: 2, periodDestructions: 0 });
  await ok(await correct(req(`/submissions/${target.id}`, { version: 1, reason: "합성 정정", answers: { [question]: "정정 원문" } }, "PATCH")));
  const corrected = await db.submission.findUniqueOrThrow({ where: { id: target.id } });
  await ok(await submissionAction(req(`/submissions/${target.id}/withdraw`, { version: corrected.version, reason: "합성 철회" })));
  await ok(await submissionAction(req(`/submissions/${held.id}/hold`, { version: 1, reason: "합성 보존", hold: true })));
  const hold = await db.submission.findUniqueOrThrow({ where: { id: held.id } });
  expect((await submissionAction(req(`/submissions/${held.id}/destruction-request`, { version: hold.version, reason: "거절 시험" }))).status).toBe(409);
  const withdrawn = await db.submission.findUniqueOrThrow({ where: { id: target.id } });
  const requested = await ok(await submissionAction(req(`/submissions/${target.id}/destruction-request`, { version: withdrawn.version, reason: "합성 자료 종료" })));
  const before = await ok(await closeMonth(req("/analytics/closes", { month, serviceId })));
  expect(before.close.totals).toEqual(initial.totals);
  expect(before.close.evidence.facts).toMatchObject({ unpurgedSubmissions: 2, heldSubmissions: 1, overdueSubmissions: 0 });
  const oldCsv = Buffer.from(await (await csv(req(`/analytics/closes/${before.close.id}/export`))).arrayBuffer()).toString();
  await ok(await destructionAction(req(`/destruction-requests/${requested.destructionId}/approve`, { version: 1, reason: "합성 파기 승인" })));
  const workerScope = { tenantId, requestId: requested.destructionId };
  await runOneDestruction("flow12", new Date(), workerScope);
  expect(await runOneDestruction("flow12-repeat", new Date(), workerScope)).toBe(false);
  const erased = await db.submission.findUniqueOrThrow({ where: { id: target.id }, include: { answers: true, receipts: true, corrections: true, certificate: true } });
  expect(erased.status).toBe("destroyed"); expect(erased.answers).toHaveLength(0); expect(erased.receipts).toHaveLength(0); expect(erased.corrections).toHaveLength(0);
  expect(erased.certificate!.digest).toBe(certificateDigest(erased.certificate!));
  const tombstone = await ok(await readSubmission(req(`/submissions/${target.id}`)));
  expect(tombstone).toMatchObject({ status: "destroyed", contentAvailable: false, values: {}, receipts: [], corrections: [], notes: [], attachments: [] });
  const after = await ok(await dashboard(req(`/analytics/dashboard?serviceId=${serviceId}`)));
  expect(after.totals).toMatchObject({ retainedSubmissions: 1, periodSubmissions: 1, periodDestructions: 1 });
  const siblingAfter = await ok(await dashboard(req(`/analytics/dashboard?serviceId=${siblingId}`)));
  expect(siblingAfter.totals).toMatchObject({ retainedSubmissions: 1, periodDestructions: 0 });
  expect((await db.submission.findUniqueOrThrow({ where: { id: sibling.id } })).status).toBe("submitted");
  expect((await ok(await readClose(req(`/analytics/closes?month=${month}&serviceId=${serviceId}`)))).close).toEqual(before.close);
  expect(Buffer.from(await (await csv(req(`/analytics/closes/${before.close.id}/export`))).arrayBuffer()).toString()).toBe(oldCsv);
  const company = await ok(await closeMonth(req("/analytics/closes", { month })));
  expect(company.close.totals).toMatchObject({ services: 2, retainedSubmissions: 2, periodSubmissions: 2, periodDestructions: 1 });
  expect(company.close.evidence.facts).toMatchObject({ unpurgedSubmissions: 2, heldSubmissions: 1 });
  const ctx = await requireContext(req("/context").headers, "service.read");
  const job = await createComplianceExport(ctx, { closeId: before.close.id, format: "csv" }, randomUUID(), randomUUID());
  await runOneComplianceExport("flow12-export", new Date(), job.id);
  expect(Buffer.from((await downloadComplianceExport(ctx, job.id, randomUUID())).bytes!).toString()).toBe(oldCsv);
  const events = await db.auditEvent.findMany({ where: { tenantId, serviceId, resourceId: { in: [target.id, held.id, requested.destructionId, before.close.id] } } });
  for (const action of ["submission.created", "submission.corrected", "submission.withdraw", "submission.hold", "submission.destruction-request", "destruction.approve", "destruction.started", "destruction.completed", "compliance.closed"])
    expect(events.some(e => e.action === action), action).toBe(true);
  expect(events.filter(e => e.action === "destruction.completed")).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain(privateValue);
  expect(JSON.stringify(company)).not.toContain(target.id);
});

test("월마감 조회는 월·서비스의 중복 필터를 거절하며 조회 감사를 남기지 않는다", async () => {
  const events = await db.auditEvent.count({ where: { tenantId, action: "compliance.viewed" } });
  for (const query of [`month=${month}&month=${month}`, `month=${month}&serviceId=${serviceId}&serviceId=${siblingId}`]) {
    const response = await readClose(req(`/analytics/closes?${query}`));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("DUPLICATE_QUERY");
  }
  expect(await db.auditEvent.count({ where: { tenantId, action: "compliance.viewed" } })).toBe(events);
});

test("출력 목록은 마감 ID·페이지의 중복 필터를 거절한다", async () => {
  const close = await ok(await closeMonth(req("/analytics/closes", { month, serviceId })));
  for (const query of [`closeId=${close.close.id}&closeId=${close.close.id}`, `closeId=${close.close.id}&page=1&page=2`, `closeId=${close.close.id}&pageSize=10&pageSize=20`]) {
    const response = await readExports(req(`/analytics/exports?${query}`));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("DUPLICATE_QUERY");
  }
  const list = await ok(await readExports(req(`/analytics/exports?closeId=${close.close.id}&page=1&pageSize=10`)));
  expect(list).toMatchObject({ page: 1, pageSize: 10 });
});
