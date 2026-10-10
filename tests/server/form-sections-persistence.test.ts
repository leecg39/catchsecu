import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { formContentSchema } from "@/contracts/domains";
import type { RichDocumentV1 } from "@/contracts/rich-content";
import { contentDto, copyForm, createForm, fingerprint, publishForm, readForm, reviseForm, updateForm, versionInclude } from "@/server/forms";
import { consentBundle } from "@/server/form-documents";
import { createTemplate, getTemplate, updateTemplate, useTemplate } from "@/server/templates";
import { activePublicForm } from "../helpers/public-form";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required");

let ctx: Context, serviceId: string;
const rich = (text: string): RichDocumentV1 => ({ schemaVersion: 1, blocks: text ? [{ type: "paragraph", children: [{ type: "text", text }] }] : [] });
function withoutPageId<T extends { pageId?: string }>(item: T) { const copy = { ...item }; delete copy.pageId; return copy; }

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Section QA", publicName: "Section QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "Section service", externalName: "Section service" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = `sections-${randomUUID()}@example.test`, password = "Section-test!12345";
  const request = (path: string, body: unknown) => new Request(`${origin}/api/v1/auth/${path}`,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(() => db.$disconnect());

function legacy() {
  return formContentSchema.parse({ body: "안내", questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
}
function paged() {
  const first = randomUUID(), second = randomUUID(), third = randomUUID();
  return formContentSchema.parse({ body: "루트 안내", questions: [
    { id: randomUUID(), pageId: first, type: "단문형 답변", label: "첫 질문", required: true },
    { id: randomUUID(), pageId: second, type: "장문형 답변", label: "둘째 질문", required: false },
    { id: randomUUID(), pageId: third, type: "이메일", label: "마지막 질문", required: true },
  ], sections: [
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
    { id: second, title: "상세", body: "둘째 안내", bodyRich: rich("둘째 안내"), defaultDestination: { kind: "page", pageId: third }, allowBack: true },
    { id: third, title: "확인", body: "", defaultDestination: { kind: "submit" }, allowBack: true },
  ], completionPage: { mode: "custom", body: "접수 완료", bodyRich: rich("접수 완료") }, closedPage: { mode: "default" },
  consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
}
async function create(content = paged(), title = "Paged form") {
  return db.$transaction(tx => createForm(ctx, { serviceId, title, content }, randomUUID(), tx));
}

test("legacy versions keep the exact DTO and fingerprint surface", async () => {
  const input = legacy(), form = await create(input, "Legacy");
  const stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  expect(stored.sectionSchemaVersion).toBe(0);
  expect(stored.sections).toEqual([]);
  expect(stored.completionPageMode).toBeNull();
  expect(stored.closedPageMode).toBeNull();
  const dto = contentDto(stored);
  expect(dto).not.toHaveProperty("sections");
  expect(dto.questions.every(question => question.pageId === undefined)).toBe(true);
  expect(fingerprint(stored)).toBe(createHash("sha256").update(JSON.stringify({ title: stored.title, content: dto,
    ...([1, 2].includes(stored.receiptEvidenceVersion) ? { consentBundle: consentBundle(stored) } : {}) })).digest("hex"));
});

test("page rows, question placement and terminal notices round-trip and old clients preserve them", async () => {
  const input = paged(), form = await create(input);
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  expect(version.sectionSchemaVersion).toBe(1);
  expect(version.sections).toHaveLength(3);
  expect(version.questions.every(question => question.sectionId !== null)).toBe(true);
  const dto = contentDto(version);
  expect(dto.sections).toEqual(input.sections);
  expect(dto.completionPage).toEqual(input.completionPage);
  expect(dto.closedPage).toEqual(input.closedPage);
  expect(dto.questions.map(question => question.pageId)).toEqual(input.questions.map(question => question.pageId));

  const oldClient = formContentSchema.parse({ ...input,
    questions: input.questions.map(withoutPageId),
    sections: undefined, completionPage: undefined, closedPage: undefined });
  await updateForm(ctx, form.id, { version: 1, content: oldClient }, randomUUID());
  expect((await readForm(ctx, form.id)).content).toEqual(dto);

  const removed = formContentSchema.parse({ ...input, sections: null, completionPage: null, closedPage: null,
    questions: input.questions.map(withoutPageId) });
  await updateForm(ctx, form.id, { version: 2, content: removed }, randomUUID());
  const plain = await readForm(ctx, form.id);
  expect(plain.content).not.toHaveProperty("sections");
  expect(plain.content).not.toHaveProperty("completionPage");
  expect(await db.formSection.count()).toBe(0);
  expect(await db.question.count({ where: { sectionId: { not: null } } })).toBe(0);
});

test("revision preserves page identity while a form copy remaps the complete graph", async () => {
  const input = paged(), form = await create(input);
  const publication = await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 1 }, randomUUID()));
  const publicContent = (await activePublicForm(publication.token)).content;
  expect(publicContent.sections).toEqual(input.sections);
  expect(publicContent).not.toHaveProperty("completionPage");
  expect(publicContent).not.toHaveProperty("closedPage");
  await db.$transaction(tx => reviseForm(tx, ctx, form.id, 2, randomUUID()));
  expect((await readForm(ctx, form.id)).content?.sections?.map(section => section.id)).toEqual(input.sections?.map(section => section.id));

  const copied = await db.$transaction(tx => copyForm(tx, ctx, form.id, "Copied pages", randomUUID()));
  expect(copied.content).not.toBeNull();
  const copiedContent = copied.content!;
  const sourceIds = new Set(input.sections?.map(section => section.id));
  const copiedIds = new Set(copiedContent.sections?.map(section => section.id));
  expect([...copiedIds].every(id => !sourceIds.has(id))).toBe(true);
  expect(copiedContent.questions.every(question => copiedIds.has(question.pageId!))).toBe(true);
  expect(copiedContent.sections?.filter(section => section.defaultDestination.kind === "page")
    .every(section => copiedIds.has((section.defaultDestination as { kind: "page"; pageId: string }).pageId))).toBe(true);
});

test("template edits preserve presentation fields and template use remaps page identity", async () => {
  const input = paged();
  const template = await db.$transaction(tx => createTemplate(ctx,
    { serviceId, title: "Paged template", category: "QA", content: input }, randomUUID(), tx));
  const oldClient = formContentSchema.parse({ ...input,
    questions: input.questions.map(withoutPageId),
    sections: undefined, completionPage: undefined, closedPage: undefined });
  await updateTemplate(ctx, template.id, { version: 1, content: oldClient }, randomUUID());
  const preserved = await getTemplate(ctx, template.id);
  expect(preserved.content.sections).toEqual(input.sections);
  expect(preserved.content.completionPage).toEqual(input.completionPage);

  const used = await db.$transaction(tx => useTemplate(ctx, template.id,
    { version: 2, serviceId, title: "Used template" }, randomUUID(), tx));
  expect(used.content).not.toBeNull();
  const sourceIds = new Set(input.sections?.map(section => section.id));
  const usedIds = new Set(used.content!.sections?.map(section => section.id));
  expect([...usedIds].every(id => !sourceIds.has(id))).toBe(true);
  expect(used.content!.questions.every(question => usedIds.has(question.pageId!))).toBe(true);
});

test("database constraints reject cross-version placement, cycles and missing placement without partial writes", async () => {
  const first = await create(), second = await create(paged(), "Second");
  const firstVersion = await db.formVersion.findFirstOrThrow({ where: { formId: first.id }, include: versionInclude });
  const secondVersion = await db.formVersion.findFirstOrThrow({ where: { formId: second.id }, include: versionInclude });
  await expect(db.question.update({ where: { id: firstVersion.questions[0].id }, data: { sectionId: secondVersion.sections[0].id } })).rejects.toThrow();
  expect((await db.question.findUniqueOrThrow({ where: { id: firstVersion.questions[0].id } })).sectionId).toBe(firstVersion.sections[0].id);

  await expect(db.$transaction(async tx => {
    await tx.formSection.update({ where: { id: firstVersion.sections[0].id }, data: { destinationKind: "page", destinationSectionId: firstVersion.sections[1].id } });
    await tx.formSection.update({ where: { id: firstVersion.sections[1].id }, data: { destinationKind: "page", destinationSectionId: firstVersion.sections[0].id } });
  })).rejects.toThrow();
  await expect(db.$transaction(tx => tx.question.update({ where: { id: firstVersion.questions[0].id }, data: { sectionId: null } }))).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "completionPageMode"='default', "completionPageBody"='SQL bypass'
    WHERE id=${firstVersion.id}`).rejects.toThrow();
  expect((await db.formSection.findUniqueOrThrow({ where: { id: firstVersion.sections[1].id } })).destinationSectionId)
    .toBe(firstVersion.sections[2].id);
});

test("published pages are immutable and corrupt rich projections fail closed", async () => {
  const form = await create(), version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 1 }, randomUUID()));
  await expect(db.formSection.update({ where: { id: version.sections[1].id }, data: { title: "변조" } })).rejects.toThrow();
  await expect(db.formVersion.update({ where: { id: version.id }, data: { completionPageBody: "변조" } })).rejects.toThrow();

  const draft = await create(paged(), "Corrupt projection");
  const draftVersion = await db.formVersion.findFirstOrThrow({ where: { formId: draft.id }, include: versionInclude });
  await db.formSection.update({ where: { id: draftVersion.sections[1].id }, data: { bodyRich: rich("다른 본문") } });
  const corrupted = await db.formVersion.findUniqueOrThrow({ where: { id: draftVersion.id }, include: versionInclude });
  expect(() => contentDto(corrupted)).toThrow();
});

test("page and terminal images require an owned asset in the matching content slot", async () => {
  const assetId = randomUUID();
  const image = (): RichDocumentV1 => ({ schemaVersion: 1, blocks: [{ type: "image", nodeId: randomUUID(), assetId, alt: "검증" }] });
  for (const slot of ["section", "completion", "closed"] as const) {
    const input = paged();
    if (slot === "section") input.sections![1] = { ...input.sections![1], body: "", bodyRich: image() };
    if (slot === "completion") input.completionPage = { mode: "custom", body: "", bodyRich: image() };
    if (slot === "closed") input.closedPage = { mode: "custom", body: "", bodyRich: image() };
    await expect(create(formContentSchema.parse(input), `Unpinned ${slot}`))
      .rejects.toMatchObject({ status: 404, code: "AUTHOR_ASSET_NOT_FOUND" });
  }
  expect(await db.form.count()).toBe(0);
});
