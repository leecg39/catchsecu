import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { GET as listDaily } from "@/app/api/v1/analytics/collect-destruction/route";
import { GET as exportDaily } from "@/app/api/v1/analytics/collect-destruction/export/route";
import type { CollectDestructionList } from "@/contracts/analytics";

const database = new URL(env.DATABASE_URL);
if (!/^\/catchsecu_test/.test(database.pathname) || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Collect-destruction fixtures require the isolated local test database.");
const origin = env.BETTER_AUTH_URL, password = "Collect-destruction-test-only-password!123";
const tenantA = randomUUID(), tenantB = randomUUID();
const serviceA1 = randomUUID(), serviceA2 = randomUUID(), serviceB = randomUUID();
const cookies: Record<string, string> = {}, users: Record<string, string> = {};
function request(path: string, who = "owner") {
  return new Request(origin + "/api/v1" + path, { headers: { origin, cookie: cookies[who] ?? "" } });
}
async function user(name: string, tenantId: string, role: "owner" | "viewer") {
  const email = name + "@collect-destruction.local.test";
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
async function form(tenantId: string, serviceId: string, ownerId: string, title: string, sourceType = "form") {
  const imported = sourceType === "import";
  const row = await db.form.create({ data: { tenantId, serviceId, ownerId, title, sourceType,
    status: imported ? "archived" : "published" } });
  const version = await db.formVersion.create({ data: { tenantId, formId: row.id, number: 1, title, status: "published",
    publishedAt: new Date("2026-09-01T00:00:00Z") } });
  if (imported) return { formId: row.id, versionId: version.id, publicationId: null };
  const publication = await db.publication.create({ data: { tenantId, formId: row.id, formVersionId: version.id,
    tokenHash: randomUUID(), tokenCipher: "synthetic-test-token", maxResponses: 100 } });
  return { formId: row.id, versionId: version.id, publicationId: publication.id };
}
async function submission(tenantId: string, formVersionId: string, publicationId: string | null, submittedAt: string,
    importJob?: { id: string; rowNo: number }) {
  return db.submission.create({ data: { tenantId, formVersionId, publicationId, submittedAt: new Date(submittedAt),
    importJobId: importJob?.id ?? null, importRowNo: importJob?.rowNo ?? null,
    retentionUntil: new Date("2027-01-01T00:00:00Z"), originalRetentionUntil: new Date("2027-01-01T00:00:00Z") } });
}
async function importJob(tenantId: string, serviceId: string, creatorUserId: string, formVersionId: string, title: string) {
  const file = await db.fileObject.create({ data: { tenantId, serviceId, ownerKind: "import", ownerId: creatorUserId,
    storageKey: randomUUID(), mime: "text/csv", size: 32, nameCipher: "synthetic-name",
    sha256: createHash("sha256").update(title).digest("hex"), expiresAt: new Date("2027-01-01T00:00:00Z") } });
  const job = await db.importJob.create({ data: { tenantId, serviceId, creatorId: creatorUserId, title, fileId: file.id,
    formVersionId, expiresAt: new Date("2027-01-01T00:00:00Z") } });
  for (const status of ["draft", "validated"]) await db.importJob.update({ where: { id: job.id },
    data: { status, version: { increment: 1 } } });
  await db.importRow.create({ data: { tenantId, jobId: job.id, rowNo: 2, lineNo: 2, status: "valid", errors: [] } });
  const committed = await db.importJob.update({ where: { id: job.id }, data: { status: "committing", leaseOwner: "collect-destruction-test",
    leaseGeneration: 1, leaseUntil: new Date("2027-01-01T00:00:00Z"), version: { increment: 1 } } });
  await db.fileObject.update({ where: { id: file.id }, data: { status: "deleting", version: { increment: 1 } } });
  await db.fileObject.update({ where: { id: file.id }, data: { status: "deleted", size: 0, nameCipher: null, sha256: null,
    version: { increment: 1 } } });
  return committed;
}
async function destroy(tenantId: string, serviceId: string, submissionId: string, completedAt: string) {
  const requestRow = await db.destructionRequest.create({ data: { tenantId, serviceId, submissionId,
    source: "manual", previousStatus: "submitted", status: "running", leaseOwner: "collect-destruction-test",
    leaseUntil: new Date("2027-01-01T00:00:00Z"), dueAt: new Date(completedAt), startedAt: new Date(completedAt) } });
  await db.submission.update({ where: { tenantId_id: { tenantId, id: submissionId } }, data: { status: "destroying" } });
  return db.destructionCertificate.create({ data: { tenantId, serviceId, submissionId, requestId: requestRow.id,
    counts: { answers: 1 }, digest: createHash("sha256").update(submissionId + completedAt).digest("hex"),
    completedAt: new Date(completedAt) } });
}

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit" CASCADE');
  await db.company.createMany({ data: [{ id: tenantA, name: "수집파기 회사 A", publicName: "A" },
    { id: tenantB, name: "수집파기 회사 B", publicName: "B" }] });
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
  const a1 = await form(tenantA, serviceA1, users.owner, "수집 캐치폼");
  const up1 = await form(tenantA, serviceA1, users.owner, "업로드 CSV", "import");
  const a2 = await form(tenantA, serviceA2, users.owner, "=HYPERLINK(위험)");
  const b1 = await form(tenantB, serviceB, users.foreign, "타사 폼");
  const s1 = await submission(tenantA, a1.versionId, a1.publicationId, "2026-09-10T01:00:00Z"); // KST 09-10
  await submission(tenantA, a1.versionId, a1.publicationId, "2026-09-10T02:00:00Z"); // KST 09-10
  await submission(tenantA, a1.versionId, a1.publicationId, "2026-09-11T16:30:00Z"); // KST 09-12 (경계)
  const up1Job = await importJob(tenantA, serviceA1, users.owner, up1.versionId, "업로드 CSV");
  const s4 = await submission(tenantA, up1.versionId, null, "2026-09-10T05:00:00Z", { id: up1Job.id, rowNo: 2 }); // KST 09-10
  await submission(tenantA, a2.versionId, a2.publicationId, "2026-09-10T05:00:00Z"); // KST 09-10
  await submission(tenantB, b1.versionId, b1.publicationId, "2026-09-10T05:00:00Z"); // 타사 수집
  await destroy(tenantA, serviceA1, s1.id, "2026-09-11T03:00:00Z"); // KST 09-11
  await destroy(tenantA, serviceA1, s4.id, "2026-09-10T09:00:00Z"); // KST 09-10
  await db.apiRateLimit.deleteMany();
});
afterAll(async () => { await db.$disconnect(); });

describe("일별 수집·파기 집계", () => {
  test("일자·서비스·원천별 수집/파기/잔여와 누적 수집을 독립 DB 기대와 일치시킨다", async () => {
    const response = await listDaily(request("/analytics/collect-destruction"));
    expect(response.status).toBe(200);
    const result = await response.json() as CollectDestructionList;
    expect(result.total).toBe(5);
    const rows = result.rows.map(row => [row.date, row.sourceName, row.collectedTotal, row.collected, row.destroyed, row.remaining]);
    expect(rows).toEqual([
      ["2026-09-12", "수집 캐치폼", 3, 1, 0, 1],
      ["2026-09-11", "수집 캐치폼", 3, 0, 1, -1],
      ["2026-09-10", "수집 캐치폼", 3, 2, 0, 2],
      ["2026-09-10", "업로드 CSV", 1, 1, 1, 0],
      ["2026-09-10", "=HYPERLINK(위험)", 1, 1, 0, 1],
    ]);
    expect(result.rows.every(row => row.serviceId !== serviceB)).toBe(true);
    expect(result.totals).toEqual({ collectedTotal: 5, collected: 5, destroyed: 2, remaining: 3 });
    const sources = result.sources.map(item => item.id);
    expect(sources.length).toBe(3);
    expect(result.sources.find(item => item.name === "업로드 CSV")?.kind).toBe("import");
  });
  test("서비스·원천·검색·기간 필터가 서버 집계에 반영된다", async () => {
    const byService = await (await listDaily(request("/analytics/collect-destruction?serviceId=" + serviceA2))).json() as CollectDestructionList;
    expect(byService.total).toBe(1);
    expect(byService.rows[0].sourceName).toBe("=HYPERLINK(위험)");
    const up = await listDaily(request("/analytics/collect-destruction?search=" + encodeURIComponent("업로드")));
    expect((await up.json() as CollectDestructionList).total).toBe(1);
    const ranged = await (await listDaily(request("/analytics/collect-destruction?from=" + encodeURIComponent("2026-09-11T00:00:00+09:00")
      + "&to=" + encodeURIComponent("2026-09-13T00:00:00+09:00")))).json() as CollectDestructionList;
    expect(ranged.rows.map(row => row.date)).toEqual(["2026-09-12", "2026-09-11"]);
    expect(ranged.rows[0].collectedTotal).toBe(3); // 기간 밖 수집도 누적에 포함
  });
  test("페이지와 행 수가 안정 순서로 적용된다", async () => {
    const page2 = await (await listDaily(request("/analytics/collect-destruction?page=2&pageSize=2"))).json() as CollectDestructionList;
    expect(page2.total).toBe(5);
    expect(page2.rows.map(row => row.date)).toEqual(["2026-09-10", "2026-09-10"]);
  });
  test("서비스 권한 범위 밖은 결과에서 빠지고 드롭다운 원천도 제한된다", async () => {
    const result = await (await listDaily(request("/analytics/collect-destruction", "viewer"))).json() as CollectDestructionList;
    expect(result.rows.every(row => row.serviceId === serviceA1)).toBe(true);
    expect(result.total).toBe(4);
    expect(result.sources.every(item => item.serviceId === serviceA1)).toBe(true);
    const denied = await (await listDaily(request("/analytics/collect-destruction?serviceId=" + serviceA2, "viewer"))).json() as CollectDestructionList;
    expect(denied.total).toBe(0);
  });
  test("타 회사 원천·제출·파기는 어느 응답에도 노출되지 않는다", async () => {
    const foreign = await (await listDaily(request("/analytics/collect-destruction", "foreign"))).json() as CollectDestructionList;
    expect(foreign.total).toBe(1);
    expect(foreign.rows[0].sourceName).toBe("타사 폼");
    expect(foreign.rows[0].serviceId).toBe(serviceB);
  });
  test("CSV 내보내기는 BOM·수식 방어·집계 값을 포함하고 감사 이벤트를 남긴다", async () => {
    const before = await db.auditEvent.count({ where: { tenantId: tenantA, action: "analytics.collect_destruction_exported" } });
    const response = await exportDaily(request("/analytics/collect-destruction/export"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes.slice(3)).trim().split("\r\n");
    expect(lines[0]).toContain("일자");
    const injected = lines.find(line => line.includes("HYPERLINK"));
    expect(injected).toBeDefined();
    expect(injected!).toContain("\"'=HYPERLINK");
    const collectedRow = lines.find(line => line.startsWith('"2026-09-12"'));
    expect(collectedRow).toContain('"3","1","0","1"');
    expect(await db.auditEvent.count({ where: { tenantId: tenantA, action: "analytics.collect_destruction_exported" } })).toBe(before + 1);
  });
  test("조회할 때마다 수집·파기 로그 감사 이벤트가 같은 트랜잭션으로 남는다", async () => {
    const before = await db.auditEvent.count({ where: { tenantId: tenantA, action: "analytics.collect_destruction_viewed" } });
    expect((await listDaily(request("/analytics/collect-destruction"))).status).toBe(200);
    expect(await db.auditEvent.count({ where: { tenantId: tenantA, action: "analytics.collect_destruction_viewed" } })).toBe(before + 1);
  });
  test("잘못된 기간·중복 쿼리는 422로 거절한다", async () => {
    expect((await listDaily(request("/analytics/collect-destruction?from=" + encodeURIComponent("2026-09-13T00:00:00+09:00")
      + "&to=" + encodeURIComponent("2026-09-11T00:00:00+09:00")))).status).toBe(422);
    expect((await listDaily(new Request(origin + "/api/v1/analytics/collect-destruction?search=a&search=b",
      { headers: { origin, cookie: cookies.owner } }))).status).toBe(422);
  });
});
