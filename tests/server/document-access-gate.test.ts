import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, expect, test, vi } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { listQuery } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createPurpose } from "@/server/processing-catalog";
import { documentQuery, clauseQuery, createDocument, readDocument, listDocuments, updateDocument, previewDocument, documentHistory, publishDocument,
  changeDocumentState, revokeDocumentLink, createClause, readClause, listClauses, updateClause, changeClauseState, applyClause, documentOptions, readDisplay, updateDisplay, lockDocumentService, publicDocument } from "@/server/documents";
import { privateDocumentPdf } from "@/server/document-pdf";
import { formDocumentOptions } from "@/server/form-documents";
import { emptyDisplay, type DocumentInput, type ClauseInput } from "@/contracts/documents";
import { POST as selectCompany } from "@/app/api/v1/context/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
function req(path: string, cookie = "", value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: value === undefined ? "GET" : "POST", headers: { origin, cookie, ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function account() {
  const email = "document-gate-" + randomUUID() + "@catchsecu.test", password = "Document-gate!123";
  expect((await auth.handler(req("/auth/sign-up/email", "", { email, password, name: "문서 게이트" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const result = await auth.handler(req("/auth/sign-in/email", "", { email, password })); expect(result.status).toBe(200);
  return { user, cookie: result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function fixture() {
  const owner = await account();
  const company = await db.company.create({ data: { name: "문서 검사 회사", publicName: "문서 검사", policy: { create: {} },
    services: { create: [{ name: "문서 서비스", externalName: "문서" }, { name: "다른 서비스", externalName: "다른" }] },
    memberships: { create: { userId: owner.user.id, role: "owner" } } }, include: { services: true } });
  const ctx = await requireContext(req("/context", owner.cookie).headers, "document.write"), serviceId = company.services[0].id;
  async function ready(id: string) {
    const purpose = await db.$transaction(tx => createPurpose(tx, ctx, { serviceId: id, name: "문서 목적 " + randomUUID(), purpose: "합성 상담 처리",
      lawfulBasis: "consent", basisReference: "", items: [{ name: "이름", kind: "general", required: true }], recipientIds: [], retentionMode: "days", retentionDays: 30, retentionReason: "" }, randomUUID()));
    const input: DocumentInput = { serviceId: id, type: "consent", title: "합성 동의서 " + randomUUID(), body: "당시 동의 문구", refusalNotice: "거부할 수 있습니다.", rightsContact: "QA 문의", effectiveDate: "2026-10-03", purposeIds: [purpose.id], recipientIds: [] };
    const row = await db.$transaction(tx => createDocument(tx, ctx, input, randomUUID()));
    const published = await publishDocument(ctx, row.id, { version: row.version, expiresAt: null }, randomUUID());
    const clauseInput: ClauseInput = { serviceId: id, type: "consent", title: "합성 문구", body: "문구 사본" };
    const clause = await db.$transaction(tx => createClause(tx, ctx, clauseInput, randomUUID()));
    return { input, row: published.document, published, clauseInput, clause };
  }
  return { ...owner, company, serviceId, secondId: company.services[1].id, ctx, ready, ...await ready(serviceId) };
}
async function expert(f: Awaited<ReturnType<typeof fixture>>) {
  const user = await account();
  const assignment = await db.expertAssignment.create({ data: { tenantId: f.company.id, expertUserId: user.user.id, assignedById: f.user.id, expiresAt: new Date(Date.now() + 86400000) } });
  await db.expertAssignmentService.create({ data: { tenantId: f.company.id, assignmentId: assignment.id, serviceId: f.serviceId } });
  const member = await db.membership.create({ data: { tenantId: f.company.id, userId: user.user.id, role: "viewer", accessKind: "expert", expertAssignmentId: assignment.id } });
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: member.id, serviceId: f.serviceId, capabilities: ["document.read", "service.read"] } });
  expect((await selectCompany(req("/context", user.cookie, { companyId: f.company.id }))).status).toBe(200);
  return { ...user, assignment, member, ctx: await requireContext(req("/context", user.cookie).headers, "document.read") };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await db.$disconnect(); });

test("로그아웃한 Context로 문서·문구·미리보기·이력·PDF·표시 설정·동의 선택을 읽거나 변경할 수 없다", async () => {
  const f = await fixture(); await db.session.delete({ where: { id: f.ctx.session.id } });
  const calls = [
    () => listDocuments(f.ctx, documentQuery.parse({})), () => readDocument(f.ctx, f.row.id), () => previewDocument(f.ctx, f.row.id), () => documentHistory(f.ctx, f.row.id, listQuery.parse({})),
    () => listClauses(f.ctx, clauseQuery.parse({})), () => readClause(f.ctx, f.clause.id), () => documentOptions(f.ctx, f.serviceId),
    () => readDisplay(f.ctx, f.serviceId, "collection"), () => formDocumentOptions(f.ctx, f.serviceId, { page: 1, pageSize: 20, search: "" }),
    () => privateDocumentPdf(f.ctx, f.row.id, 1, randomUUID()), () => db.$transaction(tx => createDocument(tx, f.ctx, { ...f.input, title: "거부할 생성" }, randomUUID())),
    () => updateDocument(f.ctx, f.row.id, { ...f.input, body: "변경", version: f.row.version }, randomUUID()),
    () => publishDocument(f.ctx, f.row.id, { version: f.row.version, expiresAt: null }, randomUUID()),
    () => changeDocumentState(f.ctx, f.row.id, f.row.version, "archive", randomUUID()),
    () => revokeDocumentLink(f.ctx, f.row.id, { version: f.row.version, publicationId: f.published.publicationId }, randomUUID()),
    () => db.$transaction(tx => createClause(tx, f.ctx, { ...f.clauseInput, title: "거부할 문구" }, randomUUID())),
    () => updateClause(f.ctx, f.clause.id, { ...f.clauseInput, version: 1 }, randomUUID()),
    () => changeClauseState(f.ctx, f.clause.id, 1, false, randomUUID()),
    () => applyClause(f.ctx, f.row.id, { version: f.row.version, templateId: f.clause.id, templateVersion: 1 }, randomUUID()),
    () => updateDisplay(f.ctx, f.serviceId, "collection", emptyDisplay(), randomUUID()),
  ];
  for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 401 });
  expect(await db.document.count()).toBe(1); expect(await db.documentVersion.count()).toBe(1); expect(await db.documentPdf.count()).toBe(0);
});
test("만료된 세션으로 문서와 문구를 처리하지 못한다", async () => {
  const f = await fixture(); await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expect(readDocument(f.ctx, f.row.id)).rejects.toMatchObject({ status: 401 });
  await expect(updateClause(f.ctx, f.clause.id, { ...f.clauseInput, body: "변경", version: 1 }, randomUUID())).rejects.toMatchObject({ status: 401 });
});
test("이메일 인증이 회수된 Context의 초안 생성과 이력을 거부한다", async () => {
  const f = await fixture(); await db.user.update({ where: { id: f.user.id }, data: { emailVerified: false } });
  await expect(documentHistory(f.ctx, f.row.id, listQuery.parse({}))).rejects.toMatchObject({ status: 401 });
  await expect(db.$transaction(tx => createDocument(tx, f.ctx, f.input, randomUUID()))).rejects.toMatchObject({ status: 401 });
});
test("실제 시간이 지나 만료된 전문가 배정은 문서·문구·PDF·폼 동의 선택을 열 수 없다", async () => {
  const f = await fixture(), e = await expert(f);
  expect((await readDocument(e.ctx, f.row.id)).id).toBe(f.row.id);
  await db.expertAssignment.update({ where: { id: e.assignment.id }, data: { expiresAt: new Date(Date.now() + 100) } });
  await new Promise(resolve => setTimeout(resolve, 180));
  expect((await db.expertAssignment.findUniqueOrThrow({ where: { id: e.assignment.id } })).expiresAt <= new Date()).toBe(true);
  for (const call of [() => readDocument(e.ctx, f.row.id), () => readClause(e.ctx, f.clause.id), () => privateDocumentPdf(e.ctx, f.row.id, 1, randomUUID()),
    () => formDocumentOptions(e.ctx, f.serviceId, { page: 1, pageSize: 20, search: "" })]) await expect(call()).rejects.toMatchObject({ status: 403 });
  expect(await db.documentPdf.count()).toBe(0);
});
test("전문가 배정을 회수하면 남은 membership과 grant로 문서 이력을 열 수 없다", async () => {
  const f = await fixture(), e = await expert(f);
  await db.expertAssignment.update({ where: { id: e.assignment.id }, data: { status: "revoked", revokedAt: new Date() } });
  await expect(documentHistory(e.ctx, f.row.id, listQuery.parse({}))).rejects.toMatchObject({ status: 403 });
});
test("배정하지 않은 서비스의 여분 grant는 문서·문구·폼 문서 선택·PDF 범위를 넓히지 않는다", async () => {
  const f = await fixture(), other = await f.ready(f.secondId), e = await expert(f);
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: e.member.id, serviceId: f.secondId, capabilities: ["document.read"] } });
  expect((await listDocuments(e.ctx, documentQuery.parse({}))).items.map(row => row.id)).toEqual([f.row.id]);
  expect((await listClauses(e.ctx, clauseQuery.parse({}))).items.map(row => row.id)).toEqual([f.clause.id]);
  for (const call of [() => readDocument(e.ctx, other.row.id), () => documentOptions(e.ctx, f.secondId), () => privateDocumentPdf(e.ctx, other.row.id, 1, randomUUID()),
    () => formDocumentOptions(e.ctx, f.secondId, { page: 1, pageSize: 20, search: "" })]) await expect(call()).rejects.toMatchObject({ status: 403 });
});
test("완료한 생성 요청의 재전송도 로그아웃한 Context를 거부한다", async () => {
  const f = await fixture(), key = randomUUID(), input = { ...f.input, title: "중복 요청 초안" };
  const replay = () => idempotent("document:gate:" + f.ctx.member.id, key, input, async tx => ({ status: 201, body: await createDocument(tx, f.ctx, input, randomUUID()) }),
    tx => lockDocumentService(tx, f.ctx, f.serviceId, "document.write"));
  await replay(); await db.session.delete({ where: { id: f.ctx.session.id } });
  await expect(replay()).rejects.toMatchObject({ status: 401 }); expect(await db.document.count()).toBe(2);
});
test("동시 세션 회수의 DB 잠금을 기다린 뒤 이전 Context의 문서 열람을 거부한다", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const writer = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${f.ctx.session.id} FOR UPDATE`; entered(); await gate;
    await tx.session.delete({ where: { id: f.ctx.session.id } });
  }, { timeout: 15000 });
  await ready;
  const reading = readDocument(f.ctx, f.row.id).then(() => 200, error => error.status as number);
  let waiting = false;
  try {
    const deadline = Date.now() + 2000;
    while (!waiting && Date.now() < deadline) {
      const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Session"%' AND query LIKE '%FOR SHARE%') AS waiting`;
      waiting = rows[0].waiting; if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally { release(); await writer; }
  expect(await reading).toBe(401);
});
test("소유자 로그아웃은 이미 공개한 독립 문서 링크를 회수하지 않는다", async () => {
  const f = await fixture(), token = f.published.url.split("/").pop()!;
  await db.session.delete({ where: { id: f.ctx.session.id } });
  expect((await publicDocument(token)).snapshot.body).toBe(f.input.body);
});
test("만료된 게시 링크 이력은 expired를 표시하고 공유 URL을 제공하지 않는다", async () => {
  const f = await fixture();
  const draft = await updateDocument(f.ctx, f.row.id, { ...f.input, body: "만료 시험 본문", version: f.row.version }, randomUUID());
  const published = await publishDocument(f.ctx, f.row.id, { version: draft.version, expiresAt: new Date(Date.now() + 120000).toISOString() }, randomUUID());
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 180000));
  const history = await documentHistory(f.ctx, f.row.id, listQuery.parse({}));
  const link = history.items.flatMap(row => row.publications).find(row => row.id === published.publicationId)!;
  expect(link.status).toBe("expired"); expect(link).not.toHaveProperty("url");
  await expect(publicDocument(published.url.split("/").pop()!)).rejects.toMatchObject({ status: 410 });
});

test("모든 링크가 만료되면 동일한 내용의 새 게시본을 만들고 옛 링크의 만료를 유지한다", async () => {
  const f = await fixture();
  const closed = await revokeDocumentLink(f.ctx, f.row.id, { version: f.row.version, publicationId: f.published.publicationId }, randomUUID());
  const expiring = await publishDocument(f.ctx, f.row.id, { version: closed.version, expiresAt: new Date(Date.now() + 120000).toISOString() }, randomUUID());
  expect(expiring.document.hasActivePublication).toBe(true);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 180000));
  expect(await readDocument(f.ctx, f.row.id)).toMatchObject({ status: "published", hasActivePublication: false, hasUnpublishedChanges: false });
  const reopened = await publishDocument(f.ctx, f.row.id, { version: expiring.document.version, expiresAt: null }, randomUUID());
  expect(reopened.number).toBe(3); expect(reopened.document.hasActivePublication).toBe(true);
  const versions = await db.documentVersion.findMany({ where: { documentId: f.row.id }, orderBy: { number: "asc" } });
  expect(new Set(versions.map(row => row.contentHash)).size).toBe(1);
  await expect(publicDocument(expiring.url.split("/").pop()!)).rejects.toMatchObject({ status: 410 });
  expect((await publicDocument(reopened.url.split("/").pop()!)).snapshot.body).toBe(f.input.body);
});

test("이전 버전 링크가 유효해도 최신 버전만 만료되면 최신 내용으로 재게시할 수 있다", async () => {
  const f = await fixture();
  const draft = await updateDocument(f.ctx, f.row.id, { ...f.input, body: "최신 내용", version: f.row.version }, randomUUID());
  const expiring = await publishDocument(f.ctx, f.row.id, { version: draft.version, expiresAt: new Date(Date.now() + 120000).toISOString() }, randomUUID());
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 180000));
  expect((await publicDocument(f.published.url.split("/").pop()!)).snapshot.body).toBe(f.input.body);
  expect(await readDocument(f.ctx, f.row.id)).toMatchObject({ latestNumber: 2, hasActivePublication: false, hasUnpublishedChanges: false });
  const reopened = await publishDocument(f.ctx, f.row.id, { version: expiring.document.version, expiresAt: null }, randomUUID());
  expect(reopened.number).toBe(3);
  await expect(publicDocument(expiring.url.split("/").pop()!)).rejects.toMatchObject({ status: 410 });
  expect((await publicDocument(reopened.url.split("/").pop()!)).snapshot.body).toBe("최신 내용");
});
