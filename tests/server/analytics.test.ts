import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET } from "@/app/api/v1/analytics/dashboard/route";
import type { AnalyticsDashboard } from "@/contracts/analytics";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Analytics fixtures require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Analytics-test-only-password!123";
const tenantA = randomUUID(), tenantB = randomUUID();
const serviceA1 = randomUUID(), serviceA2 = randomUUID(), serviceB = randomUUID();
const cookies: Record<string, string> = {}, users: Record<string, string> = {};
const now = Date.now();
function request(path: string, who = "owner") {
  return new Request(origin + "/api/v1" + path, { headers: { origin, cookie: cookies[who] ?? "" } });
}
async function user(name: string, tenantId: string, role: "owner" | "viewer") {
  const email = name + "@analytics.local.test";
  expect((await auth.handler(new Request(origin + "/api/v1/auth/sign-up/email", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name, email, password }) }))).status).toBe(200);
  const row = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: row.id, role } });
  const login = await auth.handler(new Request(origin + "/api/v1/auth/sign-in/email", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
  expect(login.status).toBe(200);
  cookies[name] = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  users[name] = row.id;
  return member.id;
}
async function form(tenantId: string, serviceId: string, ownerId: string, title: string) {
  const row = await db.form.create({ data: { tenantId, serviceId, ownerId, title, status: "published" } });
  const version = await db.formVersion.create({ data: { tenantId, formId: row.id, number: 1, title, status: "published",
    publishedAt: new Date(now - 86400000) } });
  const publication = await db.publication.create({ data: { tenantId, formId: row.id, formVersionId: version.id,
    tokenHash: randomUUID(), tokenCipher: "synthetic-test-token", maxResponses: 100 } });
  return { formId: row.id, versionId: version.id, publicationId: publication.id };
}
async function submission(tenantId: string, formVersionId: string, publicationId: string, at: number, retentionUntil: number, legalHold = false) {
  return db.submission.create({ data: { tenantId, formVersionId, publicationId, submittedAt: new Date(now + at),
    retentionUntil: new Date(now + retentionUntil), originalRetentionUntil: new Date(now + retentionUntil), legalHold } });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [{ id: tenantA, name: "집계 회사 A", publicName: "A" },
    { id: tenantB, name: "집계 회사 B", publicName: "B" }] });
  await db.service.createMany({ data: [
    { id: serviceA1, tenantId: tenantA, name: "가 서비스", externalName: "A1" },
    { id: serviceA2, tenantId: tenantA, name: "나 서비스", externalName: "A2" },
    { id: serviceB, tenantId: tenantB, name: "외부 서비스", externalName: "B" },
  ] });
  await user("owner", tenantA, "owner");
  const viewerMember = await user("viewer", tenantA, "viewer");
  await user("foreign", tenantB, "owner");
  await db.serviceGrant.create({ data: { tenantId: tenantA, memberId: viewerMember,
    serviceId: serviceA1, capabilities: ["service.read"] } });
  const a1 = await form(tenantA, serviceA1, users.owner, "A1 폼");
  const a2 = await form(tenantA, serviceA2, users.owner, "A2 폼");
  await form(tenantB, serviceB, users.foreign, "타사 폼");
  await submission(tenantA, a1.versionId, a1.publicationId, -2 * 3600000, 86400000);
  await submission(tenantA, a1.versionId, a1.publicationId, -3600000, 86400000);
  await submission(tenantA, a1.versionId, a1.publicationId, -2 * 3600000, -3600000);
  await submission(tenantA, a1.versionId, a1.publicationId, -2 * 3600000, -3600000, true);
  await submission(tenantA, a2.versionId, a2.publicationId, -2 * 3600000, 86400000);
  await db.document.createMany({ data: [
    { tenantId: tenantA, serviceId: serviceA1, createdBy: users.owner, type: "consent", title: "A1 동의서", effectiveDate: "2026-10-01", status: "published" },
    { tenantId: tenantA, serviceId: serviceA1, createdBy: users.owner, type: "consent", title: "보관 동의서", effectiveDate: "2026-10-01", status: "archived" },
    { tenantId: tenantA, serviceId: serviceA2, createdBy: users.owner, type: "privacy_policy", title: "A2 처리방침", effectiveDate: "2026-10-01", status: "published" },
  ] });
  await db.apiRateLimit.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

describe("실제 원천의 회사·서비스 집계", () => {
  test("기본 기간은 한국 시간의 월 첫날 자정부터 시작한다", async () => {
    const response = await GET(request("/analytics/dashboard"));
    expect(response.status).toBe(200);
    const result = await response.json() as AnalyticsDashboard;
    const koreaDate = new Date(new Date(result.asOf).getTime() + 9 * 3600000);
    expect(result.period.from).toBe(new Date(Date.UTC(koreaDate.getUTCFullYear(), koreaDate.getUTCMonth(), 1) - 9 * 3600000).toISOString());
    expect(result.period.to).toBe(result.asOf);
  });
  test("보유 상태·기간 경계·문서·서비스 순위가 독립 DB 결과와 일치한다", async () => {
    const from = new Date(now - 3 * 3600000).toISOString(), to = new Date(now - 90 * 60000).toISOString();
    const response = await GET(request("/analytics/dashboard?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)));
    expect(response.status).toBe(200);
    const result = await response.json() as AnalyticsDashboard;
    expect(result.period).toEqual({ from, to });
    expect(result.totals).toMatchObject({ services: 2, forms: 2, consentDocuments: 1,
      policyDocuments: 1, retainedSubmissions: 4, periodSubmissions: 3, periodDestructions: 0 });
    expect(result.services.map(row => [row.id, row.forms, row.retainedSubmissions, row.periodSubmissions]))
      .toEqual([[serviceA1, 1, 3, 2], [serviceA2, 1, 1, 1]]);
    expect(result.topForms.map(row => [row.serviceId, row.retainedSubmissions])).toEqual([[serviceA1, 3], [serviceA2, 1]]);
    const independent = await db.submission.count({ where: { tenantId: tenantA, status: { notIn: ["destroying", "destroyed"] },
      OR: [{ legalHold: true }, { retentionUntil: { gt: new Date(result.asOf) } }] } });
    expect(result.totals.retainedSubmissions).toBe(independent);
    const event = await db.auditEvent.findFirstOrThrow({ where: { requestId: response.headers.get("x-request-id")! } });
    expect(event).toMatchObject({ tenantId: tenantA, actorId: users.owner, action: "analytics.dashboard_viewed" });
  });
  test("한 서비스 범위와 다른 회사·권한 밖 서비스는 분리된다", async () => {
    const limited = await GET(request("/analytics/dashboard?serviceId=" + serviceA1, "viewer"));
    expect(limited.status).toBe(200);
    expect((await limited.json() as AnalyticsDashboard).totals).toMatchObject({ services: 1, forms: 1, retainedSubmissions: 3 });
    const own = await GET(request("/analytics/dashboard", "viewer"));
    expect((await own.json() as AnalyticsDashboard).services.map(row => row.id)).toEqual([serviceA1]);
    expect((await GET(request("/analytics/dashboard?serviceId=" + serviceA2, "viewer"))).status).toBe(404);
    expect((await GET(request("/analytics/dashboard?serviceId=" + serviceB))).status).toBe(404);
    expect((await GET(request("/analytics/dashboard", "anonymous"))).status).toBe(401);
    expect((await GET(request("/analytics/dashboard?serviceId=invalid"))).status).toBe(422);
  });
  test("보유 기한과 종료 시각이 바뀌면 재집계 결과가 즉시 달라진다", async () => {
    const from = new Date(now - 3 * 3600000).toISOString(), to = new Date(now - 2 * 3600000).toISOString();
    const exact = await GET(request("/analytics/dashboard?serviceId=" + serviceA1 + "&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)));
    expect(exact.status).toBe(200);
    expect((await exact.json() as AnalyticsDashboard).totals.periodSubmissions).toBe(0);
    const current = await db.submission.findFirstOrThrow({ where: { tenantId: tenantA, formVersion: { form: { serviceId: serviceA1 } },
      legalHold: false, retentionUntil: { gt: new Date() } }, orderBy: { submittedAt: "desc" } });
    await db.submission.update({ where: { id: current.id }, data: { retentionUntil: new Date(now - 60000) } });
    const updated = await GET(request("/analytics/dashboard?serviceId=" + serviceA1));
    expect((await updated.json() as AnalyticsDashboard).totals.retainedSubmissions).toBe(2);
  });
  test("오늘을 종료일로 선택한 다음날 경계는 현재 시점까지 집계한다", async () => {
    const from = new Date(now - 86400000).toISOString();
    const tomorrow = new Date(now + 86400000).toISOString();
    const response = await GET(request("/analytics/dashboard?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(tomorrow)));
    expect(response.status).toBe(200);
    const result = await response.json() as AnalyticsDashboard;
    expect(result.period.from).toBe(from);
    expect(result.period.to).toBe(result.asOf);
  });
});
