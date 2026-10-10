import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { GET as getForm, POST as formAction, PATCH as patchForm } from "@/app/api/v1/forms/[...segments]/route";
import { GET as publicForm, POST as submit } from "@/app/api/v1/public/forms/[...segments]/route";
import { GET as getSubmission, PATCH as correct } from "@/app/api/v1/submissions/[...segments]/route";
import { POST as createTemplate } from "@/app/api/v1/templates/route";
import { POST as useTemplate } from "@/app/api/v1/templates/[...segments]/route";
import { POST as createShare } from "@/app/api/v1/share-grants/route";
import { GET as viewerGet, POST as viewerPost } from "@/app/api/v1/viewer/[...segments]/route";
import { PUT as uploadBytes, POST as uploadAction } from "@/app/api/v1/uploads/[...segments]/route";
import { decrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Only isolated test DB fixtures are allowed.");
function req(path: string, method = "GET", cookie = "", value?: unknown, keyed = false) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(keyed ? { "idempotency-key": randomUUID() } : {}),
    ...(value === undefined ? {} : { "content-type": "application/json" }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function content() {
  const parent = randomUUID(), nested = randomUUID(), single = randomUUID(), multi = randomUUID(), rowA = randomUUID(), rowB = randomUUID();
  return { body: "분기와 행렬 시험", verify: false, font: "16px", bold: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 50,
    questions: [
      { id: parent, type: "객관식 답변", label: "참여 방식", required: true, options: ["현장", "온라인"] },
      { id: nested, type: "단문형 답변", label: "현장 방문 정보", required: true, condition: { questionId: parent, operator: "equals", value: "현장" } },
      { id: single, type: "행렬형 단일 선택", label: "만족도", required: true, options: ["좋음", "보통"], rows: [{ id: rowA, label: "과정" }, { id: rowB, label: "강사" }] },
      { id: multi, type: "행렬형 복수 선택", label: "관심 분야", required: false, options: ["기초", "심화", "실습"], rows: [{ id: randomUUID(), label: "다음 과정" }], selectionLimits: { min: 1, max: 2 } },
    ] };
}
async function fixture() {
  const email = "questions-" + randomUUID() + "@catchsecu.test", password = "Question-rules!123";
  expect((await auth.handler(req("/auth/sign-up/email", "POST", "", { name: "문항 시험", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const company = await db.company.create({ data: { name: "문항 시험 회사", publicName: "문항 시험", policy: { create: {} },
    memberships: { create: { userId: user.id, role: "owner" } }, services: { create: { name: "문항 서비스", externalName: "문항 서비스" } } }, include: { services: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "POST", "", { email, password })); expect(login.status).toBe(200);
  return { company, serviceId: company.services[0].id, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "), content: content() };
}
async function add(f: Awaited<ReturnType<typeof fixture>>, value: unknown = f.content) {
  const response = await createForm(req("/forms", "POST", f.cookie, { serviceId: f.serviceId, title: "분기 행렬 폼", content: value }, true));
  expect(response.status).toBe(201); return response.json();
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const response = await formAction(req("/forms/" + id + "/publish", "POST", f.cookie, { version: 1 }, true));
  expect(response.status).toBe(201); return (await response.json()).token;
}
function answers(f: Awaited<ReturnType<typeof fixture>>, branch = "온라인") {
  const q = f.content.questions;
  return { [q[0].id]: branch, ...(branch === "현장" ? { [q[1].id]: "방문 안내" } : {}),
    [q[2].id]: Object.fromEntries(q[2].rows!.map(row => [row.id, "좋음"])) };
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

test("분기·행렬·선택 수 설정을 저장하고 공개 게시본에서 그대로 조회한다", async () => {
  const f = await fixture(), form = await add(f), token = await publish(f, form.id);
  const result = await (await publicForm(req("/public/forms/" + token))).json();
  expect(result.content.questions).toMatchObject(f.content.questions);
  const stored = await db.question.findMany({ where: { tenantId: f.company.id }, orderBy: { order: "asc" } });
  expect(stored[1].condition).toMatchObject(f.content.questions[1].condition!);
  expect(stored[1].condition).toHaveProperty("optionId", result.content.questions[0].optionDefinitions[0].id);
  expect(stored[2]).toHaveProperty("matrixRows", f.content.questions[2].rows);
});

test("분기 참조·선택지·행렬 행·선택 수의 잘못된 정의는 저장하지 않는다", async () => {
  const f = await fixture(), q = f.content.questions;
  const invalid = [
    { ...f.content, questions: [q[1], q[0], q[2]] },
    { ...f.content, questions: [{ ...q[0], condition: { questionId: q[0].id, operator: "equals", value: "현장" } }, q[2]] },
    { ...f.content, questions: [q[0], { ...q[1], condition: { ...q[1].condition, value: "없는 값" } }, q[2]] },
    { ...f.content, questions: [q[0], { ...q[1], subjectRole: "name" }, q[2]] },
    { ...f.content, questions: [{ ...q[2], rows: [q[2].rows![0], q[2].rows![0]] }] },
    { ...f.content, questions: [{ ...q[3], selectionLimits: { min: 3, max: 2 } }] },
  ];
  for (const value of invalid) expect((await createForm(req("/forms", "POST", f.cookie, { serviceId: f.serviceId, title: "오류 폼", content: value }, true))).status).toBe(422);
  expect(await db.form.count({ where: { tenantId: f.company.id } })).toBe(0);
});

test("숨긴 필수 질문은 생략할 수 있고 활성 분기의 누락·숨긴 답변 주입은 거부한다", async () => {
  const f = await fixture(), form = await add(f), token = await publish(f, form.id), path = "/public/forms/" + token + "/submissions";
  expect((await submit(req(path, "POST", "", { answers: { ...answers(f, "현장"), [f.content.questions[1].id]: "" }, consent: true }, true))).status).toBe(422);
  expect((await submit(req(path, "POST", "", { answers: { ...answers(f), [f.content.questions[1].id]: "숨긴 개인정보" }, consent: true }, true))).status).toBe(422);
  const response = await submit(req(path, "POST", "", { answers: answers(f), consent: true }, true)); expect(response.status).toBe(201);
  const detail = await (await getSubmission(req("/submissions/" + (await response.json()).id, "GET", f.cookie))).json();
  expect(detail.values[f.content.questions[1].id]).toBe("");
  expect(detail.values[f.content.questions[2].id]).toEqual(answers(f)[f.content.questions[2].id]);
});

test("행렬 답변은 행 ID·각 행 필수·선택지·단일/복수 타입·선택 수를 검사한다", async () => {
  const f = await fixture(), form = await add(f), token = await publish(f, form.id), path = "/public/forms/" + token + "/submissions", q = f.content.questions;
  for (const matrix of [{}, { [q[2].rows![0].id]: "좋음" }, { ...answers(f)[q[2].id] as object, [randomUUID()]: "좋음" },
    Object.fromEntries(q[2].rows!.map(row => [row.id, ["좋음"]])), Object.fromEntries(q[2].rows!.map(row => [row.id, "위조"]))])
    expect((await submit(req(path, "POST", "", { answers: { ...answers(f), [q[2].id]: matrix }, consent: true }, true))).status).toBe(422);
  for (const selected of [["기초", "심화", "실습"], ["기초", "기초"], "기초"])
    expect((await submit(req(path, "POST", "", { answers: { ...answers(f), [q[3].id]: { [q[3].rows![0].id]: selected } }, consent: true }, true))).status).toBe(422);
  expect((await submit(req(path, "POST", "", { answers: { ...answers(f), [q[3].id]: { [q[3].rows![0].id]: ["기초", "실습"] } }, consent: true }, true))).status).toBe(201);
});

test("폼·템플릿 복제는 조건 참조와 행 ID도 새 질문에 연결한다", async () => {
  const f = await fixture(), form = await add(f), copied = await formAction(req("/forms/" + form.id + "/copy", "POST", f.cookie, {}, true)); expect(copied.status).toBe(201);
  const value = await copied.json(); expect(value.content.questions[1].condition.questionId).toBe(value.content.questions[0].id);
  expect(value.content.questions[2].rows[0].id).not.toBe(f.content.questions[2].rows![0].id);
  const template = await createTemplate(req("/templates", "POST", f.cookie, { serviceId: f.serviceId, title: "분기 템플릿", category: "시험", content: f.content }, true)); expect(template.status).toBe(201);
  const used = await useTemplate(req("/templates/" + (await template.json()).id + "/use", "POST", f.cookie, { version: 1, serviceId: f.serviceId }, true)); expect(used.status).toBe(201);
  const second = await used.json(); expect(second.content.questions[1].condition.questionId).toBe(second.content.questions[0].id);
  expect(second.content.questions[2].rows[0].id).not.toBe(value.content.questions[2].rows[0].id);
});

test("분기 정정은 새 필수 답변을 검사하고 숨겨지는 현재 값을 비우며 암호화 이력을 남긴다", async () => {
  const f = await fixture(), form = await add(f), token = await publish(f, form.id);
  const initial = await submit(req("/public/forms/" + token + "/submissions", "POST", "", { answers: answers(f, "현장"), consent: true }, true)); expect(initial.status).toBe(201);
  const id = (await initial.json()).id, path = "/submissions/" + id, q = f.content.questions;
  expect((await correct(req(path, "PATCH", f.cookie, { version: 1, reason: "방식 정정", answers: { [q[0].id]: "온라인" } }))).status).toBe(200);
  let detail = await (await getSubmission(req(path, "GET", f.cookie))).json();
  expect(detail.values[q[1].id]).toBe(""); expect(detail.corrections[0].before[q[1].id]).toBe("방문 안내"); expect(detail.corrections[0].after[q[1].id]).toBe("");
  expect((await correct(req(path, "PATCH", f.cookie, { version: 2, reason: "다시 현장", answers: { [q[0].id]: "현장" } }))).status).toBe(422);
  expect((await correct(req(path, "PATCH", f.cookie, { version: 2, reason: "다시 현장", answers: { [q[0].id]: "현장", [q[1].id]: "새 방문 안내" } }))).status).toBe(200);
  detail = await (await getSubmission(req(path, "GET", f.cookie))).json(); expect(detail.values[q[1].id]).toBe("새 방문 안내");
  expect((await patchForm(req("/forms/" + form.id, "PATCH", f.cookie, { version: 2, content: { ...f.content, body: "새 초안" } }))).status).toBe(200);
  const stable = await (await getForm(req("/forms/" + form.id, "GET", f.cookie))).json(); expect(stable.content.questions[1].condition).toMatchObject(q[1].condition!);
  expect(stable.content.questions[1].condition.optionId).toBe(stable.content.questions[0].optionDefinitions[0].id);
});

test("체크박스 조건과 중첩 분기는 상위 질문의 표시 상태 및 선택 수를 함께 검사한다", async () => {
  const f = await fixture(), q = f.content.questions;
  const conditional = { ...f.content, questions: [{ ...q[0], type: "체크박스", selectionLimits: { min: 1, max: 1 } },
    { ...q[1], type: "객관식 답변", options: ["동의", "거부"], condition: { ...q[1].condition, operator: "includes" } }, q[2],
    { id: randomUUID(), type: "단문형 답변", label: "동의 확인", required: true, condition: { questionId: q[1].id, operator: "equals", value: "동의" } }] };
  const form = await add(f, conditional), token = await publish(f, form.id), path = "/public/forms/" + token + "/submissions", child = conditional.questions[3].id;
  for (const extra of [{ [q[0].id]: ["온라인", "현장"] }, { [q[0].id]: ["온라인"], [child]: "숨긴 응답" }, { [q[0].id]: ["현장"], [q[1].id]: "동의" }])
    expect((await submit(req(path, "POST", "", { answers: { ...answers(f), ...extra }, consent: true }, true))).status).toBe(422);
  expect((await submit(req(path, "POST", "", { answers: { ...answers(f), [q[0].id]: ["현장"], [q[1].id]: "동의", [child]: "확인" }, consent: true }, true))).status).toBe(201);
});

test("DB는 잘못된 행·조건 연산자·미확정 분기 게시와 게시본 설정 변경을 거부한다", async () => {
  const f = await fixture(), form = await add(f), stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: { questions: { orderBy: { order: "asc" } } } });
  await expect(db.$executeRaw`UPDATE "Question" SET "condition"=${JSON.stringify({ questionId: f.content.questions[0].id, operator: null, value: "현장" })}::jsonb WHERE id=${stored.questions[1].id}`).rejects.toThrow();
  await expect(db.question.update({ where: { id: stored.questions[2].id }, data: { matrixRows: [f.content.questions[2].rows![0], f.content.questions[2].rows![0]] } })).rejects.toThrow();
  await db.question.update({ where: { id: stored.questions[1].id }, data: { condition: { questionId: randomUUID(), operator: "equals", value: "현장" } } });
  await expect(db.formVersion.update({ where: { id: stored.id }, data: { status: "published" } })).rejects.toThrow();
  await db.question.update({ where: { id: stored.questions[1].id }, data: { condition: f.content.questions[1].condition } });
  await publish(f, form.id);
  await expect(db.question.update({ where: { id: stored.questions[1].id }, data: { condition: { questionId: f.content.questions[0].id, operator: "equals", value: "온라인" } } })).rejects.toThrow();
});

test("공유 열람은 인증 후 허용한 행렬 질문의 구조화한 값과 행 이름만 반환한다", async () => {
  const f = await fixture(), form = await add(f), token = await publish(f, form.id), q = f.content.questions;
  expect((await submit(req("/public/forms/" + token + "/submissions", "POST", "", { answers: answers(f, "현장"), consent: true }, true))).status).toBe(201);
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id, status: "published" } });
  const created = await createShare(req("/share-grants", "POST", f.cookie, { formId: form.id, formVersionId: version.id, email: "matrix-viewer@catchsecu.test",
    questionIds: [q[2].id], expiresAt: new Date(Date.now() + 86400000).toISOString() }, true)); expect(created.status).toBe(201);
  const grant = await created.json(), invitation = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + grant.id + ":invite:1" } })).payloadCipher);
  const challenge = await viewerPost(req("/viewer/challenges", "POST", "", { formCode: form.id, invitationCode: invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], email: "matrix-viewer@catchsecu.test", consent: true })); expect(challenge.status).toBe(202);
  const challengeId = (await challenge.json()).id, preCookie = challenge.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + grant.id + ":challenge:" + challengeId } })).payloadCipher);
  const verified = await viewerPost(req("/viewer/challenges/" + challengeId + "/verify", "POST", preCookie, { code: mail.text.match(/인증코드: (\d{6})/)![1] })); expect(verified.status).toBe(200);
  const cookie = verified.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const page = await (await viewerGet(req("/viewer/submissions", "GET", cookie))).json();
  expect(page.viewer.questions).toMatchObject([{ id: q[2].id, label: q[2].label, type: q[2].type, rows: q[2].rows }]);
  expect(page.viewer.questions).toHaveLength(1);
  expect(page.viewer.questions[0].optionDefinitions.map((option: { label: string; value: string }) => [option.label, option.value])).toEqual(q[2].options!.map(value => [value, value]));
  expect(page.items[0].values).toEqual({ [q[2].id]: answers(f)[q[2].id] }); expect(JSON.stringify(page)).not.toContain("방문 안내");
});

test("분기 파일은 실제 검사 후 표시된 답변에만 연결하고 정정 시 현재 값을 비운다", async () => {
  const f = await fixture(), questionId = randomUUID(), fileQuestion = { id: questionId, type: "파일 업로드", label: "현장 증빙", required: true,
    condition: { questionId: f.content.questions[0].id, operator: "equals", value: "현장" } };
  const form = await add(f, { ...f.content, questions: [...f.content.questions, fileQuestion] }), token = await publish(f, form.id);
  const bytes = Buffer.from("branch proof document"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const upload = await submit(req("/public/forms/" + token + "/uploads", "POST", "", { questionId, name: "branch-proof.txt", mime: "text/plain", size: bytes.length, sha256 }, true)); expect(upload.status).toBe(201);
  const file = await upload.json();
  expect((await uploadBytes(new Request(origin + "/api/v1/uploads/" + file.id + "/content", { method: "PUT", headers: { origin, "content-type": "text/plain", "x-upload-token": file.uploadToken }, body: new Uint8Array(bytes) }))).status).toBe(200);
  expect((await uploadAction(new Request(origin + "/api/v1/uploads/" + file.id + "/complete", { method: "POST", headers: { origin, "x-upload-token": file.uploadToken } }))).status).toBe(200);
  const path = "/public/forms/" + token + "/submissions", attachments = { [questionId]: { fileId: file.id, token: file.uploadToken } };
  expect((await submit(req(path, "POST", "", { answers: { ...answers(f), [questionId]: file.id }, attachments, consent: true }, true))).status).toBe(422);
  const posted = await submit(req(path, "POST", "", { answers: { ...answers(f, "현장"), [questionId]: file.id }, attachments, consent: true }, true)); expect(posted.status).toBe(201);
  const id = (await posted.json()).id;
  expect((await correct(req("/submissions/" + id, "PATCH", f.cookie, { version: 1, reason: "온라인으로 변경", answers: { [f.content.questions[0].id]: "온라인" } }))).status).toBe(200);
  const detail = await (await getSubmission(req("/submissions/" + id, "GET", f.cookie))).json();
  expect(detail.values[questionId]).toBe(""); expect(detail.corrections[0].before[questionId]).toBe(file.id); expect(detail.corrections[0].after[questionId]).toBe("");
  expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).scanStatus).toBe("clean");
});
