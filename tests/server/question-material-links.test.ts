import { randomUUID, createHash } from "node:crypto";
import { beforeEach, afterAll, expect, test, vi } from "vitest";
import { z } from "zod";
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
// Keep RED executable before the new schema/helper exists; the wire contract remains explicit.
type MaterialLink = { materialType: "LINK"; orderNumber: number; fileKey: null; linkLabel: string; linkUrl: string };
type MaterialQuestion = QuestionDefinition & { materialList?: MaterialLink[] };
type MaterialContent = Omit<FormContent, "questions"> & { questions: MaterialQuestion[] };
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const urlPrefix = "https://example.test/";
const link = (orderNumber = 0, linkLabel = "참고 자료", linkUrl = urlPrefix + "reference"): MaterialLink =>
  ({ materialType: "LINK", orderNumber, fileKey: null, linkLabel, linkUrl });
const links = () => [link(0, "첫 자료", urlPrefix + "first"), link(1, "둘째 자료", urlPrefix + "second")];
beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_question_material_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS qa_question_material_audit()");
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Material LINK QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "material-link-" + randomUUID() + "@example.test", password = "Material-link-test!123";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_question_material_audit ON "AuditEvent"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS qa_question_material_audit()");
  await db.$disconnect();
});
function content(materialList?: unknown): MaterialContent {
  return formContentSchema.parse({ body: "기존 폼 안내", questions: [
    { id: randomUUID(), type: "객관식 답변", label: "선택", required: false, options: ["예", "아니오"],
      additionalExplanation: "그대로 유지하는 설명", ...(materialList === undefined ? {} : { materialList }) },
    { id: randomUUID(), type: "단문형 답변", label: "내용", required: false },
  ], font: "16px", bold: false, verify: false, consentRequired: true, consentPurpose: "기존 동의 목적", retentionDays: 30, maxResponses: 100, showSubmitNotice: true }) as MaterialContent;
}
async function fixture(materialList?: unknown) {
  const input = content(materialList);
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "링크 QA", content: input }, randomUUID(), tx));
  return { id: form.id, content: input, ids: input.questions.map(q => q.id) };
}
const stored = (id: string, status: "draft" | "published" = "draft") => db.formVersion.findFirstOrThrow({ where: { formId: id, status }, include: versionInclude, orderBy: { number: "desc" } });
const current = async (id: string) => (await readForm(ctx, id)).content! as MaterialContent;
async function publish(id: string, version: number) {
  await db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
  return decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: id, status: "active" } })).tokenCipher);
}

test("LINK wire trims inputs but preserves the original URL spelling and supports exactly three ordered items", () => {
  const rawUrl = "  HTTPS://Example.TEST:443/%7e?q=a%20b#fragment  ", rawLabel = '  <자료> & "링크"  ';
  const parsed = content([link(0, rawLabel, rawUrl), link(1), link(2)]).questions[0].materialList!;
  expect(parsed).toHaveLength(3);
  expect(parsed[0]).toEqual(link(0, rawLabel.trim(), rawUrl.trim()));
  expect(parsed[0].linkUrl).not.toBe(new URL(rawUrl.trim()).href);
  expect(content([]).questions[0].materialList).toEqual([]);
  // Keep type-preserving normalization representable by the existing OpenAPI generator.
  expect(() => z.toJSONSchema(formContentSchema)).not.toThrow();
});
test("URL and label limits count UTF-16 units including supplementary characters", () => {
  const exactUrl = urlPrefix + "a".repeat(512 - urlPrefix.length);
  const astralUrl = urlPrefix + "a".repeat(510 - urlPrefix.length) + "😀";
  for (const [label, url] of [["가".repeat(100), exactUrl], ["😀".repeat(50), astralUrl]]) {
    const parsed = content([link(0, label, url)]).questions[0].materialList![0];
    expect(parsed.linkLabel).toBe(label); expect(parsed.linkUrl).toBe(url); expect(url.length).toBe(512);
  }
  for (const value of [link(0, "가".repeat(101)), link(0, "😀".repeat(50) + "a"), link(0, "자료", exactUrl + "a"), link(0, "자료", astralUrl + "a")])
    expect(() => content([value])).toThrow();
});
test("blank labels fall back to URL with a surrogate-safe 99-unit prefix plus ellipsis", () => {
  expect(content([link(0, " \t ", urlPrefix)]).questions[0].materialList![0].linkLabel).toBe(urlPrefix);
  const prefix = urlPrefix + "a".repeat(98 - urlPrefix.length), url = prefix + "😀rest";
  const fallback = content([link(0, "", url)]).questions[0].materialList![0].linkLabel;
  expect(fallback).toBe(prefix + "…"); expect(fallback.length).toBeLessThanOrEqual(100);
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(fallback))).toBe(fallback);
});
test("unsafe URL forms, NUL and malformed Unicode are rejected without accepting FILE or relaxed JSON shapes", () => {
  for (const url of ["", "javascript:alert(1)", "data:text/plain,hello", "ftp://example.test/a", "//example.test/a", "https:example.test/a",
    "https://user:password@example.test/a", "https://@example.test/a", "https://example.test\\evil", "https://exam\tple.test/a",
    "https://example.test/a\nnext", "https://example.test/\u007f", "https://example.test/\0", "https://example.test/\ud800", "https://[broken/", "https://example.test:65536/a"])
    expect(() => content([link(0, "자료", url)]), JSON.stringify(url)).toThrow();
  for (const label of ["a\0b", "a\ud800b", "\udc00"]) expect(() => content([link(0, label)])).toThrow();
  const { fileKey: _file, ...missingFileKey } = link(); void _file;
  const { linkLabel: _label, ...missingLabel } = link(); void _label;
  for (const value of [null, {}, "url", [link(0), link(1), link(2), link(3)], [link(1)], [link(0), link(0)], [link(0), link(2)],
    [{ ...link(), materialType: "FILE", fileKey: randomUUID() }], [{ ...link(), materialType: "OTHER" }], [{ ...link(), id: randomUUID() }],
    [{ ...link(), fileKey: randomUUID() }], [{ ...link(), linkLabel: null }], [{ ...link(), linkUrl: 3 }], [missingFileKey], [missingLabel]])
    expect(() => content(value), JSON.stringify(value)).toThrow();
});
test("creates normalized links, exposes exact public metadata and never fetches their targets", async () => {
  const list = [link(0, "  로컬도 단순 링크  ", "  https://127.0.0.1/private?x=%7e  ")];
  const expected = [link(0, list[0].linkLabel.trim(), list[0].linkUrl.trim())];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Question LINK must never fetch"));
  try {
    const f = await fixture(list), row = await stored(f.id);
    expect(row.questions[0]).toMatchObject({ materialList: expected });
    const token = await publish(f.id, 1);
    expect((await activePublicForm(token)).content.questions[0]).toMatchObject({ materialList: expected, additionalExplanation: "그대로 유지하는 설명" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(await db.auditEvent.findMany({ where: { resourceId: f.id } }))).not.toContain(expected[0].linkUrl);
  } finally { fetchSpy.mockRestore(); }
});
test("legacy SQL null stays absent from DTO and preserves the pre-material approval fingerprint", async () => {
  const f = await fixture(), row = await stored(f.id);
  const columns = await db.$queryRaw<{ materialList: unknown }[]>`SELECT "materialList" FROM "Question" WHERE "formVersionId"=${row.id}`;
  expect(columns.every(q => q.materialList === null)).toBe(true);
  const dto = contentDto(row) as MaterialContent; expect(dto.questions.every(q => !("materialList" in q))).toBe(true);
  const legacy = structuredClone(dto); legacy.questions.forEach(q => delete q.materialList);
  expect(fingerprint(row)).toBe(sha(JSON.stringify({ title: row.title, content: legacy, consentBundle: consentBundle(row) })));
});
test("editing and reordering links preserves physical question/option IDs and supersedes the frozen approval", async () => {
  const f = await fixture(links()), before = await stored(f.id), originalHash = fingerprint(before);
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true, approvalRoles: ["owner"] } });
  const approval = await db.$transaction(tx => requestApproval(tx, ctx, f.id, { version: 1, message: "참고 자료 검토", reference: "QA" }, randomUUID()));
  expect(approval.snapshot).toMatchObject({ content: { questions: [{ materialList: links() }, {}] } });
  const value = await current(f.id), reordered = [link(0, "둘째 수정", urlPrefix + "second"), link(1, "첫 자료", urlPrefix + "first")];
  value.questions[0].materialList = reordered;
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  const after = await stored(f.id);
  expect(after.questions.map(q => q.id)).toEqual(before.questions.map(q => q.id));
  expect(after.questions[0].options.map(o => o.id)).toEqual(before.questions[0].options.map(o => o.id));
  expect(after.questions[0]).toMatchObject({ materialList: reordered, additionalExplanation: "그대로 유지하는 설명" });
  expect(fingerprint(after)).not.toBe(originalHash);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "superseded", snapshot: approval.snapshot });
});
test("omission preserves current links while explicit empty removes them without later resurrection", async () => {
  const f = await fixture(links()), value = await current(f.id); delete value.questions[0].materialList;
  await updateForm(ctx, f.id, { version: 1, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].materialList).toEqual(links());
  value.questions[0].materialList = [];
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].materialList ?? []).toEqual([]);
  delete value.questions[0].materialList;
  await updateForm(ctx, f.id, { version: 3, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].materialList ?? []).toEqual([]);
});
test("implicit draft omission retains current links but a new logical question inherits none", async () => {
  const f = await fixture(links()), token = await publish(f.id, 1), before = await stored(f.id, "published");
  const value = await current(f.id); delete value.questions[0].materialList;
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID());
  expect((await current(f.id)).questions[0].materialList).toEqual(links());
  const next = await current(f.id); next.questions[0] = { id: randomUUID(), type: "단문형 답변", label: "새 질문", required: false };
  await updateForm(ctx, f.id, { version: 3, content: next }, randomUUID());
  expect((await current(f.id)).questions[0]).not.toHaveProperty("materialList");
  expect(await stored(f.id, "published")).toEqual(before);
  expect((await activePublicForm(token)).content.questions[0]).toMatchObject({ materialList: links() });
});
test("form copy and explicit revise retain links while preserving the correct logical identity boundaries", async () => {
  const f = await fixture(links()), copy = await db.$transaction(tx => copyForm(tx, ctx, f.id, undefined, randomUUID()));
  expect(copy.content!.questions[0]).toMatchObject({ materialList: links() }); expect(copy.content!.questions[0].id).not.toBe(f.ids[0]);
  await publish(f.id, 1); const before = await stored(f.id, "published");
  await db.$transaction(tx => reviseForm(tx, ctx, f.id, 2, randomUUID()));
  const revised = await stored(f.id); expect(revised.questions[0]).toMatchObject({ stableKey: f.ids[0], materialList: links() });
  expect(revised.questions[0].id).not.toBe(before.questions[0].id); expect(await stored(f.id, "published")).toEqual(before);
});
test("template create/update/use preserves omitted lists, order and clearing with independent question IDs", async () => {
  const input = content(links()), template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "자료 양식", category: "QA", content: input }, randomUUID(), tx));
  const first = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 1, serviceId }, randomUUID(), tx));
  expect(first.content!.questions[0]).toMatchObject({ materialList: links() }); expect(first.content!.questions[0].id).not.toBe(input.questions[0].id);
  const value = structuredClone(template.content) as MaterialContent; delete value.questions[0].materialList;
  await updateTemplate(ctx, template.id, { version: 1, content: value }, randomUUID());
  expect((await getTemplate(ctx, template.id)).content.questions[0]).toMatchObject({ materialList: links() });
  value.questions[0].materialList = [];
  await updateTemplate(ctx, template.id, { version: 2, content: value }, randomUUID()); delete value.questions[0].materialList;
  await updateTemplate(ctx, template.id, { version: 3, content: value }, randomUUID());
  const cleared = await db.$transaction(tx => useTemplate(ctx, template.id, { version: 4, serviceId }, randomUUID(), tx));
  expect((cleared.content!.questions[0] as MaterialQuestion).materialList ?? []).toEqual([]);
});
test("legacy template JSON is neither enriched with defaults nor rewritten by repeated reads", async () => {
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "기존 양식", category: "QA", content: content() }, randomUUID(), tx));
  const before = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  for (let i = 0; i < 2; i++) expect((await getTemplate(ctx, template.id)).content.questions.every(q => !("materialList" in q))).toBe(true);
  expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(before);
});
test("database enforces material shape, protocol, strict keys, sequence and exact UTF-16 lengths", async () => {
  const f = await fixture(), q = (await stored(f.id)).questions[0];
  const exactUrl = urlPrefix + "a".repeat(510 - urlPrefix.length) + "😀", valid = [link(0, "😀".repeat(50), exactUrl)];
  await db.$executeRaw`UPDATE "Question" SET "materialList"=${JSON.stringify(valid)}::jsonb WHERE id=${q.id}`;
  expect((await current(f.id)).questions[0].materialList).toEqual(valid);
  const invalid: unknown[] = [null, {}, "url", [link(0), link(1), link(2), link(3)], [link(1)], [link(0), link(2)],
    [{ ...link(), materialType: "FILE" }], [{ ...link(), fileKey: "foreign-file" }], [{ ...link(), extra: true }],
    [{ materialType: "LINK", orderNumber: 0, fileKey: null, linkUrl: urlPrefix }], [{ ...link(), orderNumber: 0.5 }], [{ ...link(), linkLabel: null }],
    [link(0, "😀".repeat(50) + "a")], [link(0, "資料", exactUrl + "a")], [link(0, "資料", "javascript:alert(1)")], [link(0, "資料", "//example.test")],
    [link(0, "資料", "https://user:password@example.test/")], [link(0, "資料", "https://example.test\\evil")], [link(0, "資料", "https://exam\tple.test/")]];
  for (const value of invalid) await expect(db.$executeRaw`UPDATE "Question" SET "materialList"=${JSON.stringify(value)}::jsonb WHERE id=${q.id}`, JSON.stringify(value)).rejects.toThrow();
  expect((await current(f.id)).questions[0].materialList).toEqual(valid);
});
test("published material rows cannot be directly altered or removed", async () => {
  const f = await fixture(links()), token = await publish(f.id, 1), before = await stored(f.id, "published"), q = before.questions[0];
  for (const value of [[], [link(0, "변경")]]) await expect(db.$executeRaw`UPDATE "Question" SET "materialList"=${JSON.stringify(value)}::jsonb WHERE id=${q.id}`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "Question" SET "materialList"=NULL WHERE id=${q.id}`).rejects.toThrow();
  expect(await stored(f.id, "published")).toEqual(before); expect((await activePublicForm(token)).content.questions[0]).toMatchObject({ materialList: links() });
});
test("stale version and revoked current authority reject material updates without changing data or audit", async () => {
  const f = await fixture(links()), before = await stored(f.id), value = await current(f.id); value.questions[0].materialList = [link(0, "거절 변경")];
  await expect(updateForm(ctx, f.id, { version: 999, content: value }, randomUUID())).rejects.toMatchObject({ status: 409 });
  const owner = await db.user.create({ data: { id: randomUUID(), email: "remaining-owner-" + randomUUID() + "@example.test", name: "QA owner", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: owner.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(updateForm(ctx, f.id, { version: 1, content: value }, randomUUID())).rejects.toMatchObject({ status: 403 });
  expect(await stored(f.id)).toEqual(before);
  expect(await db.auditEvent.count({ where: { resourceId: f.id, action: "form.draft_updated" } })).toBe(0);
});
test.each(["form", "template"] as const)("%s material changes roll back with their version when audit insertion fails", async kind => {
  const f = await fixture(links()), templateContent = await current(f.id);
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "감사 자료 양식", category: "QA", content: templateContent }, randomUUID(), tx));
  const before = await stored(f.id), beforeTemplate = await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } });
  const value = await current(f.id); value.questions[0].materialList = [link(0, "남으면 안 되는 자료")];
  await db.$executeRawUnsafe("CREATE FUNCTION qa_question_material_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('form.draft_updated','template.updated') THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER qa_question_material_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_question_material_audit()');
  try {
    await expect(kind === "form" ? updateForm(ctx, f.id, { version: 1, content: value }, randomUUID()) : updateTemplate(ctx, template.id, { version: 1, content: value }, randomUUID())).rejects.toThrow();
    expect(await stored(f.id)).toEqual(before); expect((await readForm(ctx, f.id)).version).toBe(1);
    expect(await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } })).toEqual(beforeTemplate);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER qa_question_material_audit ON "AuditEvent"');
    await db.$executeRawUnsafe("DROP FUNCTION qa_question_material_audit()");
  }
});
test("old response correction retains its published links and leaves consent evidence and PDF bytes unchanged", async () => {
  const list = [link(0, "QUESTION-LINK-NOT-RECEIPT", urlPrefix + "not-receipt")], f = await fixture(list), token = await publish(f.id, 1);
  const submitted = await submitForm(token, submissionInput.parse({ answers: { [f.ids[1]]: "이전 응답" }, consent: true }), randomUUID(), randomUUID());
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: submitted.body.id } });
  const bytes = Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64"), evidence = decrypt<ConsentEvidence>(receipt.evidenceCipher!);
  expect(JSON.stringify(evidence)).not.toContain(list[0].linkLabel); expect(JSON.stringify(evidence)).not.toContain(list[0].linkUrl);
  expect(sha(bytes)).toBe(receipt.pdfHash);
  const value = await current(f.id); value.questions[0].materialList = [link(0, "새 버전 자료", urlPrefix + "new")];
  await updateForm(ctx, f.id, { version: 2, content: value }, randomUUID()); await publish(f.id, 3);
  await correctSubmission(ctx, submitted.body.id, { version: 1, reason: "답변만 정정", answers: { [f.ids[1]]: "정정 응답" } }, randomUUID());
  const detail = await getSubmission(ctx, submitted.body.id, randomUUID());
  expect(detail.questions[0]).toMatchObject({ materialList: list }); expect(detail.values[f.ids[1]]).toBe("정정 응답");
  expect(await db.consentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
  const download = await privateConsentReceiptPdf(ctx, submitted.body.id, receipt.id, randomUUID());
  expect(Buffer.from(download.bytes)).toEqual(bytes);
});
