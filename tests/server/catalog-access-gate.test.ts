import { randomUUID } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { listQuery } from "@/server/http";
import { catalogQuery, listCatalog, readCatalog, catalogHistory, createPurpose, createRecipient, updateRecipient, changeCatalogStatus } from "@/server/processing-catalog";
import type { PurposeInput, RecipientInput } from "@/contracts/processing-catalog";
import { POST as selectCompany } from "@/app/api/v1/context/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
function req(path: string, cookie = "", value?: unknown) {
  return new Request(origin + "/api/v1" + path, { method: value ? "POST" : "GET", headers: { origin, cookie, ...(value ? { "content-type": "application/json" } : {}) }, ...(value ? { body: JSON.stringify(value) } : {}) });
}
async function account() {
  const email = "catalog-gate-" + randomUUID() + "@catchsecu.test", password = "Catalog-gate!123";
  expect((await auth.handler(req("/auth/sign-up/email", "", { email, password, name: "수집 근거 시험" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const result = await auth.handler(req("/auth/sign-in/email", "", { email, password })); expect(result.status).toBe(200);
  return { user, cookie: result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
const recipient = (serviceId: string): RecipientInput => ({ serviceId, name: "수탁자 " + randomUUID(), kind: "processor", countryCode: "KR", purpose: "합성 정보 전달", items: ["이메일"],
  retentionMode: "days", retentionDays: 7, retentionReason: "", contact: "test@catchsecu.test", transferMethod: "", transferTiming: "", refusalNotice: "" });
const purpose = (serviceId: string): PurposeInput => ({ serviceId, name: "수집 목적 " + randomUUID(), purpose: "합성 신청 처리", lawfulBasis: "consent", basisReference: "",
  items: [{ name: "이름", kind: "general", required: true }], recipientIds: [], retentionMode: "days", retentionDays: 30, retentionReason: "" });
async function fixture() {
  const owner = await account();
  const company = await db.company.create({ data: { name: "수집 근거 경계", publicName: "수집 근거", policy: { create: {} },
    services: { create: [{ name: "수집 서비스", externalName: "수집" }, { name: "다른 서비스", externalName: "다른" }] },
    memberships: { create: { userId: owner.user.id, role: "owner" } } }, include: { services: true } });
  const serviceId = company.services[0].id, secondId = company.services[1].id, ctx = await requireContext(req("/context", owner.cookie).headers, "document.write");
  const input = recipient(serviceId), row = await db.$transaction(tx => createRecipient(tx, ctx, input, randomUUID()));
  return { ...owner, company, serviceId, secondId, ctx, input, row };
}
async function expert(f: Awaited<ReturnType<typeof fixture>>) {
  const user = await account();
  const assignment = await db.expertAssignment.create({ data: { tenantId: f.company.id, expertUserId: user.user.id, assignedById: f.user.id,
    expiresAt: new Date(Date.now() + 86400000) } });
  await db.expertAssignmentService.create({ data: { tenantId: f.company.id, assignmentId: assignment.id, serviceId: f.serviceId } });
  const member = await db.membership.create({ data: { tenantId: f.company.id, userId: user.user.id, role: "viewer", accessKind: "expert", expertAssignmentId: assignment.id } });
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: member.id, serviceId: f.serviceId, capabilities: ["document.read", "service.read"] } });
  expect((await selectCompany(req("/context", user.cookie, { companyId: f.company.id }))).status).toBe(200);
  const ctx = await requireContext(req("/context", user.cookie).headers, "document.read");
  return { ...user, assignment, member, ctx };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("로그아웃한 이전 Context는 목록·상세·이력·생성·수정·보관을 처리할 수 없다", async () => {
  const f = await fixture(); await db.session.delete({ where: { id: f.ctx.session.id } });
  for (const call of [
    () => listCatalog(f.ctx, "recipients", catalogQuery.parse({})), () => readCatalog(f.ctx, "recipients", f.row.id), () => catalogHistory(f.ctx, "recipients", f.row.id, listQuery.parse({})),
    () => db.$transaction(tx => createRecipient(tx, f.ctx, recipient(f.serviceId), randomUUID())), () => db.$transaction(tx => createPurpose(tx, f.ctx, purpose(f.serviceId), randomUUID())),
    () => updateRecipient(f.ctx, f.row.id, { ...f.input, version: 1, purpose: "변경" }, randomUUID()), () => changeCatalogStatus(f.ctx, "recipients", f.row.id, 1, false, randomUUID()),
  ]) await expect(call()).rejects.toMatchObject({ status: 401 });
  expect(await db.recipient.count()).toBe(1); expect(await db.recipientRevision.count()).toBe(1);
});
test("만료된 세션 Context는 수집 근거를 읽거나 생성하지 못한다", async () => {
  const f = await fixture(); await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expect(readCatalog(f.ctx, "recipients", f.row.id)).rejects.toMatchObject({ status: 401 });
  await expect(db.$transaction(tx => createPurpose(tx, f.ctx, purpose(f.serviceId), randomUUID()))).rejects.toMatchObject({ status: 401 });
});
test("이메일 인증을 회수하면 이전 Context의 읽기와 쓰기를 거부한다", async () => {
  const f = await fixture(); await db.user.update({ where: { id: f.user.id }, data: { emailVerified: false } });
  await expect(listCatalog(f.ctx, "recipients", catalogQuery.parse({}))).rejects.toMatchObject({ status: 401 });
  await expect(updateRecipient(f.ctx, f.row.id, { ...f.input, version: 1, purpose: "변경" }, randomUUID())).rejects.toMatchObject({ status: 401 });
});
test("전문가 배정이 만료되면 기존 Context로 목록·상세·이력을 읽을 수 없다", async () => {
  const f = await fixture(), e = await expert(f);
  expect((await listCatalog(e.ctx, "recipients", catalogQuery.parse({}))).total).toBe(1);
  await db.expertAssignment.update({ where: { id: e.assignment.id }, data: { expiresAt: new Date(Date.now() + 100) } });
  await new Promise(resolve => setTimeout(resolve, 180));
  expect((await db.expertAssignment.findUniqueOrThrow({ where: { id: e.assignment.id } })).expiresAt <= new Date()).toBe(true);
  await expect(listCatalog(e.ctx, "recipients", catalogQuery.parse({}))).rejects.toMatchObject({ status: 403 });
  await expect(readCatalog(e.ctx, "recipients", f.row.id)).rejects.toMatchObject({ status: 403 });
  await expect(catalogHistory(e.ctx, "recipients", f.row.id, listQuery.parse({}))).rejects.toMatchObject({ status: 403 });
});
test("전문가 배정 상태를 회수하면 남아 있는 구성원/grant로 열람하지 못한다", async () => {
  const f = await fixture(), e = await expert(f);
  await db.expertAssignment.update({ where: { id: e.assignment.id }, data: { status: "revoked", revokedAt: new Date() } });
  await expect(readCatalog(e.ctx, "recipients", f.row.id)).rejects.toMatchObject({ status: 403 });
});
test("전문가의 여분 grant로 배정하지 않은 서비스의 수집 근거를 읽을 수 없다", async () => {
  const f = await fixture(), second = await db.$transaction(tx => createRecipient(tx, f.ctx, recipient(f.secondId), randomUUID())), e = await expert(f);
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: e.member.id, serviceId: f.secondId, capabilities: ["document.read"] } });
  const listed = await listCatalog(e.ctx, "recipients", catalogQuery.parse({})); expect(listed.total).toBe(1); expect(listed.items[0].id).toBe(f.row.id);
  await expect(readCatalog(e.ctx, "recipients", second.id)).rejects.toMatchObject({ status: 403 });
});
test("보관 서비스의 기존 수집 근거를 읽고 이력은 유지하며 생성·수정·보관을 차단한다", async () => {
  const f = await fixture(); await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
  expect((await readCatalog(f.ctx, "recipients", f.row.id)).id).toBe(f.row.id);
  expect((await catalogHistory(f.ctx, "recipients", f.row.id, listQuery.parse({}))).total).toBe(1);
  await expect(db.$transaction(tx => createPurpose(tx, f.ctx, purpose(f.serviceId), randomUUID()))).rejects.toMatchObject({ status: 409 });
  await expect(updateRecipient(f.ctx, f.row.id, { ...f.input, version: 1, purpose: "변경" }, randomUUID())).rejects.toMatchObject({ status: 409 });
  await expect(changeCatalogStatus(f.ctx, "recipients", f.row.id, 1, false, randomUUID())).rejects.toMatchObject({ status: 409 });
});
