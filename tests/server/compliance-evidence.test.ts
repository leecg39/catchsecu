import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { closeComplianceMonth, readComplianceClose, complianceCloseCsv, complianceSnapshot } from "@/server/compliance-close";
import { collectComplianceEvidence, complianceEvidenceHash } from "@/server/compliance-evidence";
import { complianceEvidenceChecks } from "@/contracts/compliance-evidence";
import { createComplianceExport, runOneComplianceExport, downloadComplianceExport } from "@/server/compliance-exports";
import { sha256 } from "@/server/pdf-renderer";
import { createPurpose, changeCatalogStatus } from "@/server/processing-catalog";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const email = "evidence@example.test", password = "Evidence-test!123", month = "2026-09";
let ctx: Context, userId: string, serviceId: string, otherId: string;
function request(path: string, body?: unknown, cookie = "") {
  return new Request(origin + "/api/v1" + path, { method: body ? "POST" : "GET", headers: { origin, cookie,
    ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE');
  expect((await auth.handler(request("/auth/sign-up/email", { email, password, name: "점검 검증" }))).status).toBe(200);
  userId = (await db.user.update({ where: { email }, data: { emailVerified: true } })).id;
});
beforeEach(async () => {
  await db.rateLimit.deleteMany(); await db.apiRateLimit.deleteMany();
  const company = await db.company.create({ data: { name: "점검 회사", publicName: "점검", memberships: { create: { userId, role: "owner" } },
    services: { create: [{ name: "=A", externalName: "A" }, { name: "B", externalName: "B" }] } }, include: { services: true } });
  [serviceId, otherId] = company.services.map(s => s.id);
  const login = await auth.handler(request("/auth/sign-in/email", { email, password })); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
  const session = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: company.id } });
  ctx = await requireContext(request("/context", undefined, cookie).headers, "service.read");
});
afterAll(async () => { await db.$disconnect(); });
const close = async (id: string | undefined = serviceId, value = month) => (await closeComplianceMonth(ctx, { month: value, serviceId: id }, randomUUID())).close;
async function purpose(id = serviceId) {
  return db.$transaction(tx => createPurpose(tx, ctx, { serviceId: id, name: "기밀 목적 이름 " + randomUUID(),
    purpose: "응답 처리", lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }],
    recipientIds: [], retentionMode: "days", retentionDays: 30, retentionReason: "" }, randomUUID()));
}
async function publication(expiresAt: Date | null = null, revokedAt: Date | null = null, status = "published", type = "privacy_policy") {
  const doc = await db.document.create({ data: { tenantId: ctx.tenantId, serviceId, createdBy: userId, type, title: "비공개 원문 이름", effectiveDate: "2026-01-01", status } });
  const version = await db.documentVersion.create({ data: { tenantId: ctx.tenantId, serviceId, documentId: doc.id, number: 1, draftRevision: 1, snapshot: { schemaVersion: 1 }, renderedText: "기밀 본문", contentHash: sha256("기밀 본문") } });
  return db.documentPublication.create({ data: { tenantId: ctx.tenantId, serviceId, documentId: doc.id, documentVersionId: version.id,
    tokenHash: sha256(randomUUID()), tokenCipher: "v1.private-fixture-token", expiresAt, revokedAt, status: revokedAt ? "revoked" : "active",
    ...(expiresAt ? { createdAt: new Date(expiresAt.getTime() - 1000) } : {}) } });
}
test("자료가 없는 서비스는 준수 통과로 표시하지 않고 회사 정보도 담지 않는다", async () => {
  const saved = await close(), e = saved.evidence!;
  expect(e.facts).toMatchObject({ services: 1, purposeServices: 0, policyServices: 0, unpurgedSubmissions: 0, companyMfa: null });
  expect(complianceEvidenceChecks(e).map(c => c.status)).toEqual(["attention", "attention", "not_applicable", "not_assessed", "not_assessed"]);
  expect(saved.verdict).toBe("not_assessed"); expect(e.hash).toBe(complianceEvidenceHash(e));
  expect(e.checkedAt).toBe(saved.createdAt);
});
test("선택 서비스의 활성 목적과 유효 게시만 집계하며 중복 게시로 서비스 수를 늘리지 않는다", async () => {
  await purpose(); await purpose(); await purpose(otherId);
  const archived = await purpose(); await changeCatalogStatus(ctx, "purposes", archived.id, archived.version, false, randomUUID());
  await publication(); await publication(); await publication(new Date(0)); await publication(null, new Date());
  await publication(null, null, "archived"); await publication(null, null, "private"); await publication(null, null, "draft");
  await publication(null, null, "published", "consent");
  const saved = await close();
  expect(saved.evidence!.facts).toMatchObject({ purposeServices: 1, activePurposes: 2, policyServices: 1, livePolicyPublications: 2 });
  expect(complianceEvidenceChecks(saved.evidence!).slice(0, 2).map(c => c.status)).toEqual(["observed", "observed"]);
  const text = JSON.stringify(saved); for (const secret of ["기밀 목적 이름", "비공개 원문 이름", "기밀 본문", "private-fixture-token", otherId]) expect(text).not.toContain(secret);
});
test("기한 경계·보존 조치·파기 중·파기 완료를 구분하며 타 서비스 응답을 제외한다", async () => {
  const now = new Date();
  for (const id of [serviceId, otherId]) {
    const form = await db.form.create({ data: { tenantId: ctx.tenantId, serviceId: id, ownerId: userId, title: "응답" } });
    const version = await db.formVersion.create({ data: { tenantId: ctx.tenantId, formId: form.id, number: 1, title: "응답" } });
    const pub = await db.publication.create({ data: { tenantId: ctx.tenantId, formId: form.id, formVersionId: version.id, tokenHash: randomUUID(), tokenCipher: "synthetic", maxResponses: 100 } });
    for (const [offset, hold, status] of [[0, false, "submitted"], [-1, true, "submitted"], [1, false, "submitted"], [-1, false, "destroying"], [-1, false, "destroyed"]] as const) {
      const at = new Date(now.getTime() + offset);
      await db.submission.create({ data: { tenantId: ctx.tenantId, formVersionId: version.id, publicationId: pub.id, retentionUntil: at, originalRetentionUntil: at, legalHold: hold, status } });
    }
  }
  const e = await db.$transaction(tx => collectComplianceEvidence(tx, ctx.tenantId, [serviceId], now, false));
  expect(e.facts).toMatchObject({ unpurgedSubmissions: 4, overdueSubmissions: 2, heldSubmissions: 1 });
  expect(complianceEvidenceChecks(e)[2].status).toBe("attention");
});
test("회사 전체 마감만 구성원과 실제 정책을 포함하고 정책 부재를 미점검으로 둔다", async () => {
  const saved = (await closeComplianceMonth(ctx, { month }, randomUUID())).close;
  expect(saved.evidence!.facts.companyMfa).toEqual({ required: null, members: 1, enrolled: 0 });
  expect(complianceEvidenceChecks(saved.evidence!).slice(3).map(c => c.status)).toEqual(["attention", "not_assessed"]);
  await db.securityPolicy.create({ data: { tenantId: ctx.tenantId, requireMfa: false, passwordMonths: 0 } });
  const e = await db.$transaction(tx => collectComplianceEvidence(tx, ctx.tenantId, [serviceId, otherId], new Date(), true));
  expect(complianceEvidenceChecks(e)[4].status).toBe("attention");
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireMfa: true } });
  const enabled = await db.$transaction(tx => collectComplianceEvidence(tx, ctx.tenantId, [serviceId, otherId], new Date(), true));
  expect(complianceEvidenceChecks(enabled)[4].status).toBe("observed");
});
test("마감 후 원천 변경은 기존 근거·CSV·해시를 바꾸지 않고 다른 월의 새 점검에 반영한다", async () => {
  const first = await close(), csv = await complianceCloseCsv(ctx, first.id);
  await purpose(); await publication();
  expect((await close()).evidence).toEqual(first.evidence);
  expect((await readComplianceClose(ctx, { month, serviceId })).close?.evidence).toEqual(first.evidence);
  expect(await complianceCloseCsv(ctx, first.id)).toBe(csv);
  const next = await close(serviceId, "2026-08"); expect(next.evidence!.facts.purposeServices).toBe(1);
  expect(next.evidence!.hash).not.toBe(first.evidence!.hash);
  expect(csv).toContain(first.evidence!.hash); expect(csv).toContain("\"'=A\"");
});
test("인증 플래그만 켜진 구성원은 등록으로 세지 않고 검증된 인증만 확인한다", async () => {
  const member = await db.user.create({ data: { id: randomUUID(), name: "인증", email: randomUUID() + "@example.test", emailVerified: true, twoFactorEnabled: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: member.id, role: "viewer" } });
  const twoFactor = await db.twoFactor.create({ data: { userId: member.id, secret: "synthetic-private-secret", backupCodes: "synthetic-private-codes", verified: false } });
  const read = () => db.$transaction(tx => collectComplianceEvidence(tx, ctx.tenantId, [serviceId], new Date(), true));
  expect((await read()).facts.companyMfa).toMatchObject({ members: 2, enrolled: 0 });
  await db.twoFactor.update({ where: { id: twoFactor.id }, data: { verified: true } });
  const observed = await read(); expect(observed.facts.companyMfa).toMatchObject({ members: 2, enrolled: 1 });
  expect(JSON.stringify(observed)).not.toContain("synthetic-private");
});
test("활성 서비스가 없는 회사는 서비스 점검을 대상 없음으로 저장한다", async () => {
  await db.service.updateMany({ where: { tenantId: ctx.tenantId }, data: { status: "archived" } });
  const saved = (await closeComplianceMonth(ctx, { month }, randomUUID())).close;
  expect(saved.evidence!.serviceIds).toEqual([]);
  expect(complianceEvidenceChecks(saved.evidence!).slice(0, 3).map(c => c.status)).toEqual(["not_applicable", "not_applicable", "not_applicable"]);
});
test("근거 없는 이전 스냅샷의 정규화·출력 바이트와 진행 중 출력 원천 해시를 보존한다", async () => {
  const saved = await close(); const current = await db.complianceClose.findUniqueOrThrow({ where: { id: saved.id } });
  const { evidence: _unused, ...legacy } = complianceSnapshot(current); void _unused;
  legacy.month = "2026-07";
  const row = await db.complianceClose.create({ data: { tenantId: ctx.tenantId, serviceKey: serviceId, month: legacy.month, createdBy: userId, snapshot: legacy } });
  expect(JSON.stringify(complianceSnapshot(row))).toBe(JSON.stringify(legacy));
  const oldCsv = '\uFEFF"월","판정","서비스","보유 응답","기간 접수","기간 파기"\r\n"2026-07","미판정","선택 서비스","0","0","0"\r\n"2026-07","미판정","\'=A","0","0",""\r\n';
  expect(await complianceCloseCsv(ctx, row.id)).toBe(oldCsv);
  const job = await createComplianceExport(ctx, { closeId: row.id, format: "csv" }, randomUUID(), randomUUID());
  expect((await db.complianceExportJob.findUniqueOrThrow({ where: { id: job.id } })).sourceHash).toBe(sha256(JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString(), snapshot: legacy })));
  expect(await runOneComplianceExport("legacy-evidence", new Date(), job.id)).toBe(true);
  expect(Buffer.from((await downloadComplianceExport(ctx, job.id, randomUUID())).bytes!).toString()).toBe(oldCsv);
});
for (const mutation of ["hash", "scope", "counts", "company"]) test(`손상된 근거 ${mutation}는 반환하지 않는다`, async () => {
  const saved = await close(), row = await db.complianceClose.findUniqueOrThrow({ where: { id: saved.id } });
  const snapshot = complianceSnapshot(row), e = snapshot.evidence!;
  if (mutation === "hash") e.hash = "0".repeat(64);
  if (mutation === "scope") e.serviceIds = [otherId];
  if (mutation === "counts") e.facts.overdueSubmissions = 1;
  if (mutation === "company") e.facts.companyMfa = { required: false, members: 1, enrolled: 0 };
  if (mutation !== "hash") e.hash = complianceEvidenceHash(e);
  expect(() => complianceSnapshot({ ...row, snapshot })).toThrow();
});
test("비동기 PDF와 CSV는 같은 저장 근거·상태를 사용하고 원천 변경을 반영하지 않는다", async () => {
  const saved = await close(); await purpose();
  for (const format of ["pdf", "csv"] as const) {
    const job = await createComplianceExport(ctx, { closeId: saved.id, format }, randomUUID(), randomUUID());
    expect(await runOneComplianceExport("evidence-export", new Date(), job.id)).toBe(true);
    const file = await downloadComplianceExport(ctx, job.id, randomUUID());
    if (format === "csv") expect(Buffer.from(file.bytes!).toString()).toBe(await complianceCloseCsv(ctx, saved.id));
    else {
      const task = getDocument({ data: new Uint8Array(file.bytes!), useSystemFonts: false }), pdf = await task.promise;
      try {
        let text = ""; for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(x => "str" in x ? x.str : "").join(" ");
        expect(text).toContain(saved.evidence!.hash); expect(text).toContain("활성 목적 0개"); expect(text).toContain("검토 필요");
        expect(await pdf.getJSActions()).toBeNull();
      } finally { await task.destroy(); }
    }
  }
});
