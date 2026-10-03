import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { archiveForm, setFormFavorite, transitionForm } from "@/server/forms";
import { deleteTemplate, updateTemplate } from "@/server/templates";
import { POST as formCreate, GET as formList } from "@/app/api/v1/forms/route";
import { GET as formGet, POST as formAction, PATCH as formPatch, PUT as favorite, DELETE as formDelete } from "@/app/api/v1/forms/[...segments]/route";
import { POST as templateCreate } from "@/app/api/v1/templates/route";
import { PATCH as templatePatch, DELETE as templateDelete } from "@/app/api/v1/templates/[...segments]/route";
import type { FormContent } from "@/contracts/forms";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
const origin = new URL(env.BETTER_AUTH_URL).origin, password = "Form-crud-gate!123";
function req(path: string, method = "GET", cookie = "", value?: unknown, extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...extra, ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function person(role: "owner" | "editor" | "viewer", tenantId: string) {
  const email = "form-gate-" + randomUUID() + "@catchsecu.test";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name: role, email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password }));
  expect(login.status).toBe(200);
  return { user, member, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function setup() {
  const company = await db.company.create({ data: { name: "폼 CRUD 시험", publicName: "폼 시험", policy: { create: {} },
    services: { create: { name: "폼 서비스", externalName: "폼 서비스" } } }, include: { services: true } });
  const owner = await person("owner", company.id), editor = await person("editor", company.id), viewer = await person("viewer", company.id);
  const serviceId = company.services[0].id;
  for (const user of [editor, viewer]) await db.serviceGrant.create({ data: { tenantId: company.id, serviceId, memberId: user.member.id,
    capabilities: user === editor ? ["service.read", "form.read", "form.write", "form.publish"] : ["service.read", "form.read"] } });
  const content: FormContent = { body: "신청서", verify: false, font: "16px", bold: false, consentRequired: false, consentPurpose: "",
    retentionDays: 30, maxResponses: 50, showSubmitNotice: true, questions: [
      { id: randomUUID(), type: "단문형 답변", label: "이름", required: true, subjectRole: "name" },
      { id: randomUUID(), type: "단문형 답변", label: "이메일", required: true, subjectRole: "email" },
      { id: randomUUID(), type: "객관식 답변", label: "참여 방식", required: true, options: ["온라인", "현장"] },
    ] };
  return { company, owner, editor, viewer, serviceId, content };
}
async function addForm(f: Awaited<ReturnType<typeof setup>>, title = "신청 폼") {
  const response = await formCreate(req("/forms", "POST", f.editor.cookie, { serviceId: f.serviceId, title, content: f.content }, { "idempotency-key": randomUUID() }));
  expect(response.status).toBe(201); return response.json();
}
async function addTemplate(f: Awaited<ReturnType<typeof setup>>) {
  const response = await templateCreate(req("/templates", "POST", f.editor.cookie, { serviceId: f.serviceId, title: "시험 템플릿", category: "신청", content: f.content }, { "idempotency-key": randomUUID() }));
  expect(response.status).toBe(201); return response.json();
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("폼 복제는 질문·선택지·버전 ID를 독립 생성하고 재전송 및 원본 편집과 분리된다", async () => {
  const f = await setup();
  f.content.marketing = { purpose: "선택한 이메일 안내", nameQuestionId: f.content.questions[0].id, emailQuestionId: f.content.questions[1].id };
  const original = await addForm(f), key = randomUUID(), path = "/forms/" + original.id + "/copy";
  const responses = await Promise.all([0, 1].map(() => formAction(req(path, "POST", f.editor.cookie, {}, { "idempotency-key": key }))));
  expect(responses.map(response => response.status)).toEqual([201, 201]);
  const copies = await Promise.all(responses.map(response => response.json()));
  expect(copies[0].id).toBe(copies[1].id); expect(copies[0].id).not.toBe(original.id);
  const sourceIds = original.content.questions.map((question: { id: string }) => question.id);
  for (const question of copies[0].content.questions) expect(sourceIds).not.toContain(question.id);
  expect(copies[0].content.marketing).toMatchObject({ nameQuestionId: copies[0].content.questions[0].id, emailQuestionId: copies[0].content.questions[1].id });
  const stored = await db.formVersion.findMany({ where: { formId: { in: [original.id, copies[0].id] } }, include: { questions: { include: { options: true } } } });
  expect(new Set(stored.flatMap(version => version.questions.map(question => question.id))).size).toBe(6);
  expect(new Set(stored.flatMap(version => version.questions.flatMap(question => question.options.map(option => option.id)))).size).toBe(4);
  expect((await formPatch(req("/forms/" + original.id, "PATCH", f.editor.cookie, { version: 1, content: { ...f.content, body: "원본만 변경" } }))).status).toBe(200);
  const copyAfter = await (await formGet(req("/forms/" + copies[0].id, "GET", f.editor.cookie))).json();
  expect(copyAfter.content).toEqual(copies[0].content);
  expect(await db.form.count({ where: { tenantId: f.company.id } })).toBe(2);
});

test("게시본의 질문·선택지·본문은 DB에서 불변이고 편집·복제는 새 초안을 사용한다", async () => {
  const f = await setup(), form = await addForm(f);
  const published = await formAction(req("/forms/" + form.id + "/publish", "POST", f.editor.cookie, { version: 1 }, { "idempotency-key": randomUUID() }));
  expect(published.status).toBe(201);
  const stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id, status: "published" }, include: { questions: { include: { options: true } } } });
  await expect(db.formVersion.update({ where: { id: stored.id }, data: { body: "허용되지 않은 본문" } })).rejects.toThrow();
  await expect(db.question.update({ where: { id: stored.questions[0].id }, data: { label: "허용되지 않은 질문" } })).rejects.toThrow();
  await expect(db.question.delete({ where: { id: stored.questions[0].id } })).rejects.toThrow();
  const option = stored.questions.flatMap(question => question.options)[0];
  await expect(db.questionOption.update({ where: { id: option.id }, data: { value: "허용되지 않은 선택지" } })).rejects.toThrow();
  const edited = await formPatch(req("/forms/" + form.id, "PATCH", f.editor.cookie, { version: 2, content: { ...f.content, body: "새 초안", questions: [...f.content.questions].reverse() } }));
  expect(edited.status).toBe(200); expect((await edited.json()).draftNumber).toBe(2);
  const copied = await formAction(req("/forms/" + form.id + "/copy", "POST", f.editor.cookie, {}, { "idempotency-key": randomUUID() }));
  expect(copied.status).toBe(201); const value = await copied.json();
  expect(value.content.body).toBe("새 초안"); expect(value.content.questions.map((question: { label: string }) => question.label)).toEqual([...f.content.questions].reverse().map(question => question.label));
  expect(value).toMatchObject({ draftNumber: 1, status: "draft", publication: null });
  expect((await db.formVersion.findUniqueOrThrow({ where: { id: stored.id } })).body).toBe(f.content.body);
});

test("게시 중지·재개는 현재 권한과 세션·만료·버전을 검사하고 실패 시 그대로 둔다", async () => {
  const f = await setup(), form = await addForm(f);
  expect((await formAction(req("/forms/" + form.id + "/publish", "POST", f.editor.cookie, { version: 1 }, { "idempotency-key": randomUUID() }))).status).toBe(201);
  const ctx = await requireContext(req("/context", "GET", f.editor.cookie).headers, "form.publish");
  expect((await formAction(req("/forms/" + form.id + "/pause", "POST", f.editor.cookie, { version: 1 }))).status).toBe(409);
  expect((await formAction(req("/forms/" + form.id + "/pause", "POST", f.editor.cookie, { version: 2 }))).status).toBe(200);
  await db.serviceGrant.deleteMany({ where: { memberId: f.editor.member.id } });
  await expect(transitionForm(ctx, form.id, 3, "resume", randomUUID())).rejects.toMatchObject({ status: 403 });
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).status).toBe("paused");
  const ownerCtx = await requireContext(req("/context", "GET", f.owner.cookie).headers, "form.publish");
  await db.session.delete({ where: { id: ownerCtx.session.id } });
  await expect(transitionForm(ownerCtx, form.id, 3, "resume", randomUUID())).rejects.toMatchObject({ status: 401 });
  await db.publication.updateMany({ where: { formId: form.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await db.serviceGrant.create({ data: { tenantId: f.company.id, serviceId: f.serviceId, memberId: f.editor.member.id,
    capabilities: ["form.read", "form.write", "form.publish"] } });
  expect((await formAction(req("/forms/" + form.id + "/resume", "POST", f.editor.cookie, { version: 3 }))).status).toBe(409);
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).status).toBe("paused");
});

test("보관된 폼은 독립 초안으로 복제할 수 있고 최대 길이의 이름도 제한 내에서 생성한다", async () => {
  const f = await setup(), form = await addForm(f, "가".repeat(200));
  expect((await formDelete(req("/forms/" + form.id, "DELETE", f.editor.cookie, undefined, { "if-match": "1" }))).status).toBe(204);
  const copied = await formAction(req("/forms/" + form.id + "/copy", "POST", f.editor.cookie, {}, { "idempotency-key": randomUUID() }));
  expect(copied.status).toBe(201); const value = await copied.json();
  expect(value.title).toHaveLength(200); expect(value.status).toBe("draft");
  expect(value.title).toMatch(/ \(복사\)$/); expect(value.id).not.toBe(form.id);
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).status).toBe("archived");
});

test("즐겨찾기도 권한 회수 후의 오래된 Context를 거부한다", async () => {
  const f = await setup(), form = await addForm(f), ctx = await requireContext(req("/context", "GET", f.viewer.cookie).headers, "form.read");
  await db.serviceGrant.deleteMany({ where: { memberId: f.viewer.member.id } });
  await expect(setFormFavorite(ctx, form.id, true)).rejects.toMatchObject({ status: 403 });
  expect(await db.formFavorite.count({ where: { memberId: f.viewer.member.id } })).toBe(0);
});

test("권한 회수 후의 오래된 Context는 폼 보관과 템플릿 삭제를 거부한다", async () => {
  const f = await setup(), form = await addForm(f), template = await addTemplate(f), ctx = await requireContext(req("/context", "GET", f.editor.cookie).headers, "form.write");
  await db.serviceGrant.deleteMany({ where: { memberId: f.editor.member.id } });
  await expect(archiveForm(ctx, form.id, 1, randomUUID())).rejects.toMatchObject({ status: 403 });
  await expect(deleteTemplate(ctx, template.id, 1, randomUUID())).rejects.toMatchObject({ status: 403 });
  expect((await db.form.findUniqueOrThrow({ where: { id: form.id } })).status).toBe("draft");
  expect(await db.formTemplate.count({ where: { id: template.id } })).toBe(1);
});

test("로그아웃과 이메일 인증 취소 후에는 오래된 Context로 템플릿을 변경할 수 없다", async () => {
  const f = await setup(), template = await addTemplate(f), ctx = await requireContext(req("/context", "GET", f.editor.cookie).headers, "form.write");
  await db.session.delete({ where: { id: ctx.session.id } });
  await expect(updateTemplate(ctx, template.id, { version: 1, title: "삭제된 세션" }, randomUUID())).rejects.toMatchObject({ status: 401 });
  expect((await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).version).toBe(1);
  const ownerCtx = await requireContext(req("/context", "GET", f.owner.cookie).headers, "form.write");
  await db.user.update({ where: { id: f.owner.user.id }, data: { emailVerified: false } });
  await expect(deleteTemplate(ownerCtx, template.id, 1, randomUUID())).rejects.toMatchObject({ status: 401 });
});

test("복제 요청을 재전송할 때도 원본 서비스의 현재 권한을 검사한다", async () => {
  const f = await setup(), form = await addForm(f), key = randomUUID(), path = "/forms/" + form.id + "/copy";
  expect((await formAction(req(path, "POST", f.editor.cookie, {}, { "idempotency-key": key }))).status).toBe(201);
  await db.serviceGrant.deleteMany({ where: { memberId: f.editor.member.id } });
  expect((await formAction(req(path, "POST", f.editor.cookie, {}, { "idempotency-key": key }))).status).toBe(403);
  expect(await db.form.count({ where: { tenantId: f.company.id } })).toBe(2);
});

test("서비스 보관 후 템플릿 삭제를 거부하고 복원 후에는 버전을 검사한다", async () => {
  const f = await setup(), template = await addTemplate(f);
  await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
  expect((await templateDelete(req("/templates/" + template.id, "DELETE", f.owner.cookie, undefined, { "if-match": "1" }))).status).toBe(409);
  expect(await db.formTemplate.count({ where: { id: template.id } })).toBe(1);
  await db.service.update({ where: { id: f.serviceId }, data: { status: "active" } });
  expect((await templatePatch(req("/templates/" + template.id, "PATCH", f.editor.cookie, { version: 1, title: "수정" }))).status).toBe(200);
  expect((await templateDelete(req("/templates/" + template.id, "DELETE", f.editor.cookie, undefined, { "if-match": "1" }))).status).toBe(409);
  expect((await templateDelete(req("/templates/" + template.id, "DELETE", f.editor.cookie, undefined, { "if-match": "2" }))).status).toBe(204);
});

test("실제 변경이 없는 version-only 저장은 거부하고 즐겨찾기는 구성원별로 격리한다", async () => {
  const f = await setup(), form = await addForm(f), template = await addTemplate(f);
  expect((await formPatch(req("/forms/" + form.id, "PATCH", f.editor.cookie, { version: 1 }))).status).toBe(422);
  expect((await templatePatch(req("/templates/" + template.id, "PATCH", f.editor.cookie, { version: 1 }))).status).toBe(422);
  expect((await favorite(req("/forms/" + form.id + "/favorite", "PUT", f.viewer.cookie))).status).toBe(200);
  const own = await (await formList(req("/forms?favorite=true", "GET", f.viewer.cookie))).json(), other = await (await formList(req("/forms?favorite=true", "GET", f.editor.cookie))).json();
  expect(own.total).toBe(1); expect(other.total).toBe(0);
  expect((await formDelete(req("/forms/" + form.id + "/favorite", "DELETE", f.viewer.cookie))).status).toBe(204);
  expect((await (await formList(req("/forms?favorite=true", "GET", f.viewer.cookie))).json()).total).toBe(0);
});
