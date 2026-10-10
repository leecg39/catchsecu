import { randomUUID, createHash } from "node:crypto";
import { Client } from "pg";
import { parse as parseCsv } from "csv-parse/sync";
import { afterAll, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm, updateForm, publishForm, reviseForm, copyForm, contentDto, fingerprint, versionInclude } from "@/server/forms";
import { createTemplate, updateTemplate, getTemplate, useTemplate } from "@/server/templates";
import { requestApproval } from "@/server/approvals";
import { submitForm, listSubmissions } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { correctSubmission, getSubmission } from "@/server/submission-management";
import { createShare, changeShare } from "@/server/sharing";
import { startViewerChallenge, verifyViewerChallenge, listSharedSubmissions, getSharedSubmission } from "@/server/viewer";
import { exportLayout, exportRowInclude, renderExportRow } from "@/server/export-renderer";
import { exportSubmissions } from "@/server/submission-export";
import { createExport, runOneExport, downloadExport } from "@/server/exports";
import { privateConsentReceiptPdf } from "@/server/consent-receipts";
import { consentBundle } from "@/server/form-documents";
import { decrypt } from "@/server/crypto";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import type { FormContent } from "@/contracts/forms";
import { formatAnswer, visibleQuestionIds, type AnswerValue, type OptionDefinition, type QuestionDefinition } from "@/contracts/questions";
import { checkSubjectQuestions } from "@/contracts/subjects";
import { validateMarketingConfig } from "@/contracts/marketing";
import type { ConsentEvidence } from "@/contracts/form-documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
// RED must reach the existing public contract and server. No not-yet-created custom-choice helper is imported.
type CustomOption = OptionDefinition & { isCustomValue?: boolean };
type CustomQuestion = Omit<QuestionDefinition, "optionDefinitions"> & { optionDefinitions?: CustomOption[] };
type CustomContent = Omit<FormContent, "questions"> & { questions: CustomQuestion[] };
type CustomAnswer = { kind: "custom-choice"; selectedValues: string[]; custom: { optionId: string; text: string } };
type TestAnswers = Record<string, AnswerValue | CustomAnswer>;
const supported = ["객관식 답변", "체크박스", "드롭다운"] as const;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
let ctx: Context, serviceId: string;

beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_custom_choice_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS qa_custom_choice_audit()");
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Custom choice QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "custom-choice-" + randomUUID() + "@example.test", password = "Custom-choice-test!123";
  const req = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(req("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(req("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_custom_choice_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION qa_custom_choice_audit()").catch(() => undefined);
  await db.$disconnect();
});

function choice(type: typeof supported[number], custom = true): CustomQuestion {
  const options: CustomOption[] = [
    { id: randomUUID(), value: "ordinary|literal,text", label: "일반 보기" },
    { id: randomUUID(), value: "second", label: "두 번째 보기" },
    { id: randomUUID(), value: "other-stable-value", label: "기타", ...(custom ? { isCustomValue: true } : {}) },
  ];
  return { id: randomUUID(), type, label: type, required: false, options: options.map(option => option.value), optionDefinitions: options };
}
function content(custom = true): CustomContent {
  return { body: "기존 안내", questions: [...supported.map(type => choice(type, custom)), { id: randomUUID(), type: "단문형 답변", label: "독립 내용", required: false }],
    verify: false, font: "16px", bold: false, consentRequired: false, consentPurpose: "기존 동의 목적", retentionDays: 30, maxResponses: 100, showSubmitNotice: true };
}
const definitions = (question: CustomQuestion) => question.optionDefinitions!;
const other = (question: CustomQuestion) => definitions(question).find(option => option.isCustomValue)!;
function answer(question: CustomQuestion, text = "직접 입력", values?: string[]): CustomAnswer {
  const option = other(question);
  return { kind: "custom-choice", selectedValues: values ?? [option.value], custom: { optionId: option.id, text } };
}
const input = (answers: TestAnswers, consent = false) => ({ answers, consent }) as unknown as Parameters<typeof submitForm>[1];
const correctionAnswers = (answers: TestAnswers) => answers as unknown as Parameters<typeof correctSubmission>[2]["answers"];
async function fixture(value = content()) {
  // A typed-server caller also needs validation. Deliberately do not parse away new metadata before createForm.
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "기타 보기 QA", content: value }, randomUUID(), tx));
  return { id: form.id, content: value, q: value.questions };
}
const stored = (id: string, status: "draft" | "published" = "draft") => db.formVersion.findFirstOrThrow({ where: { formId: id, status }, include: versionInclude, orderBy: { number: "desc" } });
const current = async (id: string) => (await readForm(ctx, id)).content! as CustomContent;
async function publish(id: string, version = 1) {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id, status: "active" } })).tokenCipher);
}
async function submit(token: string, answers: TestAnswers, consent = false, key: string = randomUUID()) {
  return submitForm(token, submissionInput.parse(input(answers, consent)), key, randomUUID());
}
async function rejectAnswer(token: string, question: CustomQuestion, value: unknown, code = "INVALID_CUSTOM_CHOICE") {
  await expect(submitForm(token, input({ [question.id]: value } as TestAnswers), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 422, code });
}
async function snapshot(id: string) {
  return { form: await db.form.findUniqueOrThrow({ where: { id } }), version: await stored(id),
    audit: await db.auditEvent.findMany({ where: { resourceId: id }, orderBy: { id: "asc" } }) };
}
function withoutFlags(value: CustomContent) { for (const question of value.questions) for (const option of question.optionDefinitions ?? []) delete option.isCustomValue; return value; }
function csvRecords(csv: string) { return parseCsv(csv, { bom: true }) as string[][]; }

test("three choice definitions accept explicit custom flags without adding false defaults to ordinary options", async () => {
  const original = content(), parsed = formContentSchema.parse(original) as CustomContent;
  expect(parsed.questions.slice(0, 3).map(q => definitions(q).at(-1)!.isCustomValue)).toEqual([true, true, true]);
  expect(() => z.toJSONSchema(formContentSchema)).not.toThrow();
  const f = await fixture(parsed), saved = await current(f.id);
  for (const q of saved.questions.slice(0, 3)) { expect(definitions(q).at(-1)).toMatchObject({ isCustomValue: true }); expect(definitions(q)[0]).not.toHaveProperty("isCustomValue"); }
  const token = await publish(f.id);
  expect((await activePublicForm(token)).content.questions.slice(0, 3).map(q => definitions(q).at(-1)!.isCustomValue)).toEqual([true, true, true]);
});

test("typed definitions reject duplicate or misplaced custom choices, unsupported types and invalid flag shapes atomically", async () => {
  const mutations: ((q: CustomQuestion) => void)[] = [
    q => { definitions(q)[0].isCustomValue = true; },
    q => { q.optionDefinitions = [definitions(q)[2], definitions(q)[0], definitions(q)[1]]; q.options = definitions(q).map(o => o.value); },
    q => { q.type = "行列型" as QuestionDefinition["type"]; },
    q => { q.type = "행렬형 단일 선택"; q.rows = [{ id: randomUUID(), label: "행" }]; },
    q => { q.type = "행렬형 복수 선택"; q.rows = [{ id: randomUUID(), label: "행" }]; },
    q => { q.type = "단문형 답변"; },
    q => { Object.assign(definitions(q)[2], { isCustomValue: null }); },
    q => { Object.assign(definitions(q)[2], { isCustomValue: "true" }); },
    q => { Object.assign(definitions(q)[2], { customValue: true }); },
  ];
  for (const mutate of mutations) {
    const bad = content(); mutate(bad.questions[0]);
    const before = await db.form.count();
    await expect(db.$transaction(tx => createForm(ctx, { serviceId, title: "거절 보기", content: bad }, randomUUID(), tx))).rejects.toMatchObject({ status: 422 });
    expect(await db.form.count()).toBe(before);
  }
  const tooMany = content(); tooMany.questions[0].optionDefinitions = Array.from({ length: 101 }, (_, i) => ({ id: randomUUID(), value: String(i), label: String(i), ...(i === 100 ? { isCustomValue: true } : {}) }));
  tooMany.questions[0].options = definitions(tooMany.questions[0]).map(o => o.value);
  expect(() => formContentSchema.parse(tooMany)).toThrow();
});

test("custom labels enforce 250 UTF-16 while unchanged legacy ordinary labels keep 500-code-point API and copy compatibility", async () => {
  const value = content(); definitions(value.questions[0])[0].label = "😀".repeat(500); other(value.questions[0]).label = "😀".repeat(125);
  expect((formContentSchema.parse(value) as CustomContent).questions[0].optionDefinitions![0].label).toBe("😀".repeat(500));
  const f = await fixture(value), copy = await db.$transaction(tx => copyForm(tx, ctx, f.id, undefined, randomUUID()));
  expect(copy.content!.questions[0].optionDefinitions![0].label).toBe("😀".repeat(500));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "긴 기존 보기", category: "QA", content: value }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  expect(used.content!.questions[0].optionDefinitions![0].label).toBe("😀".repeat(500));
  for (const label of ["가".repeat(251), "😀".repeat(125) + "a", " ", "x\0y", "x\ud800y"]) {
    const bad = structuredClone(value); other(bad.questions[0]).label = label;
    expect(() => formContentSchema.parse(bad), JSON.stringify(label)).toThrow();
    await expect(updateForm(ctx, f.id, { version: 1, content: bad }, randomUUID())).rejects.toMatchObject({ status: 422 });
  }
  const overLegacy = structuredClone(value); definitions(overLegacy.questions[0])[0].label = "😀".repeat(501);
  expect(() => formContentSchema.parse(overLegacy)).toThrow();
  expect((await readForm(ctx, f.id)).version).toBe(1);
});

test("flag omission and legacy options preserve current true, explicit false clears permanently without replaying historical true", async () => {
  const f = await fixture(), token = await publish(f.id); void token;
  const published = await stored(f.id, "published");
  await updateForm(ctx, f.id, { version: 2, content: withoutFlags(await current(f.id)) }, randomUUID());
  expect(definitions((await current(f.id)).questions[0])[2].isCustomValue).toBe(true);
  const first = await stored(f.id), legacy = await current(f.id); delete legacy.questions[0].optionDefinitions;
  await updateForm(ctx, f.id, { version: 3, content: legacy }, randomUUID());
  expect(definitions((await current(f.id)).questions[0])[2].isCustomValue).toBe(true);
  const clear = await current(f.id); definitions(clear.questions[0])[2].isCustomValue = false;
  await updateForm(ctx, f.id, { version: 4, content: clear }, randomUUID());
  await updateForm(ctx, f.id, { version: 5, content: withoutFlags(await current(f.id)) }, randomUUID());
  const saved = await current(f.id); expect(definitions(saved.questions[0])[2]).not.toHaveProperty("isCustomValue");
  expect((await stored(f.id)).questions[0].options.map(o => o.id)).toEqual(first.questions[0].options.map(o => o.id));
  expect(await stored(f.id, "published")).toEqual(published);
  const flags = await db.$queryRaw<{ isCustomValue: boolean | null }[]>`SELECT "isCustomValue" FROM "QuestionOption" WHERE "questionId"=${first.questions[0].id} ORDER BY "order"`;
  expect(flags.every(row => row.isCustomValue === null)).toBe(true);
});

test("deleting and restoring a historical option with omitted flag never restores old custom metadata or allows a changed value", async () => {
  const f = await fixture(); await publish(f.id); await db.$transaction(tx => reviseForm(tx, ctx, f.id, 2, randomUUID()));
  const value = await current(f.id), removed = definitions(value.questions[0]).pop()!; value.questions[0].options!.pop();
  await updateForm(ctx, f.id, { version: 3, content: value }, randomUUID());
  const restored = await current(f.id), { isCustomValue: _custom, ...plain } = removed; void _custom;
  definitions(restored.questions[0]).push(plain); restored.questions[0].options!.push(plain.value);
  await updateForm(ctx, f.id, { version: 4, content: restored }, randomUUID());
  expect(definitions((await current(f.id)).questions[0])[2]).toEqual(plain);
  const bad = await current(f.id); definitions(bad.questions[0])[2].value = "changed-value"; bad.questions[0].options![2] = "changed-value";
  const before = await snapshot(f.id);
  await expect(updateForm(ctx, f.id, { version: 5, content: bad }, randomUUID())).rejects.toMatchObject({ status: 422 });
  expect(await snapshot(f.id)).toEqual(before);
});

test("moving custom A to B preserves row IDs and values, updates batch metadata, and supersedes only the changed approval", async () => {
  const f = await fixture(), before = await stored(f.id), originalHash = fingerprint(before);
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true, approvalRoles: ["owner"] } });
  const approval = await db.$transaction(tx => requestApproval(tx, ctx, f.id, { version: 1, message: "기타 검토", reference: "QA" }, randomUUID()));
  const value = await current(f.id), q = value.questions[0], a = definitions(q)[2], b = definitions(q)[0];
  a.isCustomValue = false; b.isCustomValue = true; b.label = "새 기타";
  q.optionDefinitions = [definitions(q)[1], a, b]; q.options = definitions(q).map(o => o.value);
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  const after = await stored(f.id), saved = (await current(f.id)).questions[0];
  expect(after.questions[0].id).toBe(before.questions[0].id);
  expect(after.questions[0].options.map(o => [o.id, o.stableKey, o.value]).sort()).toEqual(before.questions[0].options.map(o => [o.id, o.stableKey, o.value]).sort());
  expect(definitions(saved)[2]).toEqual({ id: b.id, value: b.value, label: "새 기타", isCustomValue: true });
  expect(definitions(saved)[1]).not.toHaveProperty("isCustomValue"); expect(fingerprint(after)).not.toBe(originalHash);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "superseded", snapshot: approval.snapshot });
});

test("choice type changes preserve custom and non-choice or matrix transitions require explicit removal after current-state merge", async () => {
  const f = await fixture(); let version = 1;
  for (const type of ["체크박스", "드롭다운", "객관식 답변"] as const) {
    const value = withoutFlags(await current(f.id)); value.questions[0].type = type;
    await updateForm(ctx, f.id, { version: version++, content: value }, randomUUID());
    expect(definitions((await current(f.id)).questions[0])[2].isCustomValue).toBe(true);
  }
  const omitted = await current(f.id); omitted.questions[0].type = "단문형 답변"; delete omitted.questions[0].options; delete omitted.questions[0].optionDefinitions;
  const before = await snapshot(f.id);
  await expect(updateForm(ctx, f.id, { version, content: omitted }, randomUUID())).rejects.toMatchObject({ status: 422 });
  expect(await snapshot(f.id)).toEqual(before);
  omitted.questions[0].options = []; omitted.questions[0].optionDefinitions = [];
  await updateForm(ctx, f.id, { version: version++, content: omitted }, randomUUID());
  expect((await current(f.id)).questions[0]).toMatchObject({ type: "단문형 답변", options: [], optionDefinitions: [] });
  const matrix = withoutFlags(await current(f.id)); matrix.questions[1].type = "행렬형 복수 선택"; matrix.questions[1].rows = [{ id: randomUUID(), label: "행" }];
  await expect(updateForm(ctx, f.id, { version, content: matrix }, randomUUID())).rejects.toMatchObject({ status: 422 });
  definitions(matrix.questions[1])[2].isCustomValue = false;
  await updateForm(ctx, f.id, { version, content: matrix }, randomUUID());
  expect(definitions((await current(f.id)).questions[1]).every(o => !("isCustomValue" in o))).toBe(true);
});

test("copy, revise and template use preserve custom semantics while allocating independent logical option and branch IDs", async () => {
  const value = content(), option = other(value.questions[0]); value.questions[3].condition = { questionId: value.questions[0].id, operator: "equals", optionId: option.id, value: option.value };
  const f = await fixture(value), copied = await db.$transaction(tx => copyForm(tx, ctx, f.id, undefined, randomUUID()));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "기타 양식", category: "QA", content: value }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  for (const result of [copied, used]) {
    const q = (result.content! as CustomContent).questions, custom = other(q[0]);
    expect(q[0].id).not.toBe(f.q[0].id); expect(custom.id).not.toBe(option.id); expect(custom.value).toBe(option.value);
    expect(q[3].condition).toEqual({ questionId: q[0].id, operator: "equals", optionId: custom.id, value: custom.value });
  }
  const omitted = withoutFlags(structuredClone(template.content) as CustomContent);
  await updateTemplate(ctx, template.id, { version: 1, content: omitted }, randomUUID());
  expect(definitions((await getTemplate(ctx, template.id)).content.questions[0])[2].isCustomValue).toBe(true);
  definitions(omitted.questions[0])[2].isCustomValue = false;
  await updateTemplate(ctx, template.id, { version: 2, content: omitted }, randomUUID());
  delete definitions(omitted.questions[0])[2].isCustomValue;
  await updateTemplate(ctx, template.id, { version: 3, content: omitted }, randomUUID());
  expect(definitions((await getTemplate(ctx, template.id)).content.questions[0])[2]).not.toHaveProperty("isCustomValue");
  await publish(f.id); const frozen = await stored(f.id, "published"); await db.$transaction(tx => reviseForm(tx, ctx, f.id, 2, randomUUID()));
  expect(other((await current(f.id)).questions[0])).toEqual(option); expect(await stored(f.id, "published")).toEqual(frozen);
});

test("legacy null flags remain absent in DTO and fingerprints and never rewrite stored legacy template JSON", async () => {
  const f = await fixture(content(false)), row = await stored(f.id), dto = contentDto(row) as CustomContent;
  const flags = await db.$queryRaw<{ isCustomValue: boolean | null }[]>`SELECT "isCustomValue" FROM "QuestionOption" WHERE "questionId" IN (SELECT id FROM "Question" WHERE "formVersionId"=${row.id})`;
  expect(flags.every(o => o.isCustomValue === null)).toBe(true);
  expect(dto.questions.flatMap(q => q.optionDefinitions ?? []).every(o => !("isCustomValue" in o))).toBe(true);
  expect(fingerprint(row)).toBe(sha(JSON.stringify({ title: row.title, content: withoutFlags(structuredClone(dto)), consentBundle: consentBundle(row) })));
  const legacy = content(false); legacy.questions.forEach(q => delete q.optionDefinitions);
  const template = await db.formTemplate.create({ data: { tenantId: ctx.tenantId, serviceId, title: "Legacy choices", category: "QA", content: legacy } });
  const first = await getTemplate(ctx, template.id), second = await getTemplate(ctx, template.id);
  expect(first.content).toEqual(second.content); expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(template);
  expect(first.content.questions.flatMap(q => q.optionDefinitions ?? []).every(o => !("isCustomValue" in o))).toBe(true);
});

test("strict custom answer wire accepts raw Unicode text at 100 UTF-16 and rejects malformed or ambiguous representations", () => {
  const q = choice("체크박스");
  for (const text of ["a".repeat(100), "😀".repeat(50), "\ufeff <script>x</script> | , \" \n العربية e\u0301 "])
    expect(submissionInput.parse(input({ [q.id]: answer(q, text) })).answers[q.id]).toEqual(answer(q, text));
  const valid = answer(q), invalid = [
    { ...valid, extra: 1 }, { ...valid, custom: { ...valid.custom, label: "위조" } }, { ...valid, custom: null },
    { ...valid, selectedValues: "other-stable-value" }, { ...valid, kind: "other" },
    { optionValue: 2, customValue: true, text: "원본 형식" },
    ...["", " \t\n\u00a0\ufeff", "a".repeat(101), "😀".repeat(50) + "a", "x\0y", "x\ud800y", "\udc00"].map(text => answer(q, text)),
  ];
  for (const value of invalid) expect(submissionInput.safeParse(input({ [q.id]: value } as TestAnswers)).success, JSON.stringify(value)).toBe(false);
  expect(() => z.toJSONSchema(submissionInput)).not.toThrow();
});

test("all three choice types store custom metadata exactly and keep ordinary scalar or array fallbacks without pipe parsing", async () => {
  const f = await fixture(), token = await publish(f.id), expected: TestAnswers = {};
  for (const q of f.q.slice(0, 3)) expected[q.id] = answer(q, "  raw | comma,\nvalue  ");
  const submitted = await submit(token, expected), detail = await getSubmission(ctx, submitted.body.id, randomUUID());
  for (const q of f.q.slice(0, 3)) expect(detail.values[q.id]).toEqual(expected[q.id]);
  const ordinary = Object.fromEntries(f.q.slice(0, 3).map(q => [q.id, q.type === "체크박스" ? [definitions(q)[0].value] : definitions(q)[0].value]));
  const normal = await submit(token, ordinary), normalDetail = await getSubmission(ctx, normal.body.id, randomUUID());
  for (const q of f.q.slice(0, 3)) expect(normalDetail.values[q.id]).toEqual(ordinary[q.id]);
  for (const q of f.q.slice(0, 3)) {
    await rejectAnswer(token, q, q.type === "체크박스" ? [other(q).value] : other(q).value);
    await rejectAnswer(token, q, q.type === "체크박스" ? [other(q).value + "|raw"] : other(q).value + "|raw", "INVALID_OPTION");
  }
});

test("server rejects forged custom identity/value/type relationships without creating answers or consuming response capacity", async () => {
  const f = await fixture(), token = await publish(f.id), q = f.q[0], c = answer(q), before = await db.publication.findFirstOrThrow({ where: { formId: f.id } });
  const invalid = [
    { ...c, custom: { ...c.custom, optionId: randomUUID() } }, { ...c, custom: { ...c.custom, optionId: other(f.q[1]).id } },
    { ...c, custom: { ...c.custom, optionId: definitions(q)[0].id } }, { ...c, selectedValues: [definitions(q)[0].value] },
    { ...c, selectedValues: [other(q).value, definitions(q)[0].value] }, { ...c, selectedValues: [] }, { ...c, selectedValues: [other(q).value, other(q).value] },
    { ...c, selectedValues: ["deleted"] }, { ...c, extra: true }, { ...c, custom: { ...c.custom, text: " " } },
  ];
  for (const value of invalid) await rejectAnswer(token, q, value);
  for (const value of [c, { country: "KR", countryName: "대한민국", streetAddress: "길", addressDetail: "", city: "서울", state: "", postalCode: "" },
    { s3Key: randomUUID(), fileName: "userSignImage.png", fileSize: 1 }, { [randomUUID()]: "row" }]) {
    await expect(submitForm(token, input({ [f.q[3].id]: value } as TestAnswers), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 422 });
  }
  expect(await db.submission.count()).toBe(0); expect(await db.answer.count()).toBe(0); expect(await db.consentReceipt.count()).toBe(0);
  expect(await db.publication.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
});

test("checkbox optional exact limits count custom once and required/custom-empty validation never treats a selection as unanswered", async () => {
  const value = content(); value.questions[1].selectionLimits = { mode: "exact", min: 2, max: 2 };
  const f = await fixture(value), token = await publish(f.id), q = f.q[1];
  await submit(token, {}); await submit(token, { [q.id]: [] });
  await submit(token, { [q.id]: answer(q, "둘", [definitions(q)[0].value, other(q).value]) });
  await rejectAnswer(token, q, answer(q), "SELECTION_COUNT");
  await rejectAnswer(token, q, answer(q, "셋", definitions(q).map(o => o.value)), "SELECTION_COUNT");
  await rejectAnswer(token, q, answer(q, "", [definitions(q)[0].value, other(q).value]));
  const required = content(); required.questions[0].required = true;
  const second = await fixture(required), secondToken = await publish(second.id);
  await expect(submitForm(secondToken, input({}), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 422, code: "REQUIRED_ANSWER" });
  await rejectAnswer(secondToken, required.questions[0], answer(required.questions[0], " \ufeff"));
});

test("custom selection drives stable-value branches and nested visibility while hidden injected text is rejected", async () => {
  const value = content(), [radio, check, select, child] = value.questions;
  check.condition = { questionId: radio.id, operator: "equals", optionId: other(radio).id, value: other(radio).value };
  child.required = true; child.condition = { questionId: check.id, operator: "includes", optionId: other(check).id, value: other(check).value };
  select.condition = { questionId: radio.id, operator: "equals", optionId: other(radio).id, value: other(radio).value };
  const f = await fixture(value), token = await publish(f.id), answered = { [radio.id]: answer(radio), [check.id]: answer(check), [child.id]: "분기 답변" };
  expect([...visibleQuestionIds(value.questions, correctionAnswers(answered))]).toEqual(value.questions.map(q => q.id));
  const result = await submit(token, answered);
  await expect(submitForm(token, input({ [radio.id]: answer(radio), [check.id]: answer(check) }), randomUUID(), randomUUID())).rejects.toMatchObject({ code: "REQUIRED_ANSWER" });
  await expect(submitForm(token, input({ [radio.id]: definitions(radio)[0].value, [check.id]: answer(check) }), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 422, code: "HIDDEN_ANSWER" });
  await expect(submitForm(token, input({ [radio.id]: definitions(radio)[0].value, [check.id]: answer(check, "숨긴 직접입력", []) }), randomUUID(), randomUUID())).rejects.toMatchObject({ status: 422, code: "HIDDEN_ANSWER" });
  await correctSubmission(ctx, result.body.id, { version: 1, reason: "일반 분기로 변경", answers: { [radio.id]: definitions(radio)[0].value } }, randomUUID());
  const detail = await getSubmission(ctx, result.body.id, randomUUID());
  expect(detail.values[check.id]).toEqual([]); expect(detail.values[select.id]).toBe(""); expect(detail.values[child.id]).toBe("");
  expect(detail.corrections[0].before![check.id]).toEqual(answer(check));
});

test("correction canonicalizes new object order, preserves unrelated ciphertext and supports ordinary/custom/empty transitions", async () => {
  const f = await fixture(), token = await publish(f.id), q = f.q[1], original = answer(q, "原文", [definitions(q)[0].value, other(q).value]);
  const result = await submit(token, { [q.id]: original, [f.q[3].id]: "before" }), id = result.body.id;
  const originalRow = await db.answer.findFirstOrThrow({ where: { submissionId: id, question: { stableKey: q.id } } });
  const reordered = { custom: { text: original.custom.text, optionId: original.custom.optionId }, selectedValues: [...original.selectedValues].reverse(), kind: "custom-choice" };
  await expect(correctSubmission(ctx, id, { version: 1, reason: "순서만", answers: correctionAnswers({ [q.id]: reordered } as TestAnswers) }, randomUUID())).rejects.toMatchObject({ code: "NO_CHANGES" });
  await correctSubmission(ctx, id, { version: 1, reason: "다른 질문만", answers: { [f.q[3].id]: "after" } }, randomUUID());
  expect(await db.answer.findUniqueOrThrow({ where: { id: originalRow.id } })).toEqual(originalRow);
  for (const [version, value] of [[2, [definitions(q)[0].value]], [3, answer(q, "new")], [4, []]] as const)
    await correctSubmission(ctx, id, { version, reason: "선택 변경", answers: correctionAnswers({ [q.id]: value as AnswerValue | CustomAnswer }) }, randomUUID());
  const detail = await getSubmission(ctx, id, randomUUID());
  expect(detail.values[q.id]).toEqual([]); expect(detail.corrections[0].before![q.id]).toEqual(answer(q, "new"));
  await expect(correctSubmission(ctx, id, { version: 5, reason: "잘못된 기타", answers: correctionAnswers({ [q.id]: answer(q, " ") }) }, randomUUID())).rejects.toMatchObject({ code: "INVALID_CUSTOM_CHOICE" });
  expect((await getSubmission(ctx, id, randomUUID())).version).toBe(5);
});

test("original publication metadata, response values and consent evidence/PDF bytes survive a later ordinary conversion", async () => {
  const f = await fixture(), token = await publish(f.id), text = "CUSTOM-TEXT-NOT-CONSENT-EVIDENCE", q = f.q[0];
  const posted = await submit(token, { [q.id]: answer(q, text), [f.q[3].id]: "before" }, true), old = await stored(f.id, "published");
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: posted.body.id } }), bytes = Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64");
  expect(sha(bytes)).toBe(receipt.pdfHash); expect(JSON.stringify(decrypt<ConsentEvidence>(receipt.evidenceCipher!))).not.toContain(text);
  const oldAnswer = await db.answer.findFirstOrThrow({ where: { submissionId: posted.body.id, question: { stableKey: q.id } } });
  const draft = await current(f.id); definitions(draft.questions[0])[2].isCustomValue = false; definitions(draft.questions[0])[2].label = "새 일반 보기";
  await updateForm(ctx, f.id, { version: 2, content: draft }, randomUUID()); await publish(f.id, 3);
  await correctSubmission(ctx, posted.body.id, { version: 1, reason: "별도 항목", answers: { [f.q[3].id]: "after" } }, randomUUID());
  const detail = await getSubmission(ctx, posted.body.id, randomUUID());
  expect(definitions(detail.questions[0])[2]).toEqual(other(q)); expect(detail.values[q.id]).toEqual(answer(q, text));
  expect(formatAnswer(detail.values[q.id], undefined, detail.questions[0].optionDefinitions, q.type)).toContain(text);
  expect(await stored(f.id, "published")).not.toEqual(old);
  expect(await db.formVersion.findUniqueOrThrow({ where: { id: old.id }, include: versionInclude })).toEqual(old);
  expect(await db.answer.findUniqueOrThrow({ where: { id: oldAnswer.id } })).toEqual(oldAnswer);
  expect(await db.consentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
  expect(Buffer.from((await privateConsentReceiptPdf(ctx, posted.body.id, receipt.id, randomUUID())).bytes)).toEqual(bytes);
});

test("synchronous and asynchronous CSV preserve structured text and published labels while ordinary rows keep their legacy bytes", async () => {
  const f = await fixture(), token = await publish(f.id), q = f.q[1], raw = '=SUM(1,2) | "raw"\n유지', picked = [definitions(q)[0].value, other(q).value];
  const custom = await submit(token, { [q.id]: answer(q, raw, [...picked].reverse()) });
  const ordinary = await submit(token, { [q.id]: [definitions(q)[0].value] });
  const version = await stored(f.id, "published"), layout = await db.$transaction(tx => exportLayout(tx, ctx.tenantId, f.id, [version.id]));
  const ordinaryRow = await db.submission.findUniqueOrThrow({ where: { id: ordinary.body.id }, include: exportRowInclude });
  const priorOrdinary = renderExportRow(ordinaryRow, layout, false, new Date());
  const sync = await exportSubmissions(ctx, f.id, { status: "all", search: "" }, randomUUID()), rows = csvRecords(sync.csv);
  const column = rows[0].findIndex(header => header === "[v1 · 질문 2] " + q.label); expect(column).toBeGreaterThan(-1);
  const cell = rows.find(row => row[0] === custom.body.id)![column];
  expect(JSON.parse(cell)).toEqual({ kind: "custom-choice", selected: [definitions(q)[0], other(q)].map(o => ({ optionId: o.id, value: o.value, label: o.label })), custom: { optionId: other(q).id, text: raw } });
  expect(rows.find(row => row[0] === ordinary.body.id)![column]).toBe(JSON.stringify(["일반 보기"]));
  const job = await createExport(ctx, { formId: f.id, filters: { status: "all", search: "" } }, randomUUID(), randomUUID());
  for (let i = 0; i < 5; i++) { await runOneExport("custom-choice-qa", new Date(), job.id); if ((await db.exportJob.findUniqueOrThrow({ where: { id: job.id } })).status === "ready") break; }
  expect((await db.exportJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ready");
  expect((await downloadExport(ctx, job.id, randomUUID())).csv).toBe(sync.csv);
  const draft = await current(f.id); definitions(draft.questions[1])[2].label = "새 기타 문구";
  await updateForm(ctx, f.id, { version: 2, content: draft }, randomUUID());
  expect((await exportSubmissions(ctx, f.id, { status: "all", search: "" }, randomUUID())).csv).toBe(sync.csv);
  expect(renderExportRow(ordinaryRow, layout, false, new Date())).toBe(priorOrdinary);
});

test("authenticated sharing returns only selected custom fields from the original version and stops after revocation", async () => {
  const f = await fixture(), token = await publish(f.id), q = f.q[0], value = answer(q, "공유 허용 text"), secret = "EXCLUDED-CUSTOM-SECRET";
  const posted = await submit(token, { [q.id]: value, [f.q[1].id]: answer(f.q[1], secret) }), version = await stored(f.id, "published");
  const share = await db.$transaction(tx => createShare(ctx, { formId: f.id, formVersionId: version.id, questionIds: [q.id], email: "custom-viewer@example.test", expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
  const invitation = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":invite:1" } })).payloadCipher);
  const challenge = await startViewerChallenge({ formCode: f.id, invitationCode: invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], email: "custom-viewer@example.test", consent: true }, randomUUID());
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":challenge:" + challenge.id } })).payloadCipher);
  const session = await verifyViewerChallenge(challenge.id, mail.text.match(/인증코드: (\d{6})/)![1], challenge.client, randomUUID());
  const page = await listSharedSubmissions(session.token, 1, 20, randomUUID());
  expect(page.viewer.questions).toHaveLength(1); expect(page.viewer.questions[0].optionDefinitions![2]).toEqual(other(q));
  expect(page.items[0].values).toEqual({ [q.id]: value }); expect(JSON.stringify(page)).not.toContain(secret);
  expect((await getSharedSubmission(session.token, posted.body.id, randomUUID())).values).toEqual({ [q.id]: value });
  const listed = await listSubmissions(ctx, f.id, 1, 20, randomUUID()); expect(listed.items[0].values[q.id]).toEqual(value);
  await changeShare(ctx, share.id, { version: 1 }, "revoke", randomUUID());
  await expect(getSharedSubmission(session.token, posted.body.id, randomUUID())).rejects.toMatchObject({ status: 401 });
});

test("nullable DB flags enforce one custom per parent, UTF-16 labels and parent type, without changing published options", async () => {
  const f = await fixture(content(false)), row = await stored(f.id), q = row.questions[0], a = q.options[0], b = q.options[2];
  await db.$executeRaw`UPDATE "QuestionOption" SET "isCustomValue"=true, label=${"😀".repeat(125)} WHERE id=${b.id}`;
  for (const sql of [
    () => db.$executeRaw`UPDATE "QuestionOption" SET "isCustomValue"=false WHERE id=${b.id}`,
    () => db.$executeRaw`UPDATE "QuestionOption" SET "isCustomValue"=true WHERE id=${a.id}`,
    () => db.$executeRaw`UPDATE "QuestionOption" SET label=${"😀".repeat(125) + "a"} WHERE id=${b.id}`,
    () => db.$executeRaw`UPDATE "Question" SET type='단문형 답변' WHERE id=${q.id}`,
  ]) await expect(sql()).rejects.toThrow();
  await db.$executeRaw`UPDATE "QuestionOption" SET "isCustomValue"=NULL WHERE id=${b.id}`;
  await db.$executeRaw`UPDATE "Question" SET type='행렬형 단일 선택', "matrixRows"=${JSON.stringify([{ id: randomUUID(), label: "행" }])}::jsonb WHERE id=${q.id}`;
  await expect(db.$executeRaw`UPDATE "QuestionOption" SET "isCustomValue"=true WHERE id=${b.id}`).rejects.toThrow();
  await db.$executeRaw`UPDATE "Question" SET type='객관식 답변', "matrixRows"=NULL WHERE id=${q.id}`;
  await db.$executeRaw`UPDATE "QuestionOption" SET "isCustomValue"=true WHERE id=${b.id}`;
  await publish(f.id); const frozen = await stored(f.id, "published");
  await expect(db.$executeRaw`UPDATE "QuestionOption" SET "isCustomValue"=NULL WHERE id=${b.id}`).rejects.toThrow();
  await expect(db.questionOption.delete({ where: { id: b.id } })).rejects.toThrow();
  expect(await stored(f.id, "published")).toEqual(frozen);
});

test("same-version custom edits wait on the real Form lock and yield exactly one 200, one 409 and one audit event", async () => {
  const f = await fixture(), first = await current(f.id), second = structuredClone(first);
  definitions(first.questions[0])[2].label = "winner A"; definitions(second.questions[0])[2].label = "winner B";
  const holder = new Client({ connectionString: env.DATABASE_URL, application_name: "custom-choice-form-race" }); await holder.connect();
  let pending: Promise<number[]> | undefined;
  try {
    await holder.query("BEGIN"); await holder.query('SELECT id FROM "Form" WHERE id=$1 FOR UPDATE', [f.id]);
    pending = Promise.all([first, second].map(value => updateForm(ctx, f.id, { version: 1, content: value }, randomUUID()).then(() => 200, error => Number(error.status))));
    const until = Date.now() + 2500; let waiting = 0;
    while (Date.now() < until) {
      await holder.query("SELECT pg_stat_clear_snapshot()");
      const waiters = await holder.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Form"%' AND pid<>pg_backend_pid()`);
      waiting = Number(waiters.rows[0].count); if (waiting >= 2) break; await new Promise(done => setTimeout(done, 25));
    }
    await holder.query("COMMIT"); const statuses = await pending;
    expect(waiting).toBeGreaterThanOrEqual(2); expect([...statuses].sort()).toEqual([200, 409]);
    const saved = await current(f.id); expect(definitions(saved.questions[0])[2]).toMatchObject({ isCustomValue: true, label: statuses[0] === 200 ? "winner A" : "winner B" });
    expect((await readForm(ctx, f.id)).version).toBe(2); expect(await db.auditEvent.count({ where: { action: "form.draft_updated", resourceId: f.id } })).toBe(1);
  } finally { await holder.query("ROLLBACK").catch(() => undefined); await holder.end(); if (pending) await pending; }
});

test("READ COMMITTED direct parent-type and child-custom writes cannot commit an incompatible final graph", async () => {
  const f = await fixture(content(false)), questions = (await stored(f.id)).questions;
  // Establish column existence before opening clients, so the pre-migration RED cannot leak an open transaction.
  await db.$queryRaw`SELECT "isCustomValue" FROM "QuestionOption" WHERE id=${questions[0].options[2].id}`;
  const clients = ["custom-parent-race", "custom-child-race"].map(application_name => new Client({ connectionString: env.DATABASE_URL, application_name }));
  await Promise.all(clients.map(client => client.connect()));
  let pending: Promise<string> | undefined;
  try {
    // Force each write order with the first transaction left uncommitted. Merely launching two promises
    // could run sequentially and never exercise an invisible child flag or parent type snapshot.
    for (const [index, parentFirst] of [[0, true], [2, false]] as const) {
      const q = questions[index], option = q.options[2];
      for (const client of clients) { await client.query("BEGIN ISOLATION LEVEL READ COMMITTED"); await client.query("SET LOCAL statement_timeout='5s'"); }
      const parent = (client: Client) => client.query('UPDATE "Question" SET type=$1 WHERE id=$2', ["단문형 답변", q.id]);
      const child = (client: Client) => client.query('UPDATE "QuestionOption" SET "isCustomValue"=true WHERE id=$1', [option.id]);
      await (parentFirst ? parent(clients[0]) : child(clients[0]));
      let settled = false;
      pending = (async () => {
        try { await (parentFirst ? child(clients[1]) : parent(clients[1])); await clients[1].query("COMMIT"); return "committed"; }
        catch (error) { await clients[1].query("ROLLBACK"); return (error as { code: string }).code; }
        finally { settled = true; }
      })();
      const until = Date.now() + 1500; let observed = false;
      while (Date.now() < until && !settled) {
        await clients[0].query("SELECT pg_stat_clear_snapshot()");
        const state = await clients[0].query<{ wait_event_type: string | null }>("SELECT wait_event_type FROM pg_stat_activity WHERE application_name='custom-child-race' AND datname=current_database()");
        if (state.rows.some(row => row.wait_event_type === "Lock")) { observed = true; break; }
        await new Promise(done => setTimeout(done, 20));
      }
      const secondFinishedBeforeRelease = settled;
      let first = "committed";
      try { await clients[0].query("COMMIT"); } catch (error) { first = (error as { code: string }).code; await clients[0].query("ROLLBACK"); }
      const results = [first, await pending]; pending = undefined;
      expect(observed || secondFinishedBeforeRelease).toBe(true);
      expect(results).toContain("committed"); expect(results.every(value => ["committed", "23514", "23505", "40P01"].includes(value))).toBe(true);
      const final = await db.$queryRaw<{ type: string; isCustomValue: boolean | null }[]>`SELECT q.type,o."isCustomValue" FROM "Question" q JOIN "QuestionOption" o ON o."questionId"=q.id WHERE o.id=${option.id}`;
      expect(final[0].type === "단문형 답변" && final[0].isCustomValue === true).toBe(false);
    }
  } finally {
    await clients[0].query("ROLLBACK").catch(() => undefined); if (pending) await pending;
    for (const client of clients) { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
  }
});

test.each(["REPEATABLE READ", "SERIALIZABLE"] as const)("%s explicitly rejects custom flag and parent type mutations with a fixed snapshot", async isolation => {
  const f = await fixture(content(false)), q = (await stored(f.id)).questions[0], option = q.options[2];
  const before = await snapshot(f.id), client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  try {
    for (const statement of [
      { text: 'UPDATE "QuestionOption" SET "isCustomValue"=true WHERE id=$1', values: [option.id] },
      { text: 'UPDATE "Question" SET type=$1 WHERE id=$2', values: ["단문형 답변", q.id] },
    ]) {
      await client.query("BEGIN ISOLATION LEVEL " + isolation);
      await client.query('SELECT id FROM "Question" WHERE id=$1', [q.id]);
      await expect(client.query(statement)).rejects.toMatchObject({ code: "0A000" });
      await client.query("ROLLBACK");
    }
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
  expect(await snapshot(f.id)).toEqual(before);
});

test("version conflicts, foreign tenant and current revoked authority reject definition changes without mutating metadata", async () => {
  const f = await fixture(), value = await current(f.id); definitions(value.questions[0])[2].label = "거절 변경";
  const before = await snapshot(f.id);
  await expect(updateForm(ctx, f.id, { version: 999, content: value }, randomUUID())).rejects.toMatchObject({ status: 409 });
  const foreign = await db.company.create({ data: { name: "Other tenant", publicName: "Other" } });
  await expect(updateForm({ ...ctx, tenantId: foreign.id }, f.id, { version: 1, content: value }, randomUUID())).rejects.toMatchObject({ status: 403 });
  const owner = await db.user.create({ data: { id: randomUUID(), email: "other-owner-" + randomUUID() + "@example.test", name: "Other owner", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: owner.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(updateForm(ctx, f.id, { version: 1, content: value }, randomUUID())).rejects.toMatchObject({ status: 403 });
  expect(await snapshot(f.id)).toEqual(before);
});

test.each(["form", "template"] as const)("%s custom changes and version increments roll back when audit insertion fails", async kind => {
  const f = await fixture(), value = await current(f.id);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "감사 기타", category: "QA", content: value }, randomUUID(), tx));
  const before = await snapshot(f.id), beforeTemplate = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  definitions(value.questions[0])[2].isCustomValue = false;
  await db.$executeRawUnsafe("CREATE FUNCTION qa_custom_choice_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('form.draft_updated','template.updated') THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER qa_custom_choice_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_custom_choice_audit()');
  try {
    await expect(kind === "form" ? updateForm(ctx, f.id, { version: 1, content: value }, randomUUID()) : updateTemplate(ctx, template.id, { version: 1, content: value }, randomUUID())).rejects.toThrow("QA audit failure");
    expect(await snapshot(f.id)).toEqual(before); expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(beforeTemplate);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER qa_custom_choice_audit ON "AuditEvent"'); await db.$executeRawUnsafe("DROP FUNCTION qa_custom_choice_audit()"); }
});

test("custom choices never become subject or marketing contact bindings and failed submissions do not alter original answers", async () => {
  const value = content(); value.questions[0].required = true; value.questions[0].subjectRole = "name";
  expect(() => checkSubjectQuestions(value.questions)).toThrow();
  await expect(db.$transaction(tx => createForm(ctx, { serviceId, title: "거절 식별", content: value }, randomUUID(), tx))).rejects.toMatchObject({ status: 422 });
  const valid = content();
  expect(() => validateMarketingConfig({ purpose: "QA", nameQuestionId: valid.questions[0].id, emailQuestionId: valid.questions[1].id }, valid.questions)).toThrow();
  const f = await fixture(valid), token = await publish(f.id), payload = { [f.q[0].id]: answer(f.q[0], "not-an-identity") }, key = randomUUID();
  const first = await submit(token, payload, false, key), before = await db.answer.findMany({ where: { submissionId: first.body.id }, orderBy: { id: "asc" } });
  expect((await submit(token, payload, false, key)).body.id).toBe(first.body.id);
  await expect(submit(token, { [f.q[0].id]: answer(f.q[0], "changed") }, false, key)).rejects.toMatchObject({ status: 409 });
  expect(await db.answer.findMany({ where: { submissionId: first.body.id }, orderBy: { id: "asc" } })).toEqual(before);
  expect(await db.dataSubject.count()).toBe(0); expect(await db.marketingPreference.count()).toBe(0); expect(await db.submission.count()).toBe(1);
});
