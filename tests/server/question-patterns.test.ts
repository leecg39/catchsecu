import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext, type Context } from "@/server/context";
import { copyForm, createForm, fingerprint, publishForm, readForm, updateForm, versionInclude } from "@/server/forms";
import { createTemplate, useTemplate } from "@/server/templates";
import { submitForm } from "@/server/submissions";
import { correctSubmission, getSubmission } from "@/server/submission-management";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { formatResidentRegistrationInput, infoPatternAnswerError, infoPatternCatalog, infoPatternIds } from "@/contracts/question-patterns";
import { QuestionInput } from "@/components/forms/QuestionInput";
import { decrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Pattern QA", publicName: "Pattern QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "Pattern QA", externalName: "Pattern QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = `pattern-${randomUUID()}@example.test`, password = "Pattern-QA!12345";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "Pattern QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  await db.$disconnect();
});

function content(pattern: 1 | 3 | undefined = 3) {
  return formContentSchema.parse({ body: "", questions: [{ id: randomUUID(), type: "단문형 답변", label: "식별번호", required: true,
    ...(pattern === undefined ? {} : { infoPatternId: pattern }), textMaxLength: 100 }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 });
}
async function fixture(pattern: 1 | 3 | undefined = 3) {
  const formContent = content(pattern);
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "고정 입력 형식", content: formContent }, randomUUID(), tx));
  return { form, content: formContent, questionId: formContent.questions[0].id };
}
async function publish(formId: string, version = 1) {
  await db.$transaction(tx => publishForm(tx, ctx, formId, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId, status: "active" } })).tokenCipher);
}
const post = (token: string, questionId: string, value: string) => submitForm(token,
  submissionInput.parse({ answers: { [questionId]: value }, consent: false }), randomUUID(), randomUUID());

test("확인된 여섯 ID만 허용하고 임의 patternRegex 입력은 계약에서 거부한다", () => {
  expect(infoPatternIds).toEqual([1, 2, 3, 4, 7, 8]);
  expect(infoPatternCatalog.map(item => item.name)).toEqual(["일반", "추가질의", "주민등록번호", "이메일", "주소", "날짜"]);
  const base = content(1), question = base.questions[0];
  expect(formContentSchema.safeParse({ ...base, questions: [{ ...question, infoPatternId: 5 }] }).success).toBe(false);
  expect(formContentSchema.safeParse({ ...base, questions: [{ ...question, type: "장문형 답변", infoPatternId: 3 }] }).success).toBe(false);
  expect(formContentSchema.safeParse({ ...base, questions: [{ ...question, subjectRole: "email", infoPatternId: 3 }] }).success).toBe(false);
  expect(formContentSchema.safeParse({ ...base, questions: [{ ...question, patternRegex: "(a+)+$" }] }).success).toBe(false);
});

test("주민등록번호 형식은 고정 길이 문자 검사로만 검증하고 입력을 13자리로 제한한다", () => {
  expect(formatResidentRegistrationInput("9001011234567")).toBe("900101-1234567");
  expect(formatResidentRegistrationInput("９００１０１-１２３４５６７abc9001011234567")).toBe("900101-1234567");
  expect(infoPatternAnswerError(3, "900101-1234567")).toBeNull();
  for (const value of ["9001011234567", "900101-123456", "900101_1234567", "900101-123456A", "a".repeat(100)])
    expect(infoPatternAnswerError(3, value)).toContain("주민등록번호");
  const started = performance.now();
  for (let index = 0; index < 100_000; index++) infoPatternAnswerError(3, "9".repeat(100));
  expect(performance.now() - started).toBeLessThan(1000);
});

test("패턴을 저장·조회·복제·템플릿 사용하며 삭제하면 기존 null 의미를 복원한다", async () => {
  const f = await fixture(), row = () => db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "draft" }, include: versionInclude });
  const before = await row(), originalId = before.questions[0].id;
  expect((await readForm(ctx, f.form.id)).content!.questions[0].infoPatternId).toBe(3);
  const copied = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "패턴 템플릿", category: "일반", content: f.content }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  expect(copied.content!.questions[0].infoPatternId).toBe(3);
  expect(used.content!.questions[0].infoPatternId).toBe(3);
  const current = (await readForm(ctx, f.form.id)).content!;
  delete current.questions[0].infoPatternId;
  await updateForm(ctx, f.form.id, { version: 1, content: current }, randomUUID());
  const after = await row();
  expect(after.questions[0].id).toBe(originalId);
  expect(after.questions[0].infoPatternId).toBeNull();
  expect((await readForm(ctx, f.form.id)).content!.questions[0]).not.toHaveProperty("infoPatternId");
  expect(fingerprint(after)).not.toBe(fingerprint(before));
});

test("공개 제출과 과거 게시본 정정에서 형식을 서버가 원자적으로 강제한다", async () => {
  const f = await fixture(), token = await publish(f.form.id);
  await expect(post(token, f.questionId, "9001011234567")).rejects.toMatchObject({ status: 422, code: "INVALID_INFO_PATTERN" });
  const submitted = await post(token, f.questionId, "900101-1234567");
  expect(submitted.status).toBe(201);
  await expect(correctSubmission(ctx, submitted.body.id, { version: 1, reason: "잘못된 정정", answers: { [f.questionId]: "9001011234567" } }, randomUUID()))
    .rejects.toMatchObject({ status: 422, code: "INVALID_INFO_PATTERN" });
  expect(await db.correction.count()).toBe(0);
  expect((await getSubmission(ctx, submitted.body.id, randomUUID())).values[f.questionId]).toBe("900101-1234567");
});

test("DB 허용 목록은 잘못된 ID·질문 유형·정보주체 조합과 게시본 변경을 거부한다", async () => {
  const f = await fixture(), draft = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "draft" }, include: { questions: true } });
  const id = draft.questions[0].id;
  for (const data of [{ infoPatternId: 5 }, { type: "장문형 답변", infoPatternId: 3 }, { subjectRole: "email", infoPatternId: 3 }])
    await expect(db.question.update({ where: { id }, data })).rejects.toThrow();
  const token = await publish(f.form.id);
  expect(token).toHaveLength(43);
  await expect(db.question.update({ where: { id }, data: { infoPatternId: 1 } })).rejects.toThrow();
  expect((await db.question.findUniqueOrThrow({ where: { id } })).infoPatternId).toBe(3);
});

test("공개 입력은 숫자 키보드·고정 placeholder·14자 상한을 렌더링한다", () => {
  const question = content(3).questions[0];
  const html = renderToStaticMarkup(createElement(QuestionInput, { question, value: "900101-1", onChange: () => {} }));
  expect(html).toContain('inputMode="numeric"');
  expect(html).toContain('placeholder="000000-0000000"');
  expect(html).toContain('maxLength="14"');
  expect(html).not.toContain("patternRegex");
});
