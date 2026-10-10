import { randomUUID } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm, updateForm, publishForm, reviseForm, copyForm, versionInclude } from "@/server/forms";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { type QuestionDefinition, formatAnswer } from "@/contracts/questions";
import { specialAnswerError, isCalendarBirth } from "@/contracts/special-questions";
import { exportLayout, exportRowInclude, renderExportRow } from "@/server/export-renderer";
import { createShare, findShare, grantQuestions } from "@/server/sharing";
import { submitForm } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { correctSubmission, getSubmission } from "@/server/submission-management";
import { createTemplate, useTemplate } from "@/server/templates";
import { decrypt } from "@/server/crypto";
const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Special question QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } }); serviceId = company.services[0].id;
  const email = "special-question-" + randomUUID() + "@example.test", password = "Special-question!12345";
  const req = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(req("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(req("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());

const types = ["연락처", "이메일", "이메일 직접 입력", "생년월일"] as const;
const values = ["010-1234-5678", "qa@example.test", "direct@example.test", "20000229"];
async function fixture(required = false) {
  const questions: QuestionDefinition[] = types.map((type, i) => ({ id: randomUUID(), type, label: "질문 " + i, required }));
  const content = formContentSchema.parse({ body: "", questions, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "특수 질문", content }, randomUUID(), tx));
  return { form, content, questions, answers: Object.fromEntries(questions.map((q, i) => [q.id, values[i]])) };
}
async function publish(id: string, version = 1) {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id, status: "active" } })).tokenCipher);
}
const post = (token: string, answers: unknown) => submitForm(token, submissionInput.parse({ answers, consent: false }), randomUUID(), randomUUID());
test("all four scalar question types persist, publish and submit encrypted trimmed string values", async () => {
  const f = await fixture(true), token = await publish(f.form.id);
  expect((await activePublicForm(token)).content.questions.map(q => q.type)).toEqual(types);
  const result = await post(token, Object.fromEntries(Object.entries(f.answers).map(([id, value]) => [id, " " + value + " "])));
  expect((await getSubmission(ctx, result.body.id, randomUUID())).values).toEqual(f.answers);
  const stored = await db.answer.findMany({ where: { submissionId: result.body.id } });
  expect(stored.every(a => a.valueCipher.startsWith("v1.") && !values.some(value => a.valueCipher.includes(value)))).toBe(true);
});
test("required/optional omissions and malformed contact/email/birth or object/array answers are rejected atomically", async () => {
  const optional = await fixture(), token = await publish(optional.form.id);
  expect((await post(token, {})).status).toBe(201);
  const invalid = [["01012345678", "0-1234-5678", "010-12345-6789", "+82 1012345678"], ["bad@", "a@b", "a b@example.test"], ["bad@", "a".repeat(101) + "@example.test"], ["19000229", "20261301", "2026011", "YYYYMMDD", "00000101"]];
  for (const [i, attempts] of invalid.entries()) for (const value of attempts)
    await expect(post(token, { [optional.questions[i].id]: value })).rejects.toMatchObject({ status: 422, code: "INVALID_SPECIAL_ANSWER" });
  for (const q of optional.questions) for (const value of [[], { [randomUUID()]: "" }])
    await expect(post(token, { [q.id]: value })).rejects.toMatchObject({ status: 422, code: "INVALID_ANSWER_TYPE" });
  const required = await fixture(true), requiredToken = await publish(required.form.id);
  await expect(post(requiredToken, {})).rejects.toMatchObject({ status: 422, code: "REQUIRED_ANSWER" });
  expect(await db.submission.count()).toBe(1);
});
test("email split bounds differ from direct bounds and calendar/phone boundaries are deterministic", () => {
  const domain = "b".repeat(60) + "." + "c".repeat(36) + ".io";
  expect(domain.length).toBe(100);
  expect(specialAnswerError("이메일", "a".repeat(100) + "@" + domain)).toBeUndefined();
  expect(specialAnswerError("이메일", "a".repeat(101) + "@example.test")).toBeDefined();
  expect(specialAnswerError("이메일", "a@" + domain + "a")).toBeDefined();
  const at100 = "a".repeat(87) + "@example.test"; expect(at100.length).toBe(100);
  expect(specialAnswerError("이메일 직접 입력", at100)).toBeUndefined(); expect(specialAnswerError("이메일 직접 입력", "a" + at100)).toBeDefined();
  for (const phone of ["02-123-4567", "010-1234-5678", "1234-1234-5678"]) expect(specialAnswerError("연락처", phone)).toBeUndefined();
  expect(isCalendarBirth("20000229")).toBe(true); expect(isCalendarBirth("19000229")).toBe(false);
});
test("copy/template/revise keep special types while historic answer, shared fields and CSV use the published version", async () => {
  const f = await fixture(), token = await publish(f.form.id), response = await post(token, f.answers);
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "published" }, include: versionInclude });
  const before = await db.answer.findMany({ where: { submissionId: response.body.id }, orderBy: { id: "asc" } });
  const copy = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "특수 유형 템플릿", category: "일반", content: f.content }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  for (const made of [copy, used]) expect(made.content!.questions.map(q => q.type)).toEqual(types);
  await db.$transaction(tx => reviseForm(tx, ctx, f.form.id, 2, randomUUID()));
  const draft = await readForm(ctx, f.form.id); draft.content!.questions[0] = { ...draft.content!.questions[0], type: "단문형 답변", label: "개정 후 질문" };
  await updateForm(ctx, f.form.id, { version: 3, content: draft.content! }, randomUUID()); await publish(f.form.id, 4);
  const detail = await getSubmission(ctx, response.body.id, randomUUID()); expect(detail.questions.map(q => q.type)).toEqual(types);
  for (const q of detail.questions) expect(formatAnswer(detail.values[q.id], undefined, undefined, q.type)).toBe(f.answers[q.id]);
  const share = await db.$transaction(tx => createShare(ctx, { formId: f.form.id, formVersionId: version.id, questionIds: f.questions.map(q => q.id), email: "viewer@example.test", expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
  const shared = await db.$transaction(async tx => grantQuestions((await findShare(tx, share.id))!)); expect(shared.map(q => q.type)).toEqual(types);
  const layout = await db.$transaction(tx => exportLayout(tx, ctx.tenantId, f.form.id, [version.id]));
  const csv = renderExportRow(await db.submission.findUniqueOrThrow({ where: { id: response.body.id }, include: exportRowInclude }), layout, false, new Date());
  for (const value of values) expect(csv).toContain(value);
  expect(await db.answer.findMany({ where: { submissionId: response.body.id }, orderBy: { id: "asc" } })).toEqual(before);
  expect(await db.formVersion.findUniqueOrThrow({ where: { id: version.id }, include: versionInclude })).toEqual(version);
});
test("correction validates the original special type and failed corrections never write an event or new ciphertext", async () => {
  const f = await fixture(), token = await publish(f.form.id), response = await post(token, f.answers);
  const before = await db.answer.findMany({ where: { submissionId: response.body.id }, orderBy: { id: "asc" } });
  await expect(correctSubmission(ctx, response.body.id, { version: 1, reason: "잘못된 날짜", answers: { [f.questions[3].id]: "20260229" } }, randomUUID())).rejects.toMatchObject({ code: "INVALID_SPECIAL_ANSWER" });
  expect(await db.correction.count()).toBe(0); expect(await db.answer.findMany({ where: { submissionId: response.body.id }, orderBy: { id: "asc" } })).toEqual(before);
  await correctSubmission(ctx, response.body.id, { version: 1, reason: "전화번호와 생년월일 정정", answers: { [f.questions[0].id]: "02-123-4567", [f.questions[3].id]: "19990730" } }, randomUUID());
  expect((await getSubmission(ctx, response.body.id, randomUUID())).values).toMatchObject({ [f.questions[0].id]: "02-123-4567", [f.questions[3].id]: "19990730" });
});
