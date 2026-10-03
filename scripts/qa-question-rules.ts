import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import type { FormContent, FormRecord, TemplateRecord } from "../src/contracts/forms";
import { formatAnswer, type Answers } from "../src/contracts/questions";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert(database.pathname === "/catchsecu_dev" && ["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(origin, "http://localhost:3100");
const people = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const previous = JSON.parse(await readFile(".local/p04-form-crud-fixture.json", "utf8")) as { companyId: string; userId: string; serviceId: string };
const person = people.people[1]; assert.equal(person.id, previous.userId); assert(person.email.startsWith("p03-member-") && person.email.endsWith("@catchsecu.local.test"));
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const sessions: string[] = [], cases: { label: string; status: number }[] = [], key = () => ({ "idempotency-key": randomUUID() });
type Fixture = { companyId: string; userId: string; formId: string; copyId: string; templateFormId: string; submissionId: string; expected: Answers; questionIds: string[] };
async function call<T>(label: string, path: string, method = "GET", cookie = "", value?: unknown, expected = 200, extra: Record<string, string> = {}): Promise<T> {
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie, ...(method !== "GET" ? { origin } : {}),
    ...(value === undefined ? {} : { "content-type": "application/json" }), ...extra }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(response.status, expected, label); cases.push({ label, status: response.status });
  if (path === "/api/v1/auth/sign-in/email") { const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie); sessions.push(cookie); return cookie as T; }
  return (response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text()) as T;
}
function responseAnswers(content: FormContent, onSite: boolean): Answers {
  const q = content.questions;
  return { [q[0].id]: onSite ? "현장" : "온라인", ...(onSite ? { [q[1].id]: "합성 방문 정보" } : {}),
    [q[2].id]: Object.fromEntries(q[2].rows!.map(row => [row.id, "좋음"])), [q[3].id]: { [q[3].rows![0].id]: ["기초", "실습"] },
    [q[4].id]: [onSite ? "기초" : "실습"], ...(onSite ? { [q[5].id]: "합성 입문 확인" } : {}) };
}
async function main() {
  const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert.equal(user.status, "active"); assert.equal(user.platformAdmin, false);
  const cookie = await call<string>("합성 계정 로그인", "/api/v1/auth/sign-in/email", "POST", "", { email: person.email, password: person.password });
  await call("시험 회사 선택", "/api/v1/context", "POST", cookie, { companyId: previous.companyId });
  if (phase === "finish") {
    const f = JSON.parse(await readFile(".local/p04-question-rules-fixture.json", "utf8")) as Fixture; assert.equal(f.userId, person.id); assert.equal(f.companyId, previous.companyId);
    const original = await call<FormRecord>("재시작 후 분기·행렬 정의 조회", "/api/v1/forms/" + f.formId, "GET", cookie);
    assert.deepEqual(original.content.questions.map(q => q.id), f.questionIds); assert.equal(original.content.questions[1].condition!.questionId, f.questionIds[0]);
    const detail = await call<{ values: Answers; version: number }>("재시작 후 정정된 구조화 답변 조회", "/api/v1/submissions/" + f.submissionId, "GET", cookie);
    assert.deepEqual(detail.values, f.expected); assert.equal(detail.version, 3);
    const copied = await call<FormRecord>("재시작 후 분기 복제 폼 조회", "/api/v1/forms/" + f.copyId, "GET", cookie);
    assert.equal(copied.content.questions[1].condition!.questionId, copied.content.questions[0].id);
    assert.notEqual(copied.content.questions[2].rows![0].id, original.content.questions[2].rows![0].id);
    const templateForm = await call<FormRecord>("삭제된 템플릿의 행렬 복제 폼 조회", "/api/v1/forms/" + f.templateFormId, "GET", cookie);
    assert.equal(templateForm.content.questions[5].condition!.questionId, templateForm.content.questions[4].id);
    const formIds = [f.formId, f.copyId, f.templateFormId];
    const questions = await db.question.findMany({ where: { tenantId: f.companyId, formVersion: { formId: { in: formIds } } } });
    const records = await db.answer.findMany({ where: { submission: { formVersion: { formId: { in: formIds } } } } });
    const raw = await db.answer.findMany({ where: { submissionId: f.submissionId }, include: { question: true } });
    for (const answer of raw) assert.deepEqual(decrypt(answer.valueCipher), f.expected[answer.question.stableKey]);
    const proof = { independentQuestionIds: new Set(questions.map(q => q.stableKey)).size,
      forms: await db.form.count({ where: { id: { in: formIds }, tenantId: f.companyId } }),
      submissions: await db.submission.count({ where: { formVersion: { formId: { in: formIds } } } }), answers: records.length,
      correctedValuesMatch: true, hiddenValuesEmpty: detail.values[original.content.questions[1].id] === "" && detail.values[original.content.questions[5].id] === "",
      matrixRowsFormatted: formatAnswer(detail.values[original.content.questions[2].id], original.content.questions[2].rows) === "과정: 보통 / 강사: 좋음" };
    assert.equal(proof.independentQuestionIds, 18); assert.equal(proof.forms, 3); assert.equal(proof.submissions, 3); assert.equal(proof.answers, 18); assert(proof.hiddenValuesEmpty && proof.matrixRowsFormatted);
    await writeFile("docs/qa/P04-T01/questions-http-finish.json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, database: proof }, null, 2) + "\n");
    console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, database: proof })); return;
  }
  const parent = randomUUID(), check = randomUUID();
  const content: FormContent = { body: "조건에 따라 답변을 수집하는 합성 시험", verify: false, font: "16px", bold: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 50,
    questions: [
      { id: parent, type: "객관식 답변", label: "참여 방식", required: true, options: ["현장", "온라인"] },
      { id: randomUUID(), type: "단문형 답변", label: "현장 방문 정보", required: true, condition: { questionId: parent, operator: "equals", value: "현장" } },
      { id: randomUUID(), type: "행렬형 단일 선택", label: "만족도", required: true, options: ["좋음", "보통"], rows: [{ id: randomUUID(), label: "과정" }, { id: randomUUID(), label: "강사" }] },
      { id: randomUUID(), type: "행렬형 복수 선택", label: "다음 과정", required: false, options: ["기초", "심화", "실습"], rows: [{ id: randomUUID(), label: "희망 분야" }], selectionLimits: { min: 1, max: 2 } },
      { id: check, type: "체크박스", label: "수업 분야", required: true, options: ["기초", "심화", "실습"], selectionLimits: { min: 1, max: 2 } },
      { id: randomUUID(), type: "단문형 답변", label: "입문 확인", required: true, condition: { questionId: check, operator: "includes", value: "기초" } },
    ] };
  const form = await call<FormRecord>("분기·행렬 폼 실제 생성", "/api/v1/forms", "POST", cookie, { serviceId: previous.serviceId, title: "분기 행렬 합성 확인", content }, 201, key());
  assert.deepEqual(form.content.questions.map(q => q.rows), content.questions.map(q => q.rows));
  const publication = await call<{ token: string }>("분기·행렬 폼 게시", "/api/v1/forms/" + form.id + "/publish", "POST", cookie, { version: 1 }, 201, key());
  const publicData = await call<{ content: FormContent }>("게시 질문 정의 조회", "/api/v1/public/forms/" + publication.token); assert.deepEqual(publicData.content.questions.map(q => q.condition), content.questions.map(q => q.condition));
  await call("공개 응답 화면 HTTP", "/projects/" + publication.token + "/form");
  const q = content.questions, submitPath = "/api/v1/public/forms/" + publication.token + "/submissions", base = responseAnswers(content, false);
  for (const [label, patch] of [
    ["숨긴 개인정보 주입 차단", { [q[1].id]: "숨긴 응답" }], ["행렬 필수 행 누락 차단", { [q[2].id]: {} }],
    ["단일 행렬 타입 위조 차단", { [q[2].id]: Object.fromEntries(q[2].rows!.map(row => [row.id, ["좋음"]])) }],
    ["행렬 선택 수 초과 차단", { [q[3].id]: { [q[3].rows![0].id]: ["기초", "심화", "실습"] } }],
    ["체크박스 선택 수 초과 차단", { [q[4].id]: ["기초", "심화", "실습"] }], ["분기 필수 누락 차단", { [q[0].id]: "현장" }],
  ] as [string, Answers][]) await call(label, submitPath, "POST", "", { answers: { ...base, ...patch }, consent: true }, 422, key());
  await call("온라인 분기 실제 제출", submitPath, "POST", "", { answers: base, consent: true }, 201, key());
  const onsite = await call<{ id: string }>("현장 분기 실제 제출", submitPath, "POST", "", { answers: responseAnswers(content, true), consent: true }, 201, key());
  await call("조건 변경과 숨겨진 답변 정정", "/api/v1/submissions/" + onsite.id, "PATCH", cookie, { version: 1, reason: "온라인 방식으로 정정", answers: { [parent]: "온라인", [check]: ["실습"] } });
  const detail = await call<{ values: Answers; corrections: { before: Answers; after: Answers }[] }>("정정 결과와 암호화 이력 조회", "/api/v1/submissions/" + onsite.id, "GET", cookie);
  assert.equal(detail.values[q[1].id], ""); assert.equal(detail.values[q[5].id], ""); assert.equal(detail.corrections[0].before[q[1].id], "합성 방문 정보"); assert.equal(detail.corrections[0].after[q[1].id], "");
  await call("재활성화 필수 답변 누락 차단", "/api/v1/submissions/" + onsite.id, "PATCH", cookie, { version: 2, reason: "다시 현장", answers: { [parent]: "현장" } }, 422);
  const matrix = { ...base[q[2].id] as Record<string, string>, [q[2].rows![0].id]: "보통" };
  await call("구조화 행렬 답변 정정", "/api/v1/submissions/" + onsite.id, "PATCH", cookie, { version: 2, reason: "과정 만족도 정정", answers: { [q[2].id]: matrix } });
  const expected = { ...detail.values, [q[2].id]: matrix };
  const copied = await call<FormRecord>("분기·행렬 폼 복제", "/api/v1/forms/" + form.id + "/copy", "POST", cookie, {}, 201, key());
  assert.equal(copied.content.questions[1].condition!.questionId, copied.content.questions[0].id); assert.notEqual(copied.content.questions[2].rows![0].id, q[2].rows![0].id);
  const copiedPub = await call<{ token: string }>("독립 행렬 폼 게시", "/api/v1/forms/" + copied.id + "/publish", "POST", cookie, { version: 1 }, 201, key());
  const copiedAnswers = responseAnswers(copied.content, false);
  await call("복제 폼의 원본 행 ID 차단", "/api/v1/public/forms/" + copiedPub.token + "/submissions", "POST", "", { answers: { ...copiedAnswers, [copied.content.questions[2].id]: base[q[2].id] }, consent: true }, 422, key());
  await call("새 질문·행 ID로 실제 제출", "/api/v1/public/forms/" + copiedPub.token + "/submissions", "POST", "", { answers: copiedAnswers, consent: true }, 201, key());
  const template = await call<TemplateRecord>("분기·행렬 템플릿 등록", "/api/v1/templates", "POST", cookie, { serviceId: previous.serviceId, title: "분기 행렬 템플릿", category: "합성 시험", content }, 201, key());
  const templateForm = await call<FormRecord>("템플릿 분기·행렬 독립 복제", "/api/v1/templates/" + template.id + "/use", "POST", cookie, { version: 1, serviceId: previous.serviceId }, 201, key());
  assert.equal(templateForm.content.questions[5].condition!.questionId, templateForm.content.questions[4].id);
  await call("템플릿 삭제 후 폼 보존", "/api/v1/templates/" + template.id, "DELETE", cookie, undefined, 204, { "if-match": "1" });
  const fixture: Fixture = { companyId: previous.companyId, userId: person.id, formId: form.id, copyId: copied.id, templateFormId: templateForm.id, submissionId: onsite.id, expected, questionIds: q.map(q => q.id) };
  await writeFile(".local/p04-question-rules-fixture.json", JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  await writeFile("docs/qa/P04-T01/questions-http-prepare.json", JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length }));
}
try { await main(); } finally {
  for (const cookie of sessions) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" });
  await db.$disconnect();
}
