import { randomUUID } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm, updateForm, publishForm, reviseForm, copyForm, fingerprint, versionInclude } from "@/server/forms";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { validateQuestionDefinitions } from "@/contracts/questions";
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
  const company = await db.company.create({ data: { name: "Text limit QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } }); serviceId = company.services[0].id;
  const email = "text-limit-" + randomUUID() + "@example.test", password = "Text-limit!12345";
  const req = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(req("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(req("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());
async function fixture(limits?: [number, number]) {
  const ids = [randomUUID(), randomUUID()];
  const content = formContentSchema.parse({ body: "", questions: ["단문형 답변", "장문형 답변"].map((type, i) => ({ id: ids[i], type, label: type, required: false, ...(limits ? { textMaxLength: limits[i] } : {}) })), consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "입력 길이", content }, randomUUID(), tx));
  return { form, ids, content };
}
async function publish(id: string, version = 1) {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id, status: "active" } })).tokenCipher);
}
const post = (token: string, answers: Record<string, string>) => submitForm(token, submissionInput.parse({ answers, consent: false }), randomUUID(), randomUUID());
test("explicit short/long limits persist and enforce UTF-16 N/N+1 at public submission", async () => {
  const f = await fixture([100, 1000]), token = await publish(f.form.id), [short, long] = f.ids;
  expect((await activePublicForm(token)).content.questions.map(q => q.textMaxLength)).toEqual([100, 1000]);
  expect((await post(token, { [short]: "가".repeat(100), [long]: "나".repeat(1000) })).status).toBe(201);
  expect((await post(token, { [short]: "😀".repeat(50), [long]: "" })).status).toBe(201);
  for (const answers of [{ [short]: "가".repeat(101) }, { [long]: "나".repeat(1001) }, { [short]: "😀".repeat(50) + "a" }])
    await expect(post(token, answers)).rejects.toMatchObject({ status: 422, code: "ANSWER_TOO_LONG" });
  expect(await db.submission.count()).toBe(2);
});
test("legacy null lengths retain 1000/20000 and unrelated correction remains valid after a stricter revision", async () => {
  const f = await fixture(), token = await publish(f.form.id), [short, long] = f.ids;
  expect((await activePublicForm(token)).content.questions.every(q => !("textMaxLength" in q))).toBe(true);
  const response = await post(token, { [short]: "a".repeat(1000), [long]: "b".repeat(20000) });
  await expect(post(token, { [short]: "a".repeat(1001) })).rejects.toMatchObject({ code: "ANSWER_TOO_LONG" });
  await db.$transaction(tx => reviseForm(tx, ctx, f.form.id, 2, randomUUID()));
  const current = await readForm(ctx, f.form.id); current.content!.questions.forEach((q, i) => { q.textMaxLength = i ? 1000 : 100; });
  await updateForm(ctx, f.form.id, { version: 3, content: current.content! }, randomUUID());
  await publish(f.form.id, 4);
  await correctSubmission(ctx, response.body.id, { version: 1, reason: "이전 게시본 정정", answers: { [short]: "c".repeat(999) } }, randomUUID());
  expect((await getSubmission(ctx, response.body.id, randomUUID())).values).toMatchObject({ [short]: "c".repeat(999), [long]: "b".repeat(20000) });
});
test("length-only edits save without replacing rows, change fingerprints, and deletion restores legacy semantics", async () => {
  const f = await fixture(), row = () => db.formVersion.findFirstOrThrow({ where: { formId: f.form.id, status: "draft" }, include: versionInclude });
  const before = await row(), hash = fingerprint(before);
  const current = await readForm(ctx, f.form.id); current.content!.questions[0].textMaxLength = 12;
  await updateForm(ctx, f.form.id, { version: 1, content: current.content! }, randomUUID());
  expect((await row()).questions[0].id).toBe(before.questions[0].id);
  expect((await readForm(ctx, f.form.id)).content!.questions[0].textMaxLength).toBe(12);
  expect(fingerprint(await row())).not.toBe(hash);
  delete current.content!.questions[0].textMaxLength;
  await updateForm(ctx, f.form.id, { version: 2, content: current.content! }, randomUUID());
  expect(fingerprint(await row())).toBe(hash);
  expect((await row()).questions[0].textMaxLength).toBeNull();
});
test("limits copy into forms/templates and corrections reject overlong values atomically", async () => {
  const f = await fixture([3, 5]);
  const copy = await db.$transaction(tx => copyForm(tx, ctx, f.form.id, undefined, randomUUID()));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "길이 템플릿", category: "일반", content: f.content }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  for (const result of [copy, used]) expect(result.content!.questions.map(q => q.textMaxLength)).toEqual([3, 5]);
  const token = await publish(f.form.id), answer = await post(token, { [f.ids[0]]: "abc", [f.ids[1]]: "12345" });
  await expect(correctSubmission(ctx, answer.body.id, { version: 1, reason: "초과 입력", answers: { [f.ids[1]]: "123456" } }, randomUUID())).rejects.toMatchObject({ code: "ANSWER_TOO_LONG" });
  expect(await db.correction.count()).toBe(0);
  expect((await getSubmission(ctx, answer.body.id, randomUUID())).values[f.ids[1]]).toBe("12345");
});
test("question contract and database reject invalid type/range without modifying stored rows", async () => {
  const f = await fixture(), question = await db.question.findFirstOrThrow({ where: { formVersion: { formId: f.form.id } }, orderBy: { order: "asc" } });
  for (const value of [0, -1, 1.5, 20001]) expect(formContentSchema.safeParse({ ...f.content, questions: [{ ...f.content.questions[0], textMaxLength: value }] }).success).toBe(false);
  for (const q of [{ ...f.content.questions[0], textMaxLength: 1001 }, { ...f.content.questions[0], type: "날짜" as const, textMaxLength: 10 }]) {
    expect(() => validateQuestionDefinitions([q])).toThrow();
    await expect(updateForm(ctx, f.form.id, { version: 1, content: { ...f.content, questions: [q] } }, randomUUID())).rejects.toMatchObject({ status: 422 });
  }
  for (const data of [{ textMaxLength: 0 }, { textMaxLength: 1001 }, { type: "날짜", textMaxLength: 10 }])
    await expect(db.question.update({ where: { id: question.id }, data })).rejects.toThrow();
  expect(await db.question.findUniqueOrThrow({ where: { id: question.id } })).toEqual(question);
});

test("legacy subject values keep trim-based identity checks during unrelated corrections", async () => {
  const f = await fixture(), content = f.content;
  const nameId = randomUUID(), emailId = randomUUID();
  content.questions.push({ id: nameId, type: "단문형 답변", label: "이름", required: true, subjectRole: "name" },
    { id: emailId, type: "단문형 답변", label: "이메일", required: true, subjectRole: "email" });
  await updateForm(ctx, f.form.id, { version: 1, content }, randomUUID());
  const token = await publish(f.form.id, 2), name = " " + "가".repeat(100), email = " ".repeat(250) + "qa@example.test";
  const response = await post(token, { [nameId]: name, [emailId]: email, [f.ids[0]]: "원래 값" });
  await correctSubmission(ctx, response.body.id, { version: 1, reason: "일반 답변만 정정", answers: { [f.ids[0]]: "고친 값" } }, randomUUID());
  const detail = await getSubmission(ctx, response.body.id, randomUUID());
  expect(detail.values[nameId]).toBe(name); expect(detail.values[emailId]).toBe(email);
});
