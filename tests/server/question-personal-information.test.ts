import { randomUUID, createHash } from "node:crypto";
import { Client } from "pg";
import { beforeEach, afterAll, expect, test } from "vitest";
import { z } from "zod";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm, updateForm, publishForm, reviseForm, copyForm, fingerprint, contentDto, versionInclude } from "@/server/forms";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import type { FormContent } from "@/contracts/forms";
import { choiceTypes, type QuestionDefinition } from "@/contracts/questions";
import { formLanguageCodes } from "@/contracts/form-language";
import { createTemplate, updateTemplate, getTemplate, useTemplate } from "@/server/templates";
import { requestApproval } from "@/server/approvals";
import { submitForm } from "@/server/submissions";
import { createFixedUrl } from "@/server/fixed-urls";
import { activeFixedUrl, activePublicForm } from "../helpers/public-form";
import { correctSubmission, getSubmission } from "@/server/submission-management";
import { privateConsentReceiptPdf } from "@/server/consent-receipts";
import { consentBundle } from "@/server/form-documents";
import { decrypt } from "@/server/crypto";
import type { ConsentEvidence } from "@/contracts/form-documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
let ctx: Context, serviceId: string;
// The RED phase uses the existing schema/server instead of importing a not-yet-created helper.
const classificationTypes = ["PERSONAL_INFORMATION", "SENSITIVE", "IDENTIFICATION", "RESIDENT", "NON_PERSONAL_INFORMATION"] as const;
type Classification = { nlpFeedbackId: null; personalInformationType: typeof classificationTypes[number]; detectedPersonalInformation: string; personalInformationSource: "USER" };
type ClassifiedQuestion = QuestionDefinition & { catchFormPersonalInformationRequests?: Classification[] };
type ClassifiedContent = Omit<FormContent, "questions"> & { questions: ClassifiedQuestion[] };
const info = (personalInformationType: Classification["personalInformationType"] = "PERSONAL_INFORMATION", detectedPersonalInformation = "이름"): Classification =>
  ({ nlpFeedbackId: null, personalInformationType, detectedPersonalInformation, personalInformationSource: "USER" });
const list = () => [info("PERSONAL_INFORMATION", '  <자료> & "원문"  '), info("NON_PERSONAL_INFORMATION", ""), info("PERSONAL_INFORMATION", '  <자료> & "원문"  ')];
const trimWhitespace = ["\t", "\n", "\v", "\f", "\r", " ", "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005",
  "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"];
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await task.promise; let text = "";
    for (let page = 1; page <= pdf.numPages; page++)
      text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" ");
    return text;
  } finally { await task.destroy(); }
}
beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_question_personal_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS qa_question_personal_audit()");
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Manual classification QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "classification-" + randomUUID() + "@example.test", password = "Classification-test!123";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_question_personal_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS qa_question_personal_audit()");
  await db.$disconnect();
});
function content(classifications?: unknown, overrides: Partial<QuestionDefinition> = {}): ClassifiedContent {
  const type = overrides.type ?? "객관식 답변";
  return formContentSchema.parse({ body: "기존 폼 안내", questions: [
    { id: randomUUID(), type, label: "선택", required: false,
      ...(choiceTypes.includes(type) ? { options: ["예", "아니오"] } : {}),
      ...(type.startsWith("행렬형") ? { rows: [{ id: randomUUID(), label: "첫 행" }] } : {}),
      additionalExplanation: "그대로 유지하는 설명",
      materialList: [{ materialType: "LINK", orderNumber: 0, fileKey: null, linkLabel: "기존 자료", linkUrl: "https://example.test/reference" }],
      ...overrides, ...(classifications === undefined ? {} : { catchFormPersonalInformationRequests: classifications }) },
    { id: randomUUID(), type: "단문형 답변", label: "내용", required: false },
  ], font: "16px", bold: false, verify: false, consentRequired: true, consentPurpose: "기존 동의 목적", retentionDays: 30, maxResponses: 100, showSubmitNotice: true }) as ClassifiedContent;
}
async function fixture(classifications?: unknown, overrides: Partial<QuestionDefinition> = {}) {
  const input = content(classifications, overrides);
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "수동 분류 QA", content: input }, randomUUID(), tx));
  return { id: form.id, content: input, ids: input.questions.map(q => q.id) };
}
const stored = (id: string, status: "draft" | "published" = "draft") => db.formVersion.findFirstOrThrow({ where: { formId: id, status }, include: versionInclude, orderBy: { number: "desc" } });
const current = async (id: string) => (await readForm(ctx, id)).content! as ClassifiedContent;
async function publish(id: string, version: number) {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id, status: "active" } })).tokenCipher);
}

test("all five USER classifications preserve exact order, duplicate entries and mixed NONE up to twenty items", () => {
  const values = classificationTypes.map(type => info(type, type === "NON_PERSONAL_INFORMATION" ? "" : "  항목 이름  "));
  expect(content(values, { required: true }).questions[0].catchFormPersonalInformationRequests).toEqual(values);
  const twenty = Array.from({ length: 20 }, () => info("NON_PERSONAL_INFORMATION", ""));
  expect(content(twenty).questions[0].catchFormPersonalInformationRequests).toEqual(twenty);
  expect(content(list()).questions[0].catchFormPersonalInformationRequests).toEqual(list());
  expect(content([]).questions[0].catchFormPersonalInformationRequests).toEqual([]);
  expect(() => content([...twenty, info("NON_PERSONAL_INFORMATION", "")])).toThrow();
  expect(() => z.toJSONSchema(formContentSchema)).not.toThrow();
});
test("classification names preserve whitespace and valid Unicode but enforce fifty UTF-16 units and NONE exact empty", () => {
  for (const name of ["가".repeat(50), "😀".repeat(25), "\ufeff  이름  ", "\u00a0이름\u3000", "e\u0301", "\ufffd", ' <script>alert(1)</script> '])
    expect(content([info("SENSITIVE", name)]).questions[0].catchFormPersonalInformationRequests![0].detectedPersonalInformation).toBe(name);
  for (const name of ["가".repeat(51), "😀".repeat(25) + "a", "", ...trimWhitespace, " \t\n\ufeff", "a\0b", "a\ud800b", "\udc00"])
    expect(() => content([info("SENSITIVE", name)]), JSON.stringify(name)).toThrow();
  for (const name of [" ", "일반 항목", "\ufeff"]) expect(() => content([info("NON_PERSONAL_INFORMATION", name)])).toThrow();
});
test("strict four-key JSON rejects forged NLP sources, feedback IDs, unsupported enums and malformed values", () => {
  const { nlpFeedbackId: _feedback, ...missingFeedback } = info(); void _feedback;
  const { personalInformationSource: _source, ...missingSource } = info(); void _source;
  for (const value of [null, {}, "classification", [{ ...info(), personalInformationSource: "NLP" }], [{ ...info(), personalInformationSource: "AUTO" }],
    [{ ...info(), nlpFeedbackId: randomUUID() }], [{ ...info(), personalInformationType: "NONE" }], [{ ...info(), personalInformationType: null }],
    [{ ...info(), detectedPersonalInformation: null }], [{ ...info(), detectedPersonalInformation: 3 }], [{ ...info(), confirmed: true }], [missingFeedback], [missingSource]])
    expect(() => content(value), JSON.stringify(value)).toThrow();
});
test("both matrix types permit only NONE and reject typed-server bypasses without creating a form", async () => {
  for (const type of ["행렬형 단일 선택", "행렬형 복수 선택"] as const) {
    const good = content([info("NON_PERSONAL_INFORMATION", "")], { type });
    const created = await db.$transaction(tx => createForm(ctx, { serviceId, title: "행렬 분류", content: good }, randomUUID(), tx));
    expect((await current(created.id)).questions[0]).toMatchObject({ type, catchFormPersonalInformationRequests: [info("NON_PERSONAL_INFORMATION", "")] });
    for (const kind of classificationTypes.filter(kind => kind !== "NON_PERSONAL_INFORMATION"))
      expect(() => content([info(kind)], { type, required: true })).toThrow();
    const bad = structuredClone(good); bad.questions[0].catchFormPersonalInformationRequests = [info()];
    const before = await db.form.count();
    await expect(db.$transaction(tx => createForm(ctx, { serviceId, title: "거절 행렬", content: bad }, randomUUID(), tx))).rejects.toMatchObject({ status: 422 });
    expect(await db.form.count()).toBe(before);
  }
});
test("RESIDENT requires explicit required true without changing question type or automatically clearing required later", async () => {
  expect(() => content([info("RESIDENT", "주민번호")])).toThrow();
  const bypass = content(); bypass.questions[0].catchFormPersonalInformationRequests = [info("RESIDENT", "주민번호")];
  await expect(db.$transaction(tx => createForm(ctx, { serviceId, title: "거절 주민번호", content: bypass }, randomUUID(), tx))).rejects.toMatchObject({ status: 422 });
  const f = await fixture([info("RESIDENT", "주민번호")], { type: "단문형 답변", required: true }), value = await current(f.id);
  expect(value.questions[0]).toMatchObject({ type: "단문형 답변", required: true });
  expect(value.questions[0]).not.toHaveProperty("subjectRole");
  value.questions[0].catchFormPersonalInformationRequests = [];
  await updateForm(ctx, f.id, { version: 1, content: value }, randomUUID());
  expect((await current(f.id)).questions[0]).toMatchObject({ type: "단문형 답변", required: true });
});
test("admin classification preserves raw metadata while public and fixed-URL JSON omit it without changing other fields", async () => {
  const f = await fixture(list()), row = await stored(f.id);
  expect(row.questions[0]).toMatchObject({ catchFormPersonalInformationRequests: list(), subjectRole: null, additionalExplanation: "그대로 유지하는 설명" });
  expect((await current(f.id)).questions[0]).toMatchObject({ catchFormPersonalInformationRequests: list(), materialList: f.content.questions[0].materialList });
  const token = await publish(f.id, 1);
  const fixed = await db.$transaction(tx => createFixedUrl(ctx, { name: "공개 분류 경계", formId: f.id }, randomUUID(), tx));
  for (const publicRecord of [await activePublicForm(token), await activeFixedUrl(fixed.slug)]) {
    expect(publicRecord.consentBundle?.collectedItems).toEqual([
      { type: "PERSONAL_INFORMATION", name: '  <자료> & "원문"  ' },
      { type: "PERSONAL_INFORMATION", name: '  <자료> & "원문"  ' },
    ]);
    const publicContent = publicRecord.content;
    const json = JSON.parse(JSON.stringify(publicContent));
    expect(json.questions.every((q: Record<string, unknown>) => !("catchFormPersonalInformationRequests" in q))).toBe(true);
    expect(json.questions[0]).toMatchObject({ additionalExplanation: "그대로 유지하는 설명", materialList: f.content.questions[0].materialList });
    expect(json.consentPurpose).toBe("기존 동의 목적");
  }
  expect(JSON.stringify(await db.auditEvent.findMany({ where: { resourceId: f.id } }))).not.toContain(list()[0].detectedPersonalInformation);
});
test("legacy null omits the new DTO key and preserves approval fingerprints and stored template JSON", async () => {
  const f = await fixture(), row = await stored(f.id);
  expect(row).toMatchObject({ consentItemSchemaVersion: 0, consentItems: null });
  expect(consentBundle(row)).not.toHaveProperty("collectedItems");
  const columns = await db.$queryRaw<{ catchFormPersonalInformationRequests: unknown }[]>`SELECT "catchFormPersonalInformationRequests" FROM "Question" WHERE "formVersionId"=${row.id}`;
  expect(columns.every(q => q.catchFormPersonalInformationRequests === null)).toBe(true);
  const dto = contentDto(row) as ClassifiedContent; expect(dto.questions.every(q => !("catchFormPersonalInformationRequests" in q))).toBe(true);
  const legacy = structuredClone(dto); legacy.questions.forEach(q => delete q.catchFormPersonalInformationRequests);
  expect(fingerprint(row)).toBe(sha(JSON.stringify({ title: row.title, content: legacy, consentBundle: consentBundle(row) })));
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "기존 분류 없는 양식", category: "QA", content: content() }, randomUUID(), tx));
  const before = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  for (let i = 0; i < 2; i++) expect((await getTemplate(ctx, template.id)).content.questions.every(q => !("catchFormPersonalInformationRequests" in q))).toBe(true);
  expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(before);
});
test("classification-only reorder and edits preserve physical IDs and invalidate an unchanged approval snapshot", async () => {
  const f = await fixture(list()), before = await stored(f.id), originalHash = fingerprint(before);
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true, approvalRoles: ["owner"] } });
  const approval = await db.$transaction(tx => requestApproval(tx, ctx, f.id, { version: 1, message: "분류 검토", reference: "QA" }, randomUUID()));
  expect(approval.snapshot).toMatchObject({ content: { questions: [{ catchFormPersonalInformationRequests: list() }, {}] } });
  const value = await current(f.id), reordered = [info("NON_PERSONAL_INFORMATION", ""), info("SENSITIVE", "수정 항목"), info()];
  value.questions[0].catchFormPersonalInformationRequests = reordered;
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  const after = await stored(f.id);
  expect(after.questions.map(q => q.id)).toEqual(before.questions.map(q => q.id));
  expect(after.questions[0].options.map(o => o.id)).toEqual(before.questions[0].options.map(o => o.id));
  expect(after.questions[0]).toMatchObject({ catchFormPersonalInformationRequests: reordered });
  expect(fingerprint(after)).not.toBe(originalHash);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "superseded", snapshot: approval.snapshot });
});
test("old-client omission preserves current classification while explicit empty clears it permanently", async () => {
  const f = await fixture(list()), value = await current(f.id); delete value.questions[0].catchFormPersonalInformationRequests;
  await updateForm(ctx, f.id, { version: 1, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].catchFormPersonalInformationRequests).toEqual(list());
  value.questions[0].catchFormPersonalInformationRequests = [];
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID()); delete value.questions[0].catchFormPersonalInformationRequests;
  await updateForm(ctx, f.id, { version: 3, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].catchFormPersonalInformationRequests ?? []).toEqual([]);
});
test("implicit draft omission preserves current values but replaced logical questions inherit no classification", async () => {
  const f = await fixture(list()); await publish(f.id, 1); const before = await stored(f.id, "published");
  const value = await current(f.id); delete value.questions[0].catchFormPersonalInformationRequests;
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].catchFormPersonalInformationRequests).toEqual(list());
  const next = await current(f.id); next.questions[0] = { id: randomUUID(), type: "단문형 답변", label: "새 질문", required: false };
  await updateForm(ctx, f.id, { version: 3, content: next }, randomUUID());
  expect((await current(f.id)).questions[0]).not.toHaveProperty("catchFormPersonalInformationRequests");
  expect(await stored(f.id, "published")).toEqual(before);
});
test("omitted stored RESIDENT and matrix-incompatible classifications are revalidated after draft and template merges", async () => {
  const f = await fixture([info("RESIDENT", "주민번호")], { required: true }), value = await current(f.id);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "주민번호 양식", category: "QA", content: value }, randomUUID(), tx));
  const before = await stored(f.id), beforeTemplate = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  delete value.questions[0].catchFormPersonalInformationRequests;
  for (const mutation of ["required", "matrix"] as const) {
    const bad = structuredClone(value);
    if (mutation === "required") bad.questions[0].required = false;
    else { bad.questions[0].type = "행렬형 단일 선택"; bad.questions[0].rows = [{ id: randomUUID(), label: "행" }]; }
    await expect(updateForm(ctx, f.id, { version: 1, content: bad }, randomUUID())).rejects.toMatchObject({ status: 422 });
    await expect(updateTemplate(ctx, template.id, { version: 1, content: bad }, randomUUID())).rejects.toMatchObject({ status: 422 });
    expect(await stored(f.id)).toEqual(before); expect((await readForm(ctx, f.id)).version).toBe(1);
    expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(beforeTemplate);
  }
  expect(await db.auditEvent.count({ where: { action: { in: ["form.draft_updated", "template.updated"] } } })).toBe(0);
});
test("classification and old-client required edits race under the same form lock with one winner and a valid merged state", async () => {
  const f = await fixture([], { required: true }), classified = await current(f.id), oldClient = structuredClone(classified);
  classified.questions[0].catchFormPersonalInformationRequests = [info("RESIDENT", "주민번호")];
  delete oldClient.questions[0].catchFormPersonalInformationRequests; oldClient.questions[0].required = false;
  const holder = new Client({ connectionString: env.DATABASE_URL, application_name: "classification-race-barrier" });
  await holder.connect();
  let pending: Promise<number[]> | undefined;
  try {
    await holder.query("BEGIN"); await holder.query('SELECT id FROM "Form" WHERE id=$1 FOR UPDATE', [f.id]);
    pending = Promise.all([classified, oldClient].map(value => updateForm(ctx, f.id, { version: 1, content: value }, randomUUID()).then(() => 200, error => Number(error.status))));
    const until = Date.now() + 2000; let waiting = 0;
    while (Date.now() < until) {
      await holder.query("SELECT pg_stat_clear_snapshot()");
      const result = await holder.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%FROM "Form"%' AND pid<>pg_backend_pid()`);
      waiting = Number(result.rows[0].count); if (waiting >= 2) break;
      await new Promise(done => setTimeout(done, 25));
    }
    await holder.query("COMMIT");
    const statuses = await pending; expect(waiting).toBeGreaterThanOrEqual(2); expect([...statuses].sort()).toEqual([200, 409]);
    const row = await readForm(ctx, f.id), question = (row.content! as ClassifiedContent).questions[0];
    expect(row.version).toBe(2);
    if (statuses[0] === 200) expect(question).toMatchObject({ required: true, catchFormPersonalInformationRequests: [info("RESIDENT", "주민번호")] });
    else { expect(question.required).toBe(false); expect(question.catchFormPersonalInformationRequests ?? []).toEqual([]); }
    expect(await db.auditEvent.count({ where: { action: "form.draft_updated", resourceId: f.id } })).toBe(1);
  } finally { await holder.query("ROLLBACK").catch(() => undefined); await holder.end(); if (pending) await pending; }
});
test("form copy, revise and template use preserve manual classifications with independent copied identities and explicit clearing", async () => {
  const f = await fixture(list()), copy = await db.$transaction(tx => copyForm(tx, ctx, f.id, undefined, randomUUID()));
  expect(copy.content!.questions[0]).toMatchObject({ catchFormPersonalInformationRequests: list() }); expect(copy.content!.questions[0].id).not.toBe(f.ids[0]);
  expect(copy.consentBundle?.collectedItems).toEqual([{ type: "PERSONAL_INFORMATION", name: '  <자료> & "원문"  ' }, { type: "PERSONAL_INFORMATION", name: '  <자료> & "원문"  ' }]);
  const templateContent = await current(f.id);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "수동 분류 양식", category: "QA", content: templateContent }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  expect(used.content!.questions[0]).toMatchObject({ catchFormPersonalInformationRequests: list() }); expect(used.content!.questions[0].id).not.toBe(f.ids[0]);
  expect(used.consentBundle?.collectedItems).toEqual(copy.consentBundle?.collectedItems);
  const omitted = structuredClone(template.content) as ClassifiedContent; delete omitted.questions[0].catchFormPersonalInformationRequests;
  await updateTemplate(ctx, template.id, { version: 1, content: omitted }, randomUUID());
  expect((await getTemplate(ctx, template.id)).content.questions[0]).toMatchObject({ catchFormPersonalInformationRequests: list() });
  omitted.questions[0].catchFormPersonalInformationRequests = [];
  await updateTemplate(ctx, template.id, { version: 2, content: omitted }, randomUUID()); delete omitted.questions[0].catchFormPersonalInformationRequests;
  await updateTemplate(ctx, template.id, { version: 3, content: omitted }, randomUUID());
  expect(((await getTemplate(ctx, template.id)).content.questions[0] as ClassifiedQuestion).catchFormPersonalInformationRequests ?? []).toEqual([]);
  await publish(f.id, 1); const before = await stored(f.id, "published"); await db.$transaction(tx => reviseForm(tx, ctx, f.id, 2, randomUUID()));
  const revised = await stored(f.id);
  expect(revised.questions[0]).toMatchObject({ stableKey: f.ids[0], catchFormPersonalInformationRequests: list() });
  expect(consentBundle(revised).collectedItems).toEqual(copy.consentBundle?.collectedItems);
  expect(revised.questions[0].id).not.toBe(before.questions[0].id); expect(await stored(f.id, "published")).toEqual(before);
});

test("version projection preserves question and item order, duplicates and reviewed NONE while database rejects drift", async () => {
  const classifications = [info("SENSITIVE", "건강정보"), info("NON_PERSONAL_INFORMATION", ""), info("IDENTIFICATION", "운전면허번호"), info("SENSITIVE", "건강정보")];
  const input = content(classifications, { required: true });
  input.questions[1].catchFormPersonalInformationRequests = [info("NON_PERSONAL_INFORMATION", "")];
  input.questions.push({ id: randomUUID(), type: "단문형 답변", label: "마지막", required: false,
    catchFormPersonalInformationRequests: [info("PERSONAL_INFORMATION", "별명")] });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "자동 집계 순서", content: input }, randomUUID(), tx));
  const row = await stored(form.id);
  const expected = [
    { type: "SENSITIVE", name: "건강정보" }, { type: "IDENTIFICATION", name: "운전면허번호" },
    { type: "SENSITIVE", name: "건강정보" }, { type: "PERSONAL_INFORMATION", name: "별명" },
  ];
  expect(row).toMatchObject({ consentItemSchemaVersion: 1, consentItems: expected });
  expect(consentBundle(row).collectedItems).toEqual(expected);
  await expect(db.$transaction(async tx => {
    await tx.formVersion.update({ where: { id: row.id }, data: { consentItems: [{ type: "PERSONAL_INFORMATION", name: "조작" }] } });
  })).rejects.toThrow(/form consent items do not match question classifications/);
  await expect(db.$transaction(async tx => {
    await tx.question.update({ where: { id: row.questions[0].id }, data: { catchFormPersonalInformationRequests: [info("SENSITIVE", "변조")] } });
  })).rejects.toThrow(/form consent items do not match question classifications/);
  expect(await stored(form.id)).toMatchObject({ consentItemSchemaVersion: 1, consentItems: expected });
});
test("all sixteen form language changes and question label edits preserve manual classifications without reassessment", async () => {
  const f = await fixture(list()); let version = 1;
  expect(formLanguageCodes).toHaveLength(16);
  for (const language of formLanguageCodes) {
    const value = await current(f.id); value.formLanguage = language; value.questions[0].label = "수정 질문 " + language;
    delete value.questions[0].catchFormPersonalInformationRequests;
    await updateForm(ctx, f.id, { version: version++, content: value }, randomUUID());
    expect((await current(f.id)).questions[0].catchFormPersonalInformationRequests).toEqual(list());
  }
});
test("database validates JSON shape, USER/null evidence, UTF-16 names, NONE, matrix and RESIDENT required invariants", async () => {
  const f = await fixture(), q = (await stored(f.id)).questions[0], exact = [info("SENSITIVE", "😀".repeat(25))];
  await db.$executeRaw`UPDATE "Question" SET "catchFormPersonalInformationRequests"=${JSON.stringify(exact)}::jsonb WHERE id=${q.id}`;
  expect((await current(f.id)).questions[0].catchFormPersonalInformationRequests).toEqual(exact);
  const invalid: unknown[] = [null, {}, "item", Array.from({ length: 21 }, () => info()), [{ ...info(), extra: true }],
    [{ ...info(), nlpFeedbackId: randomUUID() }], [{ ...info(), personalInformationSource: "NLP" }], [{ ...info(), personalInformationType: "NONE" }],
    [{ personalInformationType: "PERSONAL_INFORMATION", detectedPersonalInformation: "이름", personalInformationSource: "USER" }],
    [{ ...info(), detectedPersonalInformation: null }], [info("SENSITIVE", "😀".repeat(25) + "a")], [info("SENSITIVE", "가".repeat(51))],
    ...trimWhitespace.map(name => [info("SENSITIVE", name)]), [info("SENSITIVE", " \t\n\ufeff")], [info("NON_PERSONAL_INFORMATION", " ")], [info("RESIDENT", "주민번호")]];
  for (const value of invalid) await expect(db.$executeRaw`UPDATE "Question" SET "catchFormPersonalInformationRequests"=${JSON.stringify(value)}::jsonb WHERE id=${q.id}`, JSON.stringify(value)).rejects.toThrow();
  expect((await current(f.id)).questions[0].catchFormPersonalInformationRequests).toEqual(exact);
  await db.$executeRaw`UPDATE "Question" SET required=true, "catchFormPersonalInformationRequests"=${JSON.stringify([info("RESIDENT", "주민번호")])}::jsonb WHERE id=${q.id}`;
  await expect(db.$executeRaw`UPDATE "Question" SET required=false WHERE id=${q.id}`).rejects.toThrow();
  const rows = [{ id: randomUUID(), label: "행" }];
  await db.$executeRaw`UPDATE "Question" SET type='행렬형 단일 선택', "matrixRows"=${JSON.stringify(rows)}::jsonb,
    "catchFormPersonalInformationRequests"=${JSON.stringify([info("NON_PERSONAL_INFORMATION", "")])}::jsonb WHERE id=${q.id}`;
  await expect(db.$executeRaw`UPDATE "Question" SET "catchFormPersonalInformationRequests"=${JSON.stringify([info()])}::jsonb WHERE id=${q.id}`).rejects.toThrow();
});
test("published classification cannot be changed or erased by direct SQL", async () => {
  const f = await fixture(list()); await publish(f.id, 1); const before = await stored(f.id, "published"), q = before.questions[0];
  for (const value of [[], [info("SENSITIVE", "새 항목")]]) await expect(db.$executeRaw`UPDATE "Question" SET "catchFormPersonalInformationRequests"=${JSON.stringify(value)}::jsonb WHERE id=${q.id}`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "Question" SET "catchFormPersonalInformationRequests"=NULL WHERE id=${q.id}`).rejects.toThrow();
  expect(await stored(f.id, "published")).toEqual(before);
});
test("version conflict and revoked authority reject classification changes without data or audit mutations", async () => {
  const f = await fixture(list()), before = await stored(f.id), value = await current(f.id); value.questions[0].catchFormPersonalInformationRequests = [info("SENSITIVE", "거절 항목")];
  await expect(updateForm(ctx, f.id, { version: 999, content: value }, randomUUID())).rejects.toMatchObject({ status: 409 });
  const owner = await db.user.create({ data: { id: randomUUID(), email: "remaining-owner-" + randomUUID() + "@example.test", name: "QA owner", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: owner.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(updateForm(ctx, f.id, { version: 1, content: value }, randomUUID())).rejects.toMatchObject({ status: 403 });
  expect(await stored(f.id)).toEqual(before); expect(await db.auditEvent.count({ where: { action: "form.draft_updated", resourceId: f.id } })).toBe(0);
});
test.each(["form", "template"] as const)("%s classification changes and version increments roll back when auditing fails", async kind => {
  const f = await fixture(list()), templateContent = await current(f.id);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "감사 분류 양식", category: "QA", content: templateContent }, randomUUID(), tx));
  const before = await stored(f.id), beforeTemplate = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  const value = await current(f.id); value.questions[0].catchFormPersonalInformationRequests = [info("SENSITIVE", "남으면 안 되는 항목")];
  await db.$executeRawUnsafe("CREATE FUNCTION qa_question_personal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('form.draft_updated','template.updated') THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER qa_question_personal_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_question_personal_audit()');
  try {
    await expect(kind === "form" ? updateForm(ctx, f.id, { version: 1, content: value }, randomUUID()) : updateTemplate(ctx, template.id, { version: 1, content: value }, randomUUID())).rejects.toThrow();
    expect(await stored(f.id)).toEqual(before); expect((await readForm(ctx, f.id)).version).toBe(1);
    expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(beforeTemplate);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER qa_question_personal_audit ON "AuditEvent"');
    await db.$executeRawUnsafe("DROP FUNCTION qa_question_personal_audit()");
  }
});
test("old response correction keeps the published consent item snapshot and PDF bytes after a newer classification", async () => {
  const values = [info("SENSITIVE", "기존 건강정보")], f = await fixture(values), token = await publish(f.id, 1);
  const submitted = await submitForm(token, submissionInput.parse({ answers: { [f.ids[1]]: "이전 응답" }, consent: true }), randomUUID(), randomUUID());
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: submitted.body.id } });
  const bytes = Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64"), evidence = decrypt<ConsentEvidence>(receipt.evidenceCipher!);
  expect(evidence.bundle.collectedItems).toEqual([{ type: "SENSITIVE", name: "기존 건강정보" }]);
  const receiptText = await pdfText(bytes); expect(receiptText).toContain("기존 건강정보");
  expect(JSON.stringify(evidence)).not.toContain("catchFormPersonalInformationRequests"); expect(sha(bytes)).toBe(receipt.pdfHash);
  const value = await current(f.id); value.questions[0].catchFormPersonalInformationRequests = [info("IDENTIFICATION", "새 버전 항목")];
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID()); await publish(f.id, 3);
  await correctSubmission(ctx, submitted.body.id, { version: 1, reason: "답변만 정정", answers: { [f.ids[1]]: "정정 응답" } }, randomUUID());
  const detail = await getSubmission(ctx, submitted.body.id, randomUUID());
  expect(detail.questions[0]).toMatchObject({ catchFormPersonalInformationRequests: values });
  expect(detail.questions[0]).not.toHaveProperty("subjectRole"); expect(detail.values[f.ids[1]]).toBe("정정 응답");
  expect(JSON.stringify(evidence)).not.toContain("새 버전 항목"); expect(receiptText).not.toContain("새 버전 항목");
  expect(await db.consentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
  expect(Buffer.from((await privateConsentReceiptPdf(ctx, submitted.body.id, receipt.id, randomUUID())).bytes)).toEqual(bytes);
});
