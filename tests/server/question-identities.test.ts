import { randomUUID, createHash } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, updateForm, publishForm, reviseForm, readForm, copyForm, fingerprint, contentDto, versionInclude } from "@/server/forms";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import { normalizeQuestionOptions } from "@/contracts/option-identities";
import { choiceTypes, formatAnswer, type QuestionDefinition } from "@/contracts/questions";
import { createTemplate, getTemplate, updateTemplate, useTemplate } from "@/server/templates";
import { decrypt } from "@/server/crypto";
import { submitForm, listSubmissions } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { getSubmission, correctSubmission } from "@/server/submission-management";
import { exportLayout, exportRowInclude, renderExportRow } from "@/server/export-renderer";
import { createShare, findShare, grantQuestions } from "@/server/sharing";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Isolated test database required");
let ctx: Context, id: string;
const questions = () => [
  { id: randomUUID(), type: "객관식 답변" as const, label: "방식", required: true, options: ["현장", "온라인"] },
  { id: randomUUID(), type: "단문형 답변" as const, label: "추가 정보", required: false },
];
const rows = () => db.formVersion.findFirstOrThrow({ where: { formId: id, status: "draft" }, include: {
  questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } },
} });
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Question identity QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  const email = "question-identity-" + randomUUID() + "@example.test", password = "Question-identity!123";
  const request = (path: string, value: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "Owner" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
  const content = formContentSchema.parse({ body: "", questions: questions(), consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 });
  id = (await db.$transaction(tx => createForm(ctx, { serviceId: company.services[0].id, title: "Identity QA", content }, randomUUID(), tx))).id;
});
afterAll(() => db.$disconnect());
test("title-only draft save preserves question and option rows", async () => {
  const before = await rows();
  await updateForm(ctx, id, { version: 1, title: "Updated title" }, randomUUID());
  const after = await rows();
  expect(after.questions.map(q => q.id)).toEqual(before.questions.map(q => q.id));
  expect(after.questions[0].options.map(o => o.id)).toEqual(before.questions[0].options.map(o => o.id));
});
test("draft reorder preserves question and option row identities", async () => {
  const before = await rows(), read = await readForm(ctx, id), content = read.content!;
  content.questions[0].options!.reverse();
  content.questions[0].optionDefinitions!.reverse();
  content.questions.reverse();
  await updateForm(ctx, id, { version: 1, content }, randomUUID());
  const after = await rows();
  expect(after.questions.map(q => q.id)).toEqual([...before.questions].reverse().map(q => q.id));
  expect(after.questions[1].options.map(o => o.id)).toEqual([...before.questions[0].options].reverse().map(o => o.id));
});
test("explicit revise preserves logical questions and leaves the published version untouched", async () => {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version: 1 }, randomUUID()));
  const before = await db.formVersion.findFirstOrThrow({ where: { formId: id, status: "published" }, include: { questions: { orderBy: { order: "asc" }, include: { options: true } } } });
  await db.$transaction(tx => reviseForm(tx, ctx, id, 2, randomUUID()));
  const after = await rows();
  expect(after.questions.map(q => q.stableKey)).toEqual(before.questions.map(q => q.stableKey));
  expect(after.questions.map(q => q.id)).not.toEqual(before.questions.map(q => q.id));
  expect(after.questions[0].options.map(o => o.stableKey).sort()).toEqual(before.questions[0].options.map(o => o.stableKey).sort());
  expect(after.questions[0].options.map(o => o.id).sort()).not.toEqual(before.questions[0].options.map(o => o.id).sort());
  expect(await db.formVersion.findUniqueOrThrow({ where: { id: before.id }, include: { questions: { orderBy: { order: "asc" }, include: { options: true } } } })).toEqual(before);
});

test("label edits and legacy reorders preserve identity, answer value and branch references", async () => {
  let form = await readForm(ctx, id);
  const before = await rows(), option = form.content!.questions[0].optionDefinitions![0];
  form.content!.questions[0].optionDefinitions![0].label = "새 현장 문구";
  form.content!.questions[1].condition = { questionId: form.content!.questions[0].id, operator: "equals", value: option.value, optionId: option.id };
  await updateForm(ctx, id, { version: 1, content: form.content! }, randomUUID());
  form = await readForm(ctx, id);
  expect(form.content!.questions[1].condition).toMatchObject({ optionId: option.id, value: "현장" });
  const content = structuredClone(form.content!);
  delete content.questions[0].optionDefinitions;
  delete content.questions[1].condition!.optionId; // legacy caller sends string-only option/condition contract
  content.questions[0].options!.reverse();
  await updateForm(ctx, id, { version: 2, content }, randomUUID());
  const after = await rows();
  expect(after.questions[0].options.map(o => o.id)).toEqual([...before.questions[0].options].reverse().map(o => o.id));
  expect(after.questions[0].options[1]).toMatchObject({ stableKey: option.id, label: "새 현장 문구", value: "현장" });
});

test("invalid projections, duplicate/reparented IDs, changed values and deleted branch targets roll back", async () => {
  const base = (await readForm(ctx, id)).content!, before = await rows();
  const attempts = [
    (c: typeof base) => c.questions[0].options!.reverse(),
    (c: typeof base) => { c.questions[0].optionDefinitions![1].id = c.questions[0].optionDefinitions![0].id; },
    (c: typeof base) => { c.questions[0].optionDefinitions![0].value = "바뀐 값"; c.questions[0].options![0] = "바뀐 값"; },
    (c: typeof base) => { c.questions[0].id = randomUUID(); },
    (c: typeof base) => { c.questions[1].condition = { questionId: c.questions[0].id, operator: "equals", value: "현장", optionId: c.questions[0].optionDefinitions![1].id }; },
    (c: typeof base) => { const removed = c.questions[0].optionDefinitions!.shift()!; c.questions[0].options!.shift(); c.questions[1].condition = { questionId: c.questions[0].id, operator: "equals", value: removed.value, optionId: removed.id }; },
  ];
  for (const mutate of attempts) {
    const content = structuredClone(base); mutate(content);
    await expect(updateForm(ctx, id, { version: 1, content }, randomUUID())).rejects.toMatchObject({ status: 422 });
    expect(await rows()).toEqual(before);
    expect((await readForm(ctx, id)).version).toBe(1);
  }
});

test("removing an unreferenced option only removes that row; same ID cannot reinterpret a published answer", async () => {
  const initial = await rows();
  await db.$transaction(tx => publishForm(tx, ctx, id, { version: 1 }, randomUUID()));
  await db.$transaction(tx => reviseForm(tx, ctx, id, 2, randomUUID()));
  let content = (await readForm(ctx, id)).content!;
  const removed = content.questions[0].optionDefinitions!.pop()!; content.questions[0].options!.pop();
  const before = await rows(); await updateForm(ctx, id, { version: 3, content }, randomUUID());
  expect((await rows()).questions[0].options.map(o => o.id)).toEqual([before.questions[0].options[0].id]);
  content = (await readForm(ctx, id)).content!;
  content.questions[0].options!.push("다른 의미"); content.questions[0].optionDefinitions!.push({ ...removed, value: "다른 의미" });
  await expect(updateForm(ctx, id, { version: 4, content }, randomUUID())).rejects.toMatchObject({ status: 422 });
  expect(await db.questionOption.count({ where: { questionId: initial.questions[0].id } })).toBe(2);
});

test("form copy and template use allocate independent question, option and condition IDs", async () => {
  const content = (await readForm(ctx, id)).content!;
  const option = content.questions[0].optionDefinitions![0];
  content.questions[1].condition = { questionId: content.questions[0].id, operator: "equals", value: option.value, optionId: option.id };
  await updateForm(ctx, id, { version: 1, content }, randomUUID());
  const copied = await db.$transaction(tx => copyForm(tx, ctx, id, undefined, randomUUID()));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId: copied.serviceId, title: "템플릿", category: "일반", content }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId: copied.serviceId }, randomUUID(), tx));
  for (const result of [copied, used]) {
    const q = result.content!.questions;
    expect(q[0].id).not.toBe(content.questions[0].id);
    expect(q[0].optionDefinitions![0].id).not.toBe(option.id);
    expect(q[1].condition).toEqual({ questionId: q[0].id, operator: "equals", value: option.value, optionId: q[0].optionDefinitions![0].id });
  }
  expect(copied.content!.questions[0].optionDefinitions![0].id).not.toBe(used.content!.questions[0].optionDefinitions![0].id);
  const changed = structuredClone(template.content); changed.questions[0].optionDefinitions![0].label = "템플릿의 새 문구";
  const saved = await updateTemplate(ctx, template.id, { version: 1, content: changed }, randomUUID());
  expect(saved.content.questions[0].optionDefinitions![0]).toEqual({ ...option, label: "템플릿의 새 문구" });
  expect((await readForm(ctx, used.id)).content!.questions[0].optionDefinitions![0].label).toBe(option.label);
});

test("legacy template reads derive repeatable option identities without rewriting JSON", async () => {
  const form = await readForm(ctx, id), content = structuredClone(form.content!);
  for (const q of content.questions) delete q.optionDefinitions;
  const row = await db.formTemplate.create({ data: { tenantId: ctx.tenantId, serviceId: form.serviceId, title: "Legacy", category: "일반", content } });
  const first = await getTemplate(ctx, row.id), second = await getTemplate(ctx, row.id);
  expect(first.content).toEqual(second.content);
  expect(first.content.questions[0].optionDefinitions![0].label).toBe("현장");
  expect(await db.formTemplate.findUnique({ where: { id: row.id } })).toEqual(row);
});

test("legacy approval fingerprints remain unchanged and draft metadata upgrade retains physical IDs", async () => {
  const form = await readForm(ctx, id), question = randomUUID();
  const legacy = await db.form.create({ data: { tenantId: ctx.tenantId, serviceId: form.serviceId, ownerId: ctx.user.id, title: "Legacy approval" } });
  const version = await db.formVersion.create({ data: { tenantId: ctx.tenantId, formId: legacy.id, number: 1, title: legacy.title,
    questions: { create: { stableKey: question, type: "객관식 답변", label: "과거 질문", required: true, order: 0,
      options: { create: { value: "과거 값", order: 0 } } } } }, include: versionInclude });
  const projection = contentDto(version); for (const q of projection.questions) delete q.optionDefinitions;
  const priorHash = createHash("sha256").update(JSON.stringify({ title: version.title, content: projection })).digest("hex");
  expect(fingerprint(version)).toBe(priorHash);
  const content = (await readForm(ctx, legacy.id)).content!;
  expect(content.questions[0].optionDefinitions![0].id).toBe(version.questions[0].options[0].id);
  await updateForm(ctx, legacy.id, { version: 1, content }, randomUUID());
  const after = await db.formVersion.findUniqueOrThrow({ where: { id: version.id }, include: versionInclude });
  expect(after.optionSchemaVersion).toBe(1);
  expect(after.questions[0].id).toBe(version.questions[0].id);
  expect(after.questions[0].options[0].id).toBe(version.questions[0].options[0].id);
  expect(fingerprint(after)).not.toBe(priorHash);
});

test("database enforces immutable option identity/value, cross-question ownership and branch identity", async () => {
  const before = await rows(), option = before.questions[0].options[0];
  for (const data of [{ stableKey: randomUUID() }, { stableKey: null, label: null }, { value: "새 값" }, { questionId: before.questions[1].id }])
    await expect(db.questionOption.update({ where: { id: option.id }, data })).rejects.toThrow();
  await expect(db.questionOption.create({ data: { questionId: before.questions[1].id, stableKey: option.stableKey, label: "침범", value: option.value, order: 0 } })).rejects.toThrow();
  await db.question.update({ where: { id: before.questions[1].id }, data: { condition: { questionId: before.questions[0].stableKey, operator: "equals", value: option.value, optionId: randomUUID() } } });
  await expect(db.formVersion.update({ where: { id: before.id }, data: { status: "published" } })).rejects.toThrow();
  expect((await rows()).status).toBe("draft");
});

test("published labels, encrypted answers, correction, sharing and CSV remain bound to the response version", async () => {
  const form = await readForm(ctx, id), content = form.content!, q = content.questions[0], code = randomUUID();
  q.optionDefinitions![0].value = code; q.options![0] = code; q.optionDefinitions![0].id = randomUUID();
  q.optionDefinitions![0].label = "게시 당시 문구";
  await updateForm(ctx, id, { version: 1, content }, randomUUID());
  await db.$transaction(tx => publishForm(tx, ctx, id, { version: 2 }, randomUUID()));
  const published = await db.formVersion.findFirstOrThrow({ where: { formId: id, status: "published" }, include: versionInclude });
  const token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id } })).tokenCipher);
  const submitted = await submitForm(token, { answers: { [q.id]: code }, consent: false }, randomUUID(), randomUUID());
  const submissionId = submitted.body.id;
  const answerRows = await db.answer.findMany({ where: { submissionId }, orderBy: { id: "asc" } });
  await db.$transaction(tx => reviseForm(tx, ctx, id, 3, randomUUID()));
  const draft = (await readForm(ctx, id)).content!; draft.questions[0].optionDefinitions![0].label = "개정 후 문구";
  await updateForm(ctx, id, { version: 4, content: draft }, randomUUID());
  expect((await activePublicForm(token)).content.questions[0].optionDefinitions![0].label).toBe("게시 당시 문구");
  const detail = await getSubmission(ctx, submissionId, randomUUID());
  expect(formatAnswer(detail.values[q.id], undefined, detail.questions[0].optionDefinitions)).toBe("게시 당시 문구");
  const listed = await listSubmissions(ctx, id, 1, 20, randomUUID());
  expect(listed.items[0].questions.find(item => item.id === q.id)!.optionDefinitions[0].label).toBe("게시 당시 문구");
  const share = await db.$transaction(tx => createShare(ctx, { formId: id, formVersionId: published.id, questionIds: [q.id], email: "option-viewer@example.test", expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
  const shared = await db.$transaction(async tx => grantQuestions((await findShare(tx, share.id))!));
  expect(shared[0].optionDefinitions[0].label).toBe("게시 당시 문구");
  const layout = await db.$transaction(tx => exportLayout(tx, ctx.tenantId, id, [published.id]));
  const row = await db.submission.findUniqueOrThrow({ where: { id: submissionId }, include: exportRowInclude });
  const csv = renderExportRow(row, layout, false, new Date());
  expect(csv).toContain("게시 당시 문구"); expect(csv).not.toContain("개정 후 문구"); expect(csv).not.toContain(code);
  expect(await db.answer.findMany({ where: { submissionId }, orderBy: { id: "asc" } })).toEqual(answerRows);
  expect(await db.formVersion.findUnique({ where: { id: published.id }, include: versionInclude })).toEqual(published);
  await correctSubmission(ctx, submissionId, { version: 1, reason: "다른 보기 선택", answers: { [q.id]: "온라인" } }, randomUUID());
  const corrected = await getSubmission(ctx, submissionId, randomUUID());
  expect(formatAnswer(corrected.corrections[0].before![q.id], undefined, corrected.questions[0].optionDefinitions)).toBe("게시 당시 문구");
});

test("normalizer rejects stable option IDs when their question is replaced", () => {
  const original = normalizeQuestionOptions(questions()), changed = structuredClone(original);
  changed[0].id = randomUUID();
  expect(() => normalizeQuestionOptions(changed, original)).toThrow("기존 보기 ID");
});

test("large choice sets can be created and reordered within normal transaction limits", async () => {
  const current = await readForm(ctx, id), content = structuredClone(current.content!);
  content.questions = Array.from({ length: 50 }, (_, i) => ({ id: randomUUID(), type: "드롭다운", label: "질문 " + i, required: false,
    options: Array.from({ length: 80 }, (_, j) => "선택 " + j) }));
  const large = await db.$transaction(tx => createForm(ctx, { serviceId: current.serviceId, title: "4000 choices", content }, randomUUID(), tx));
  const read = await readForm(ctx, large.id), ids = read.content!.questions.flatMap(q => q.optionDefinitions!.map(o => o.id));
  for (const q of read.content!.questions) { q.options!.reverse(); q.optionDefinitions!.reverse(); }
  await updateForm(ctx, large.id, { version: 1, content: read.content! }, randomUUID());
  const saved = await readForm(ctx, large.id);
  expect(saved.content!.questions.flatMap(q => [...q.optionDefinitions!].reverse().map(o => o.id))).toEqual(ids);
  expect(await db.questionOption.count({ where: { question: { formVersion: { formId: large.id } } } })).toBe(4000);
});

test("all five choice types submit stored values and display version-specific labels", async () => {
  const source = await readForm(ctx, id);
  for (const type of choiceTypes) {
    const qid = randomUUID(), rowId = randomUUID(), value = randomUUID();
    const question: QuestionDefinition = { id: qid, type: type as QuestionDefinition["type"], label: "선택 검증", required: true,
      options: [value], optionDefinitions: [{ id: randomUUID(), value, label: "표시할 문구" }],
      ...(type.startsWith("행렬형") ? { rows: [{ id: rowId, label: "행" }] } : {}) };
    const made = await db.$transaction(tx => createForm(ctx, { serviceId: source.serviceId, title: type,
      content: { ...source.content!, questions: [question] } }, randomUUID(), tx));
    await db.$transaction(tx => publishForm(tx, ctx, made.id, { version: 1 }, randomUUID()));
    const token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: made.id } })).tokenCipher);
    const selected = type === "체크박스" ? [value] : type === "행렬형 단일 선택" ? { [rowId]: value } : type === "행렬형 복수 선택" ? { [rowId]: [value] } : value;
    const result = await submitForm(token, submissionInput.parse({ answers: { [qid]: selected }, consent: false }), randomUUID(), randomUUID());
    const response = await getSubmission(ctx, result.body.id, randomUUID());
    expect(response.values[qid]).toEqual(selected);
    expect(formatAnswer(response.values[qid], response.questions[0].rows, response.questions[0].optionDefinitions)).toBe(type.startsWith("행렬형") ? "행: 표시할 문구" : "표시할 문구");
  }
});

test("subject name/email roles can be swapped atomically without replacing question rows", async () => {
  let content = (await readForm(ctx, id)).content!;
  content.questions = content.questions.map((q, i) => ({ ...q, type: "단문형 답변", required: true, subjectRole: i === 0 ? "name" : "email", options: [], optionDefinitions: [] }));
  await updateForm(ctx, id, { version: 1, content }, randomUUID());
  const before = await rows(); content = (await readForm(ctx, id)).content!;
  content.questions[0].subjectRole = "email"; content.questions[1].subjectRole = "name";
  await updateForm(ctx, id, { version: 2, content }, randomUUID());
  const after = await rows();
  expect(after.questions.map(q => q.id)).toEqual(before.questions.map(q => q.id));
  expect(after.questions.map(q => q.subjectRole)).toEqual(["email", "name"]);
});

test("non-choice option metadata cannot reinterpret free-text or date answers", async () => {
  const original = (await readForm(ctx, id)).content!;
  for (const type of ["단문형 답변", "장문형 답변", "날짜", "파일 업로드"] as const) {
    const content = structuredClone(original); content.questions[0].type = type;
    content.questions[0].optionDefinitions![0].label = "실제 입력과 다른 표시";
    await expect(updateForm(ctx, id, { version: 1, content }, randomUUID())).rejects.toMatchObject({ status: 422 });
  }
  expect((await readForm(ctx, id)).version).toBe(1);
});
