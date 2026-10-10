import { randomUUID, createHash } from "node:crypto";
import { beforeEach, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, readForm, updateForm, publishForm, reviseForm, copyForm, fingerprint, contentDto, versionInclude } from "@/server/forms";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import type { FormContent } from "@/contracts/forms";
import type { QuestionDefinition } from "@/contracts/questions";
import { createTemplate, updateTemplate, getTemplate, useTemplate } from "@/server/templates";
import { requestApproval } from "@/server/approvals";
import { submitForm } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { correctSubmission, getSubmission } from "@/server/submission-management";
import { privateConsentReceiptPdf } from "@/server/consent-receipts";
import { consentBundle } from "@/server/form-documents";
import { decrypt } from "@/server/crypto";
import type { ConsentEvidence } from "@/contracts/form-documents";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
let ctx: Context, serviceId: string;
type DescribedQuestion = QuestionDefinition & { additionalExplanation?: string };
type DescribedContent = Omit<FormContent, "questions"> & { questions: DescribedQuestion[] };
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const plain = '\ufeff  앞 공백\n<script>alert("literal")</script>\n<img src="https://example.test/a" onerror="alert(1)"> & < >  ';
beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_question_explanation_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS qa_question_explanation_audit()");
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Explanation QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "explanation-" + randomUUID() + "@example.test", password = "Explanation-test!123";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_question_explanation_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS qa_question_explanation_audit()");
  await db.$disconnect();
});
function content(explanation?: unknown): FormContent {
  return formContentSchema.parse({ body: "기존 폼 안내", questions: [
    { id: randomUUID(), type: "객관식 답변", label: "선택", required: false, options: ["예", "아니오"], ...(explanation === undefined ? {} : { additionalExplanation: explanation }) },
    { id: randomUUID(), type: "단문형 답변", label: "내용", required: false },
  ], font: "16px", bold: false, verify: false, consentRequired: true, consentPurpose: "기존 동의 목적", retentionDays: 30, maxResponses: 100, showSubmitNotice: true });
}
async function fixture(explanation?: unknown) {
  const input = content(explanation);
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "설명 QA", content: input }, randomUUID(), tx));
  return { id: form.id, content: input, ids: input.questions.map(q => q.id) };
}
const stored = (id: string, status: "draft" | "published" = "draft") => db.formVersion.findFirstOrThrow({ where: { formId: id, status }, include: versionInclude, orderBy: { number: "desc" } });
const current = async (id: string) => (await readForm(ctx, id)).content! as DescribedContent;
async function publish(id: string, version: number) {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id, status: "active" } })).tokenCipher);
}
test("accepts literal text, whitespace and exact UTF-16 boundaries while rejecting invalid wire values", () => {
  for (const value of ["", plain, "가".repeat(3000), "😀".repeat(1500), "\r\n\t ", "\ufeff", "a\ufeffb", "e\u0301", "\ufffd"]) {
    const parsed = content(value) as DescribedContent;
    expect(parsed.questions[0].additionalExplanation).toBe(value);
  }
  const invalid: [string, unknown][] = [
    ["BMP UTF-16 overflow", "가".repeat(3001)], ["supplementary UTF-16 overflow", "😀".repeat(1500) + "a"],
    ["NUL", "\0"], ["unpaired high surrogate", "a\ud800b"], ["unpaired low surrogate", "\udc00"],
    ["null", null], ["number", 3], ["array", []], ["object", {}],
  ];
  for (const [name, value] of invalid) {
    expect(() => content(value), name).toThrow();
  }
});
test("stores literal explanation unchanged and exposes the published version through the public DTO", async () => {
  const f = await fixture(plain), draft = await stored(f.id);
  expect(draft.questions[0]).toMatchObject({ additionalExplanation: plain });
  expect((await current(f.id)).questions[0].additionalExplanation).toBe(plain);
  const token = await publish(f.id, 1);
  expect((await activePublicForm(token)).content.questions[0]).toMatchObject({ additionalExplanation: plain });
  const events = await db.auditEvent.findMany({ where: { resourceId: f.id } });
  expect(JSON.stringify(events)).not.toContain(plain);
});
test("legacy null metadata is absent from DTO and keeps the pre-extension approval fingerprint shape", async () => {
  const f = await fixture(), row = await stored(f.id);
  const columns = await db.$queryRaw<{ additionalExplanation: string | null }[]>`SELECT "additionalExplanation" FROM "Question" WHERE "formVersionId"=${row.id}`;
  expect(columns.every(q => q.additionalExplanation === null)).toBe(true);
  const dto = contentDto(row);
  expect(dto.questions.every(q => !("additionalExplanation" in q))).toBe(true);
  const legacy = structuredClone(dto) as DescribedContent;
  legacy.questions.forEach(q => delete q.additionalExplanation);
  expect(fingerprint(row)).toBe(sha(JSON.stringify({ title: row.title, content: legacy, consentBundle: consentBundle(row) })));
});
test("description-only update preserves physical identities, changes the fingerprint and supersedes approval", async () => {
  const f = await fixture("첫 설명"), before = await stored(f.id), hash = fingerprint(before);
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true, approvalRoles: ["owner"] } });
  const approval = await db.$transaction(tx => requestApproval(tx, ctx, f.id, { version: 1, message: "설명 검토", reference: "QA" }, randomUUID()));
  expect(approval.snapshot).toMatchObject({ content: { questions: [{ additionalExplanation: "첫 설명" }, {}] } });
  const value = await current(f.id); value.questions[0].additionalExplanation = "두 번째 설명";
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  const after = await stored(f.id);
  expect(after.questions.map(q => q.id)).toEqual(before.questions.map(q => q.id));
  expect(after.questions[0].options.map(o => o.id)).toEqual(before.questions[0].options.map(o => o.id));
  expect(fingerprint(after)).not.toBe(hash);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "superseded" });
});
test("omitted draft metadata is preserved, explicit empty removes it and never returns on a later omitted save", async () => {
  const f = await fixture("보존 설명"), value = await current(f.id);
  delete value.questions[0].additionalExplanation;
  await updateForm(ctx, f.id, { version: 1, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].additionalExplanation).toBe("보존 설명");
  value.questions[0].additionalExplanation = "";
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].additionalExplanation ?? "").toBe("");
  delete value.questions[0].additionalExplanation;
  await updateForm(ctx, f.id, { version: 3, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].additionalExplanation ?? "").toBe("");
});
test("omitted metadata survives the implicit new draft path and new logical questions inherit nothing", async () => {
  const f = await fixture("게시 설명"), token = await publish(f.id, 1), before = await stored(f.id, "published");
  const value = await current(f.id); delete value.questions[0].additionalExplanation;
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].additionalExplanation).toBe("게시 설명");
  const next = await current(f.id);
  next.questions[0] = { id: randomUUID(), type: "단문형 답변", label: "새 질문", required: false };
  await updateForm(ctx, f.id, { version: 3, content: next }, randomUUID());
  expect((await current(f.id)).questions[0]).not.toHaveProperty("additionalExplanation");
  expect(await stored(f.id, "published")).toEqual(before);
  expect((await activePublicForm(token)).content.questions[0]).toMatchObject({ additionalExplanation: "게시 설명" });
});
test("explicit revise and form/template copies preserve values while allocating only the intended new identities", async () => {
  const f = await fixture(plain), copy = await db.$transaction(tx => copyForm(tx, ctx, f.id, undefined, randomUUID()));
  expect(copy.content!.questions[0]).toMatchObject({ additionalExplanation: plain });
  expect(copy.content!.questions[0].id).not.toBe(f.ids[0]);
  const templateContent = await current(f.id);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "설명 템플릿", category: "QA", content: templateContent }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  expect(used.content!.questions[0]).toMatchObject({ additionalExplanation: plain });
  expect(used.content!.questions[0].id).not.toBe(f.ids[0]);
  await publish(f.id, 1);
  const before = await stored(f.id, "published");
  await db.$transaction(tx => reviseForm(tx, ctx, f.id, 2, randomUUID()));
  const revised = await stored(f.id);
  expect(revised.questions[0]).toMatchObject({ stableKey: f.ids[0], additionalExplanation: plain });
  expect(revised.questions[0].id).not.toBe(before.questions[0].id);
  expect(await stored(f.id, "published")).toEqual(before);
});
test("template updates preserve omitted descriptions and explicit clearing stays cleared when used", async () => {
  const input = content("템플릿 설명"), template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "템플릿", category: "QA", content: input }, randomUUID(), tx));
  const value = structuredClone(template.content) as DescribedContent; delete value.questions[0].additionalExplanation;
  await updateTemplate(ctx, template.id, { version: 1, content: value }, randomUUID());
  expect((await getTemplate(ctx, template.id)).content.questions[0]).toMatchObject({ additionalExplanation: "템플릿 설명" });
  value.questions[0].additionalExplanation = "";
  await updateTemplate(ctx, template.id, { version: 2, content: value }, randomUUID());
  delete value.questions[0].additionalExplanation;
  await updateTemplate(ctx, template.id, { version: 3, content: value }, randomUUID());
  const used = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 4, serviceId }, randomUUID(), tx));
  expect((used.content!.questions[0] as DescribedQuestion).additionalExplanation ?? "").toBe("");
});
test("legacy template JSON is read without adding empty description keys or rewriting its stored payload", async () => {
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "구 템플릿", category: "QA", content: content() }, randomUUID(), tx));
  const before = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  for (let i = 0; i < 2; i++) expect((await getTemplate(ctx, template.id)).content.questions.every(q => !("additionalExplanation" in q))).toBe(true);
  expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(before);
});
test("database counts supplementary code points as two UTF-16 units and protects published metadata", async () => {
  const f = await fixture(), q = (await stored(f.id)).questions[0], exact = "😀".repeat(1500);
  await db.$executeRaw`UPDATE "Question" SET "additionalExplanation"=${exact} WHERE id=${q.id}`;
  expect((await current(f.id)).questions[0].additionalExplanation).toBe(exact);
  for (const value of [exact + "a", "가".repeat(3001)])
    await expect(db.$executeRaw`UPDATE "Question" SET "additionalExplanation"=${value} WHERE id=${q.id}`).rejects.toThrow();
  expect((await current(f.id)).questions[0].additionalExplanation).toBe(exact);
  // This field is not PDF receipt content; unsupported emoji in an explanation must not block publish.
  await publish(f.id, 1);
  await expect(db.$executeRaw`UPDATE "Question" SET "additionalExplanation"='changed' WHERE id=${q.id}`).rejects.toThrow();
  expect((await stored(f.id, "published")).questions[0]).toMatchObject({ additionalExplanation: exact });
});
test("stale versions and revoked current authority never alter descriptions or create update audits", async () => {
  const f = await fixture("원래 설명"), before = await stored(f.id), value = await current(f.id); value.questions[0].additionalExplanation = "거절 설명";
  const count = () => db.auditEvent.count({ where: { resourceId: f.id, action: "form.draft_updated" } });
  await expect(updateForm(ctx, f.id, { version: 999, content: value }, randomUUID())).rejects.toMatchObject({ status: 409 });
  const remainingOwner = await db.user.create({ data: { id: randomUUID(), email: "remaining-owner-" + randomUUID() + "@example.test", name: "QA remaining owner", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: remainingOwner.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(updateForm(ctx, f.id, { version: 1, content: value }, randomUUID())).rejects.toMatchObject({ status: 403 });
  expect(await stored(f.id)).toEqual(before); expect(await count()).toBe(0);
});
test.each(["form", "template"] as const)("%s explanation changes and version increments roll back when audit insertion fails", async kind => {
  const f = await fixture("이전"), templateContent = await current(f.id);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "감사 템플릿", category: "QA", content: templateContent }, randomUUID(), tx));
  const before = await stored(f.id), beforeTemplate = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  const value = await current(f.id); value.questions[0].additionalExplanation = "실패 후 남으면 안 됨";
  await db.$executeRawUnsafe("CREATE FUNCTION qa_question_explanation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('form.draft_updated','template.updated') THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER qa_question_explanation_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_question_explanation_audit()');
  try {
    await expect(kind === "form" ? updateForm(ctx, f.id, { version: 1, content: value }, randomUUID()) : updateTemplate(ctx, template.id, { version: 1, content: value }, randomUUID())).rejects.toThrow();
    expect(await stored(f.id)).toEqual(before);
    expect((await readForm(ctx, f.id)).version).toBe(1);
    expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(beforeTemplate);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER qa_question_explanation_audit ON "AuditEvent"');
    await db.$executeRawUnsafe("DROP FUNCTION qa_question_explanation_audit()");
  }
});
test("old response corrections and receipt evidence/bytes stay bound to the original published form", async () => {
  const description = "QUESTION-EXPLANATION-NOT-RECEIPT", f = await fixture(description), token = await publish(f.id, 1);
  const submitted = await submitForm(token, submissionInput.parse({ answers: { [f.ids[1]]: "이전 응답" }, consent: true }), randomUUID(), randomUUID());
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: submitted.body.id } });
  const bytes = Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64"), evidence = decrypt<ConsentEvidence>(receipt.evidenceCipher!);
  expect(JSON.stringify(evidence)).not.toContain(description);
  expect(evidence).not.toHaveProperty("questionExplanations");
  expect(sha(bytes)).toBe(receipt.pdfHash);
  const value = await current(f.id); value.questions[0].additionalExplanation = "새 게시 설명";
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID()); await publish(f.id, 3);
  await correctSubmission(ctx, submitted.body.id, { version: 1, reason: "값만 정정", answers: { [f.ids[1]]: "정정 응답" } }, randomUUID());
  const detail = await getSubmission(ctx, submitted.body.id, randomUUID());
  expect(detail.questions[0]).toMatchObject({ additionalExplanation: description });
  expect(detail.values[f.ids[1]]).toBe("정정 응답");
  expect(await db.consentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
  const download = await privateConsentReceiptPdf(ctx, submitted.body.id, receipt.id, randomUUID());
  expect(Buffer.from(download.bytes)).toEqual(bytes);
});
