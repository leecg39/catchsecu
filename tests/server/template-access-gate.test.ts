import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext } from "@/server/context";
import { createTemplate, getTemplate, listTemplates } from "@/server/templates";
import { formContentSchema } from "@/contracts/domains";
import { POST as contextSelect } from "@/app/api/v1/context/route";
import { GET as templateList } from "@/app/api/v1/templates/route";
import { POST as templateCreate } from "@/app/api/v1/templates/route";
import { DELETE as templateDelete } from "@/app/api/v1/templates/[...segments]/route";
import { encrypt, tokenHash } from "@/server/crypto";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
function req(path: string, cookie = "", method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function person() {
  const email = "template-gate-" + randomUUID() + "@catchsecu.test", password = "Template-test!123";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "합성 사용자", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password })); expect(login.status).toBe(200);
  return { user, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function fixture() {
  const company = await db.company.create({ data: { name: "템플릿 검증", publicName: "템플릿 검증", policy: { create: {} },
    services: { create: [{ name: "읽는 서비스", externalName: "읽기" }, { name: "다른 서비스", externalName: "다른" }] } }, include: { services: true } });
  const owner = await person(), editor = await person(), firstId = company.services[0].id, secondId = company.services[1].id;
  await db.membership.create({ data: { tenantId: company.id, userId: owner.user.id, role: "owner" } });
  const member = await db.membership.create({ data: { tenantId: company.id, userId: editor.user.id, role: "editor" } });
  const grant = await db.serviceGrant.create({ data: { tenantId: company.id, memberId: member.id, serviceId: firstId, capabilities: ["service.read", "form.read", "form.write"] } });
  const ctx = await requireContext(req("/context", editor.cookie).headers, "form.read"), ownerCtx = await requireContext(req("/context", owner.cookie).headers, "form.read");
  const content = formContentSchema.parse({ body: "합성 템플릿 본문", questions: [{ id: randomUUID(), type: "단문형 답변", label: "합성 질문", required: true }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 5 });
  const first = await db.$transaction(tx => createTemplate(ownerCtx, { serviceId: firstId, title: "A 회사 양식", category: "검증", content }, randomUUID(), tx));
  const second = await db.$transaction(tx => createTemplate(ownerCtx, { serviceId: secondId, title: "B 다른 양식", category: "다른", content }, randomUUID(), tx));
  const publicTemplate = await db.formTemplate.create({ data: { title: "C 공용 양식", category: "공용", content } });
  return { company, owner, editor, member, grant, ctx, ownerCtx, firstId, secondId, first, second, publicTemplate, content };
}
const query = { page: 1, pageSize: 10, search: "", scope: "all" as const };
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("목록은 오래된 Context의 회수된 조회 grant와 다른 서비스 양식을 노출하지 않는다", async () => {
  const f = await fixture(); await db.serviceGrant.delete({ where: { id: f.grant.id } });
  const list = await listTemplates(f.ctx, query); expect(list.items.map(row => row.id)).toEqual([f.publicTemplate.id]);
  await expect(listTemplates(f.ctx, { ...query, serviceId: f.firstId })).rejects.toMatchObject({ status: 403 });
  await expect(getTemplate(f.ctx, f.first.id)).rejects.toMatchObject({ status: 403 });
});
test("이전 Context의 역할 회수·이메일 미인증·종료 세션은 공용 목록도 우회하지 못한다", async () => {
  const f = await fixture(); await db.membership.update({ where: { id: f.member.id }, data: { role: "billing" } });
  await expect(listTemplates(f.ctx, query)).rejects.toMatchObject({ status: 403 });
  await db.membership.update({ where: { id: f.member.id }, data: { role: "editor" } });
  await db.user.update({ where: { id: f.editor.user.id }, data: { emailVerified: false } });
  await expect(listTemplates(f.ctx, query)).rejects.toMatchObject({ status: 401 });
  await db.user.update({ where: { id: f.editor.user.id }, data: { emailVerified: true } });
  await db.session.delete({ where: { id: f.ctx.session.id } });
  await expect(listTemplates(f.ctx, query)).rejects.toMatchObject({ status: 401 });
});
test("회사·구성원 정지 이후 오래된 Context로 템플릿 목록을 읽지 못한다", async () => {
  const f = await fixture(); await db.membership.update({ where: { id: f.member.id }, data: { status: "suspended" } });
  await expect(listTemplates(f.ctx, query)).rejects.toMatchObject({ status: 403 });
  await db.membership.update({ where: { id: f.member.id }, data: { status: "active" } });
  await db.company.update({ where: { id: f.company.id }, data: { status: "suspended" } });
  await expect(listTemplates(f.ctx, query)).rejects.toMatchObject({ status: 403 });
});
test("템플릿 검색·회사/공용 범위와 마지막·빈 페이지를 실제 결과에 맞춰 보정한다", async () => {
  const f = await fixture();
  const last = await listTemplates(f.ownerCtx, { ...query, page: 999, pageSize: 1 }); expect(last.page).toBe(3); expect(last.items).toHaveLength(1);
  const search = await listTemplates(f.ownerCtx, { ...query, page: 999, search: "A 회사" }); expect(search.page).toBe(1); expect(search.items[0].id).toBe(f.first.id);
  const empty = await listTemplates(f.ownerCtx, { ...query, page: 999, search: "없음" }); expect(empty.page).toBe(1); expect(empty.items).toEqual([]);
  expect((await listTemplates(f.ownerCtx, { ...query, scope: "company" })).total).toBe(2);
  expect((await listTemplates(f.ownerCtx, { ...query, scope: "public" })).total).toBe(1);
});
test("조회·작성 grant와 선택 서비스 상태를 GET 작업 및 생성 대상에 반영한다", async () => {
  const f = await fixture(); await db.serviceGrant.update({ where: { id: f.grant.id }, data: { capabilities: ["service.read", "form.read"] } });
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: f.member.id, serviceId: f.secondId, capabilities: ["service.read", "form.read", "form.write"] } });
  const selected = await listTemplates(f.ctx, { ...query, serviceId: f.firstId });
  expect(selected.permissions.canCreate).toBe(false); expect(selected.permissions.targets.map(row => row.id)).toEqual([f.secondId]);
  expect(selected.items.find(row => row.id === f.first.id)?.actions).toEqual({ preview: true, use: true, edit: false, remove: false });
  expect((await getTemplate(f.ctx, f.second.id)).actions).toEqual({ preview: true, use: true, edit: true, remove: true });
  expect((await getTemplate(f.ctx, f.publicTemplate.id)).actions?.edit).toBe(false);
  await db.service.update({ where: { id: f.secondId }, data: { status: "archived" } });
  const archived = await listTemplates(f.ctx, query); expect(archived.permissions.targets).toEqual([]); expect(archived.permissions.canCreate).toBe(false);
  expect((await getTemplate(f.ctx, f.second.id)).actions).toEqual({ preview: true, use: false, edit: false, remove: false });
});
async function expert(f: Awaited<ReturnType<typeof fixture>>) {
  const user = await person(), assignment = await db.expertAssignment.create({ data: { tenantId: f.company.id, expertUserId: user.user.id, assignedById: f.owner.user.id, expiresAt: new Date(Date.now() + 86400000) } });
  await db.expertAssignmentService.create({ data: { tenantId: f.company.id, assignmentId: assignment.id, serviceId: f.firstId } });
  const member = await db.membership.create({ data: { tenantId: f.company.id, userId: user.user.id, role: "viewer", accessKind: "expert", expertAssignmentId: assignment.id } });
  for (const serviceId of [f.firstId, f.secondId]) await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: member.id, serviceId, capabilities: ["service.read", "form.read", "form.write"] } });
  expect((await contextSelect(req("/context", user.cookie, "POST", { companyId: f.company.id }))).status).toBe(200);
  return { assignment, ctx: await requireContext(req("/context", user.cookie).headers, "form.read") };
}
test("전문가의 배정 외 grant·실제 배정 만료를 템플릿 목록에서도 차단한다", async () => {
  const f = await fixture(), e = await expert(f);
  const list = await listTemplates(e.ctx, { ...query, scope: "company" }); expect(list.items.map(row => row.id)).toEqual([f.first.id]); expect(list.permissions.targets).toEqual([]);
  await expect(listTemplates(e.ctx, { ...query, serviceId: f.secondId })).rejects.toMatchObject({ status: 403 });
  await db.expertAssignment.update({ where: { id: e.assignment.id }, data: { expiresAt: new Date(Date.now() + 100) } });
  await new Promise(resolve => setTimeout(resolve, 180));
  await expect(listTemplates(e.ctx, query)).rejects.toMatchObject({ status: 403 });
});
test("전문가의 보관 서비스 양식은 목록·상세에서 숨기고 직접 구성원의 읽기는 유지한다", async () => {
  const f = await fixture(), e = await expert(f); await db.service.update({ where: { id: f.firstId }, data: { status: "archived" } });
  expect((await listTemplates(e.ctx, { ...query, scope: "company" })).total).toBe(0);
  await expect(listTemplates(e.ctx, { ...query, serviceId: f.firstId })).rejects.toMatchObject({ status: 404 });
  await expect(getTemplate(e.ctx, f.first.id)).rejects.toMatchObject({ status: 404 });
  expect((await getTemplate(f.ctx, f.first.id)).id).toBe(f.first.id);
});
test("목록 입력은 알 수 없는 키를 거부하고 이름 정렬을 처리한다", async () => {
  const f = await fixture();
  expect((await templateList(req("/templates?unknown=true", f.owner.cookie))).status).toBe(422);
  const response = await templateList(req("/templates?sort=name&direction=asc", f.owner.cookie)); expect(response.status).toBe(200);
  expect((await response.json()).items.map((row: { title: string }) => row.title)).toEqual(["A 회사 양식", "B 다른 양식", "C 공용 양식"]);
});
test("삭제한 템플릿의 생성 캐시는 내용·해시를 지우고 새/이전 형식의 재전송을 410으로 막는다", async () => {
  const f = await fixture(), key = randomUUID(), input = { serviceId: f.firstId, title: "삭제할 양식", category: "QA", content: f.content };
  const created = await templateCreate(req("/templates", f.editor.cookie, "POST", input, { "idempotency-key": key })); expect(created.status).toBe(201); const row = await created.json();
  const otherKey = randomUUID(), otherInput = { ...input, title: "보존할 양식" };
  expect((await templateCreate(req("/templates", f.editor.cookie, "POST", otherInput, { "idempotency-key": otherKey }))).status).toBe(201);
  const legacyKey = randomUUID(), scope = "template:create:" + f.member.id;
  await db.idempotencyRecord.create({ data: { scope, key: legacyKey, requestHash: tokenHash("legacy"), responseCipher: encrypt(row), statusCode: 201, expiresAt: new Date(Date.now() + 86400000) } });
  expect((await templateDelete(req("/templates/" + row.id, f.editor.cookie, "DELETE", undefined, { "if-match": "2" }))).status).toBe(409);
  expect((await db.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope, key } } })).responseCipher).not.toBeNull();
  expect((await templateDelete(req("/templates/" + row.id, f.editor.cookie, "DELETE", undefined, { "if-match": "1" }))).status).toBe(204);
  for (const retryKey of [key, legacyKey]) {
    expect((await templateCreate(req("/templates", f.editor.cookie, "POST", input, { "idempotency-key": retryKey }))).status).toBe(410);
    const cache = await db.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope, key: retryKey } } });
    expect(cache.responseCipher).toBeNull(); expect(cache.requestHash).toBeNull(); expect(cache.invalidatedAt).not.toBeNull();
  }
  expect((await templateCreate(req("/templates", f.editor.cookie, "POST", otherInput, { "idempotency-key": otherKey }))).status).toBe(201);
  expect(await db.formTemplate.count({ where: { id: row.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { resourceId: row.id, action: "template.deleted" } })).toBe(1);
  expect(await db.formTemplate.count({ where: { id: { in: [f.first.id, f.second.id] } } })).toBe(2);
});
