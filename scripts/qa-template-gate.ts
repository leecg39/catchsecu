import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { fingerprint, versionInclude } from "../src/server/forms";
import { formContentSchema } from "../src/contracts/domains";
import { questionTypes } from "../src/contracts/questions";
import type { FormRecord, Paged, TemplatePage, TemplateRecord } from "../src/contracts/forms";
import type { MemberRecord } from "../src/contracts/members";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const people = [source.people[2], source.people[1]], cookies = ["", ""], cases: { label: string; status: number }[] = [];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function request(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200, headers: Record<string, string> = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie: cookies[actor] ?? "", ...(method === "GET" ? {} : { origin }),
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert.equal(response.status, expected, label + ": HTTP " + response.status); cases.push({ label, status: response.status }); return response;
}
async function data<T>(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200, headers: Record<string, string> = {}) {
  return await (await request(label, path, actor, method, input, expected, headers)).json() as T;
}
async function snapshot(tenantId: string) {
  const forms = await db.form.findMany({ where: { tenantId }, select: { id: true, version: true, status: true, publishedVersionId: true }, orderBy: { id: "asc" } });
  const versions = await db.formVersion.findMany({ where: { tenantId }, include: versionInclude, orderBy: { id: "asc" } });
  const templates = await db.formTemplate.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  const publications = await db.publication.findMany({ where: { tenantId }, select: { id: true, formId: true, formVersionId: true, status: true, responseCount: true }, orderBy: { id: "asc" } });
  const submissions = await db.submission.findMany({ where: { tenantId }, select: { id: true, formVersionId: true, answers: { select: { id: true, valueCipher: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
  const members = await db.membership.findMany({ where: { tenantId }, select: { id: true, role: true, version: true, grants: { select: { serviceId: true, capabilities: true }, orderBy: { serviceId: "asc" } } }, orderBy: { id: "asc" } });
  const caches = await db.idempotencyRecord.findMany({ where: { tenantId }, select: { id: true, resourceType: true, resourceId: true, invalidatedAt: true, responseCipher: true, requestHash: true }, orderBy: { id: "asc" } });
  const auditCount = await db.auditEvent.count({ where: { tenantId } });
  return { forms, versions: versions.map(row => ({ id: row.id, formId: row.formId, hash: fingerprint(row), questionIds: row.questions.map(q => q.stableKey) })), templates: templates.map(row => ({ id: row.id, version: row.version, serviceId: row.serviceId, contentHash: hash(row.content) })), publications,
    submissions: submissions.map(row => ({ ...row, answers: row.answers.map(answer => ({ id: answer.id, cipherHash: hash(answer.valueCipher) })) })), members,
    caches: caches.map(row => ({ id: row.id, resourceType: row.resourceType, resourceId: row.resourceId, invalidatedAt: row.invalidatedAt, hasContent: !!row.responseCipher, hasRequestHash: !!row.requestHash })), auditCount };
}
type Checkpoint = { tenantId: string; serviceIds: string[]; formId: string; removedTemplateId: string; remainingTemplateId: string; memberId: string; token: string; useInput: object; useKey: string; createInput: object; createKey: string; databaseHash: string; database: Awaited<ReturnType<typeof snapshot>> };
async function verify(c: Checkpoint) {
  const page = await data<TemplatePage>("소유자 템플릿 목록의 마지막 페이지 보정", "/templates?scope=company&page=999&pageSize=1"); assert.equal(page.page, 1); assert.equal(page.total, 1); assert(page.permissions.canCreate && page.items[0].actions?.edit);
  const viewer = await data<TemplatePage>("조회자 선택 서비스의 생성·사용 권한", "/templates?scope=company&serviceId=" + c.serviceIds[0], 1); assert.equal(viewer.total, 0); assert.deepEqual(viewer.permissions, { canCreate: false, targets: [] });
  await request("회수된 템플릿 생성 권한 차단", "/templates", 1, "POST", {}, 403);
  await request("조회자 배정 외 서비스 양식 차단", "/templates/" + c.remainingTemplateId, 1, "GET", undefined, 403);
  await request("삭제한 양식 재전송 차단", "/templates/" + c.removedTemplateId + "/use", 0, "POST", c.useInput, 404, { "idempotency-key": c.useKey });
  await request("삭제한 양식 생성 키는 410", "/templates", 0, "POST", c.createInput, 410, { "idempotency-key": c.createKey });
  const form = await data<FormRecord>("독립 폼은 템플릿 삭제 후 보존", "/forms/" + c.formId); assert.equal(form.content.questions.length, 9); assert.equal(form.status, "archived"); assert(form.actions?.responses && form.actions.copy);
  const formViewer = await data<FormRecord>("조회자 보관 폼의 현재 작업 권한", "/forms/" + c.formId, 1); assert(!formViewer.actions?.edit && !formViewer.actions?.copy && !formViewer.actions?.responses);
  await request("보관한 공개 링크 종료", "/public/forms/" + c.token, 2, "GET", undefined, 410);
  await request("알 수 없는 목록 입력 차단", "/templates?unknown=true", 0, "GET", undefined, 422);
  const actual = await snapshot(c.tenantId); assert.equal(hash(actual), c.databaseHash); assert.equal(actual.submissions.length, 1);
  assert(actual.caches.filter(row => row.resourceId === c.removedTemplateId).every(row => row.invalidatedAt && !row.hasContent && !row.hasRequestHash)); return actual;
}
try {
  for (let actor = 0; actor < 2; actor++) {
    const person = people[actor]; assert(/^p03-(foreign|member)-.+@catchsecu\.local\.test$/.test(person.email));
    const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(user.status === "active" && user.emailVerified && !user.platformAdmin);
    const response = await request("합성 계정 로그인 " + actor, "/auth/sign-in/email", actor, "POST", { email: person.email, password: person.password });
    cookies[actor] = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookies[actor]);
  }
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    const company = await data<{ id: string }>("독립 템플릿 시험 회사 생성", "/companies", 0, "POST", { name: "P04 모듈 검증 " + randomUUID(), publicName: "P04 모듈 검증" }, 201);
    const services = await data<Paged<{ id: string }>>("기본 시험 서비스", "/services"); assert.equal(services.total, 1);
    const second = await data<{ id: string }>("두 번째 서비스 생성", "/services", 0, "POST", { name: "다른 시험 서비스", externalName: "다른" }, 201), serviceIds = [services.items[0].id, second.id];
    const invitation = await data<{ id: string }>("첫 서비스 편집자 초대", "/invitations", 0, "POST", { email: people[1].email, role: "editor", serviceIds: [serviceIds[0]] }, 201);
    const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:invitation:" + invitation.id + ":1" } }); assert.equal(job.tenantId, company.id);
    const payload = decrypt<{ to: string; text: string }>(job.payloadCipher); assert.equal(payload.to, people[1].email);
    const link = payload.text.split("\n").find(line => line.startsWith(origin + "/oauth2/invite/signup?")); assert(link); const token = new URL(link).searchParams.get("token"); assert(token);
    const accepted = await data<{ memberId: string }>("합성 초대 수락", "/invitations/accept", 1, "POST", { token });
    let member = await data<MemberRecord>("편집자 구성원 버전", "/members/" + accepted.memberId);
    const content = formContentSchema.parse({ body: "템플릿 원본 본문", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 5, questions: questionTypes.map(type => ({ id: randomUUID(), type, label: type, required: type !== "파일 업로드",
      ...(["객관식 답변", "체크박스", "드롭다운", "행렬형 단일 선택", "행렬형 복수 선택"].includes(type) ? { options: ["첫째", "둘째"] } : {}), ...(type.startsWith("행렬형") ? { rows: [{ id: randomUUID(), label: "행 A" }] } : {}) })) });
    content.questions[4].condition = { questionId: content.questions[2].id, operator: "equals", value: "첫째" };
    const createInput = { serviceId: serviceIds[0], title: "A 양식", category: "QA", content }, createKey = randomUUID();
    const first = await data<TemplateRecord>("첫 서비스 아홉 유형 템플릿 생성", "/templates", 0, "POST", createInput, 201, { "idempotency-key": createKey });
    const other = await data<TemplateRecord>("다른 서비스 템플릿 생성", "/templates", 0, "POST", { serviceId: serviceIds[1], title: "B 양식", category: "QA", content }, 201);
    const page = await data<TemplatePage>("회사 템플릿 두 번째 페이지", "/templates?scope=company&page=999&pageSize=1&sort=name&direction=asc"); assert.equal(page.page, 2); assert.equal(page.items[0].id, other.id);
    const editor = await data<TemplatePage>("할당 서비스와 현재 생성 대상", "/templates?scope=company", 1); assert.equal(editor.total, 1); assert.deepEqual(editor.permissions.targets.map(row => row.id), [serviceIds[0]]); assert(editor.items[0].actions?.edit);
    await request("다른 서비스 선택 목록 차단", "/templates?serviceId=" + serviceIds[1], 1, "GET", undefined, 403);
    const useInput = { version: first.version, serviceId: serviceIds[0] }, useKey = randomUUID();
    const form = await data<FormRecord>("양식으로 독립 폼 생성", "/templates/" + first.id + "/use", 1, "POST", useInput, 201, { "idempotency-key": useKey });
    assert.equal(form.content.questions.length, 9); assert.notEqual(form.content.questions[0].id, content.questions[0].id); assert.equal(form.content.questions[4].condition?.questionId, form.content.questions[2].id); assert(!form.actions);
    const duplicate = await data<FormRecord>("같은 양식 키 재전송", "/templates/" + first.id + "/use", 1, "POST", useInput, 201, { "idempotency-key": useKey }); assert.equal(duplicate.id, form.id);
    const edited = await data<TemplateRecord>("양식 제목 수정", "/templates/" + first.id, 1, "PATCH", { version: first.version, title: "A 수정 양식", content: { ...content, body: "원본만 바뀐 본문" } });
    await request("오래된 양식 버전 수정 차단", "/templates/" + first.id, 1, "PATCH", { version: first.version, title: "차단" }, 409);
    const independent = await data<FormRecord>("양식 수정과 독립인 폼 본문", "/forms/" + form.id, 1); assert.equal(independent.content.body, content.body);
    member = await data<MemberRecord>("편집자 권한 회수", "/members/" + member.id, 0, "PATCH", { version: member.version, role: "viewer", serviceIds: [serviceIds[0]] });
    const viewer = await data<TemplatePage>("같은 세션 조회자 작업 권한", "/templates?scope=company", 1); assert(!viewer.permissions.canCreate && viewer.permissions.targets.length === 0); assert(!viewer.items[0].actions?.edit && !viewer.items[0].actions?.use);
    await request("조회자 양식 수정 차단", "/templates/" + first.id, 1, "PATCH", { version: edited.version, title: "차단" }, 403);
    member = await data<MemberRecord>("편집자 권한 복구", "/members/" + member.id, 0, "PATCH", { version: member.version, role: "editor", serviceIds: [serviceIds[0]] });
    const saved = await data<FormRecord>("독립 폼 같은 ID 초안 저장", "/forms/" + form.id + "/draft", 1, "PATCH", { version: form.version, content: { ...form.content, body: "서버 저장 본문" } }, 200, { "idempotency-key": randomUUID() }); assert.equal(saved.id, form.id);
    const publication = await data<{ token: string; version: number }>("독립 아홉 유형 폼 게시", "/forms/" + form.id + "/publish", 1, "POST", { version: saved.version }, 201);
    const q = saved.content.questions, answers = { [q[0].id]: "합성 이름", [q[1].id]: "장문 답변", [q[2].id]: "첫째", [q[3].id]: ["첫째"], [q[4].id]: "둘째", [q[5].id]: "2026-10-03", [q[7].id]: Object.fromEntries(q[7].rows!.map(row => [row.id, "첫째"])), [q[8].id]: Object.fromEntries(q[8].rows!.map(row => [row.id, ["둘째"]])) };
    await request("파일 선택인 실제 공개 응답", "/public/forms/" + publication.token + "/submissions", 2, "POST", { answers, consent: false }, 201);
    await request("참조 양식 삭제", "/templates/" + first.id, 1, "DELETE", undefined, 204, { "if-match": String(edited.version) });
    await request("독립 게시 폼 보관", "/forms/" + form.id, 1, "DELETE", undefined, 204, { "if-match": String(publication.version) });
    member = await data<MemberRecord>("최종 조회자 권한", "/members/" + member.id, 0, "PATCH", { version: member.version, role: "viewer", serviceIds: [serviceIds[0]] });
    const independentDatabase = await snapshot(company.id);
    checkpoint = { tenantId: company.id, serviceIds, formId: form.id, removedTemplateId: first.id, remainingTemplateId: other.id, memberId: member.id, token: publication.token, useInput, useKey, createInput, createKey, databaseHash: hash(independentDatabase), database: independentDatabase };
    await writeFile(".local/p04-template-gate-checkpoint.json", JSON.stringify(checkpoint, null, 2) + "\n", { mode: 0o600 });
  } else {
    checkpoint = JSON.parse(await readFile(".local/p04-template-gate-checkpoint.json", "utf8")); assert((await db.company.findUniqueOrThrow({ where: { id: checkpoint.tenantId } })).name.startsWith("P04 모듈 검증 "));
    for (let actor = 0; actor < 2; actor++) await request("재시작 후 시험 회사 선택 " + actor, "/context", actor, "POST", { companyId: checkpoint.tenantId });
  }
  const independentDatabase = await verify(checkpoint);
  for (let actor = 0; actor < 2; actor++) { await request("합성 세션 종료 " + actor, "/auth/sign-out", actor, "POST", {}); cookies[actor] = ""; }
  await writeFile(`docs/qa/P04-T05/templates/http-${phase}.json`, JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, independentDatabase, matchesBeforeRestart: phase === "finish", actualUiVerified: false, syntheticSessionsClosed: true, userAdminAccountUntouched: true, externalDeliveryVerified: false, publicFileUploadExercised: false }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, templates: independentDatabase.templates.length, forms: independentDatabase.forms.length, submissions: independentDatabase.submissions.length }));
} finally {
  for (const cookie of cookies.filter(Boolean)) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await db.$disconnect();
}
