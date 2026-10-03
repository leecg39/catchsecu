import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import type { FormContent, FormRecord, TemplateRecord } from "../src/contracts/forms";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3100");
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const person = source.people[1];
assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const sessions: string[] = [], cases: { label: string; status: number }[] = [];
type Profile = { version: number; name: string; jobTitle: string | null };
type Fixture = { userId: string; companyId: string; serviceId: string; formId: string; copiedId: string; templateFormId: string; submissionId: string; jobTitle: string; copyQuestionIds: string[] };
async function call<T>(label: string, path: string, method = "GET", cookie = "", value?: unknown, expected = 200, extra: Record<string, string> = {}): Promise<T> {
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie, ...(method !== "GET" ? { origin } : {}),
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(response.status, expected, label); cases.push({ label, status: response.status });
  if (path === "/api/v1/auth/sign-in/email" && expected === 200) {
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert(cookie); sessions.push(cookie); return cookie as T;
  }
  return (response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text()) as T;
}
const key = () => ({ "idempotency-key": randomUUID() });
async function main() {
  const user = await db.user.findUniqueOrThrow({ where: { id: person.id } });
  assert.equal(user.status, "active"); assert.equal(user.emailVerified, true); assert.equal(user.platformAdmin, false);
  const cookie = await call<string>("합성 계정 로그인", "/api/v1/auth/sign-in/email", "POST", "", { email: person.email, password: person.password });
  if (phase === "finish") {
    const fixture = JSON.parse(await readFile(".local/p04-form-crud-fixture.json", "utf8")) as Fixture;
    assert.equal(fixture.userId, person.id);
    await call("시험 회사 다시 선택", "/api/v1/context", "POST", cookie, { companyId: fixture.companyId });
    const profile = await call<Profile>("재시작 후 직책 조회", "/api/v1/me", "GET", cookie);
    assert.equal(profile.jobTitle, fixture.jobTitle);
    const copied = await call<FormRecord>("재시작 후 독립 폼 조회", "/api/v1/forms/" + fixture.copiedId, "GET", cookie);
    assert.equal(copied.status, "published"); assert.equal(copied.content.body, "생성 시 본문");
    assert.deepEqual(copied.content.questions.map(question => question.id), fixture.copyQuestionIds);
    assert.equal((await call<FormRecord>("보관 원본 재조회", "/api/v1/forms/" + fixture.formId, "GET", cookie)).status, "archived");
    assert.equal((await call<FormRecord>("삭제 템플릿에서 만든 폼 재조회", "/api/v1/forms/" + fixture.templateFormId, "GET", cookie)).status, "draft");
    const proof = { userJobTitleMatches: (await db.user.findUniqueOrThrow({ where: { id: person.id } })).jobTitle === fixture.jobTitle,
      companyStatus: (await db.company.findUniqueOrThrow({ where: { id: fixture.companyId } })).status,
      forms: await db.form.count({ where: { tenantId: fixture.companyId } }), templates: await db.formTemplate.count({ where: { tenantId: fixture.companyId } }),
      submissions: await db.submission.count({ where: { tenantId: fixture.companyId } }),
      retainedAnswers: await db.answer.count({ where: { submissionId: fixture.submissionId } }),
      independentQuestionIds: new Set((await db.question.findMany({ where: { tenantId: fixture.companyId } })).map(question => question.stableKey)).size };
    assert.equal(proof.forms, 3); assert.equal(proof.templates, 0); assert.equal(proof.submissions, 1); assert.equal(proof.retainedAnswers, 6);
    assert.equal(proof.independentQuestionIds, 18); assert.equal(proof.companyStatus, "active"); assert(proof.userJobTitleMatches);
    await writeFile("docs/qa/P04-T01/http-finish.json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, database: proof }, null, 2) + "\n");
    console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, database: proof })); return;
  }
  const company = await call<{ id: string }>("폼 시험 회사 생성", "/api/v1/companies", "POST", cookie,
    { name: "폼 CRUD 확인 " + randomUUID().slice(0, 8), publicName: "합성 폼 시험" }, 201);
  const context = await call<{ company: { id: string }; services: { id: string }[] }>("신규 회사의 실제 컨텍스트", "/api/v1/context", "GET", cookie);
  assert.equal(context.company.id, company.id); const serviceId = context.services[0].id;
  const profile = await call<Profile>("직책 변경 전 프로필 조회", "/api/v1/me", "GET", cookie), jobTitle = "폼 운영 담당 " + randomUUID().slice(0, 8);
  const saved = await call<Profile>("직책 서버 저장", "/api/v1/me", "PATCH", cookie, { version: profile.version, name: profile.name, jobTitle });
  assert.equal(saved.jobTitle, jobTitle); assert.equal((await db.user.findUniqueOrThrow({ where: { id: person.id } })).jobTitle, jobTitle);
  await call("직책 길이 제한", "/api/v1/me", "PATCH", cookie, { version: saved.version, name: saved.name, jobTitle: "직".repeat(101) }, 422);
  for (const path of ["/my-page/info", "/my-page/info/edit", "/form/manage", "/form/template", "/form/ai/basic-frame"])
    await call("구현 화면 HTTP", path, "GET", cookie);
  const content: FormContent = { body: "생성 시 본문", verify: false, font: "16px", bold: false, consentRequired: false, consentPurpose: "",
    retentionDays: 30, maxResponses: 50, showSubmitNotice: true, questions: [
      { id: randomUUID(), label: "이름", type: "단문형 답변", required: true },
      { id: randomUUID(), label: "참여 방식", type: "객관식 답변", required: true, options: ["온라인", "현장"] },
      { id: randomUUID(), label: "관심 분야", type: "체크박스", required: false, options: ["입문", "심화"] },
      { id: randomUUID(), label: "희망 시간", type: "드롭다운", required: false, options: ["오전", "오후"] },
      { id: randomUUID(), label: "희망 날짜", type: "날짜", required: true },
      { id: randomUUID(), label: "상세 요청", type: "장문형 답변", required: false },
    ] };
  const createKey = key(), input = { serviceId, title: "독립 복제 원본", content };
  const form = await call<FormRecord>("폼 생성", "/api/v1/forms", "POST", cookie, input, 201, createKey);
  assert.equal((await call<FormRecord>("폼 생성 재전송", "/api/v1/forms", "POST", cookie, input, 201, createKey)).id, form.id);
  await call("내용 없는 폼 저장 차단", "/api/v1/forms/" + form.id, "PATCH", cookie, { version: 1 }, 422);
  const copyKey = key(), path = "/api/v1/forms/" + form.id + "/copy";
  const copied = await call<FormRecord>("폼 독립 복제", path, "POST", cookie, {}, 201, copyKey);
  assert.equal((await call<FormRecord>("폼 복제 재전송", path, "POST", cookie, {}, 201, copyKey)).id, copied.id);
  const sourceIds = new Set(form.content.questions.map(question => question.id));
  assert(copied.content.questions.every(question => !sourceIds.has(question.id)));
  await call("원본 초안 수정", "/api/v1/forms/" + form.id, "PATCH", cookie, { version: 1, content: { ...content, body: "원본만 수정" } });
  await call("오래된 원본 버전 차단", "/api/v1/forms/" + form.id, "PATCH", cookie, { version: 1, title: "충돌" }, 409);
  assert.equal((await call<FormRecord>("복제 본문 독립 확인", "/api/v1/forms/" + copied.id, "GET", cookie)).content.body, content.body);
  const publication = await call<{ token: string }>("복제 폼 게시", "/api/v1/forms/" + copied.id + "/publish", "POST", cookie, { version: 1 }, 201, key());
  await call("공개 폼 조회", "/api/v1/public/forms/" + publication.token);
  await call("공개 중지", "/api/v1/forms/" + copied.id + "/pause", "POST", cookie, { version: 2 });
  await call("중지 공개 접근 차단", "/api/v1/public/forms/" + publication.token, "GET", "", undefined, 410);
  await call("공개 재개", "/api/v1/forms/" + copied.id + "/resume", "POST", cookie, { version: 3 });
  const values: Record<string, string | string[]> = { 이름: "합성 응답", "참여 방식": "온라인", "관심 분야": ["입문", "심화"], "희망 시간": "오후", "희망 날짜": "2026-10-03", "상세 요청": "합성 시험 내용" };
  const answers = Object.fromEntries(copied.content.questions.map(question => [question.id, values[question.label]]));
  const submitPath = "/api/v1/public/forms/" + publication.token + "/submissions";
  await call("원본 질문 ID 사용 차단", submitPath, "POST", "", { answers: Object.fromEntries(content.questions.map(question => [question.id, values[question.label]])), consent: true }, 422, key());
  await call("필수 답변 누락 차단", submitPath, "POST", "", { answers: {}, consent: true }, 422, key());
  await call("위조 선택지 차단", submitPath, "POST", "", { answers: { ...answers, [copied.content.questions[1].id]: "없는 선택지" }, consent: true }, 422, key());
  const submission = await call<{ id: string }>("새 질문 ID로 실제 응답 저장", submitPath, "POST", "", { answers, consent: true }, 201, key());
  const storedAnswers = await db.answer.findMany({ where: { submissionId: submission.id }, include: { question: true } });
  assert.equal(storedAnswers.length, 6);
  for (const answer of storedAnswers) assert.deepEqual(decrypt(answer.valueCipher), answers[answer.question.stableKey]);
  await call("즐겨찾기 등록", "/api/v1/forms/" + copied.id + "/favorite", "PUT", cookie);
  const favorites = await call<{ items: { id: string }[]; total: number }>("서버 즐겨찾기 필터", "/api/v1/forms?favorite=true&sort=name&direction=asc", "GET", cookie);
  assert.equal(favorites.total, 1); assert.equal(favorites.items[0].id, copied.id);
  const sorted = await call<{ items: { title: string }[]; total: number }>("서버 검색·정렬", "/api/v1/forms?search=독립&sort=name&direction=asc", "GET", cookie);
  assert.equal(sorted.total, 2); assert.deepEqual(sorted.items.map(form => form.title), [...sorted.items.map(form => form.title)].sort());
  const template = await call<TemplateRecord>("템플릿 생성", "/api/v1/templates", "POST", cookie, { serviceId, title: "서비스 템플릿", category: "합성 신청", content }, 201, key());
  await call("내용 없는 템플릿 저장 차단", "/api/v1/templates/" + template.id, "PATCH", cookie, { version: 1 }, 422);
  await call("템플릿 수정", "/api/v1/templates/" + template.id, "PATCH", cookie, { version: 1, title: "수정 템플릿" });
  const used = await call<FormRecord>("템플릿을 새 폼으로 복제", "/api/v1/templates/" + template.id + "/use", "POST", cookie, { version: 2, serviceId }, 201, key());
  assert(used.content.questions.every(question => !sourceIds.has(question.id) && !copied.content.questions.some(original => original.id === question.id)));
  await call("오래된 템플릿 삭제 차단", "/api/v1/templates/" + template.id, "DELETE", cookie, undefined, 409, { "if-match": "1" });
  await call("템플릿 실제 삭제", "/api/v1/templates/" + template.id, "DELETE", cookie, undefined, 204, { "if-match": "2" });
  await call("삭제 템플릿 조회 차단", "/api/v1/templates/" + template.id, "GET", cookie, undefined, 404);
  assert.equal((await call<FormRecord>("템플릿 삭제 후 복제 폼 유지", "/api/v1/forms/" + used.id, "GET", cookie)).content.body, content.body);
  await call("원본 폼 보관", "/api/v1/forms/" + form.id, "DELETE", cookie, undefined, 204, { "if-match": "2" });
  await call("보관 원본 편집 차단", "/api/v1/forms/" + form.id, "PATCH", cookie, { version: 3, title: "금지" }, 409);
  const fixture: Fixture = { userId: person.id, companyId: company.id, serviceId, formId: form.id, copiedId: copied.id, templateFormId: used.id,
    submissionId: submission.id, jobTitle, copyQuestionIds: copied.content.questions.map(question => question.id) };
  await writeFile(".local/p04-form-crud-fixture.json", JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  await writeFile("docs/qa/P04-T01/http-prepare.json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases,
    database: { forms: 3, templates: 0, submissions: 1, answers: storedAnswers.length, independentCopies: true, encryptedAnswersMatch: true, jobTitleMatches: true } }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length }));
}
try { await main(); }
finally {
  for (const cookie of sessions) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" });
  await db.$disconnect();
}
