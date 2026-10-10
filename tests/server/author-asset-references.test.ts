import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { encrypt } from "@/server/crypto";
import { createForm, readForm, updateForm, publishForm, reviseForm, copyForm, purgeForm, versionInclude } from "@/server/forms";
import { createTemplate, updateTemplate, deleteTemplate, useTemplate } from "@/server/templates";
import { requestApproval } from "@/server/approvals";
import { fileQuotaUsage } from "@/server/file-quota";
import { withAuthorAssetReferences } from "@/server/author-asset-references";
import { privateFiles } from "@/server/file-storage";
import { formContentSchema } from "@/contracts/domains";
import type { FormContent } from "@/contracts/forms";
import type { RichDocumentV1 } from "@/contracts/rich-content";
import { POST as createRoute } from "@/app/api/v1/forms/route";
import { POST as actionRoute, PATCH as patchRoute } from "@/app/api/v1/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
let ctx: Context, serviceId: string, cookie: string;
const storedKeys: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z8DwH4QZYAwAR8oH+Xm0fdIAAAAASUVORK5CYII=", "base64");
type Purpose = "QUESTION_MATERIAL" | "OPTION_IMAGE" | "FORM_CONTENT_IMAGE" | "PAGE_CONTENT_IMAGE" | "END_PAGE_CONTENT_IMAGE" | "PRIVATE_PAGE_CONTENT_IMAGE";
type Scope = { tenantId: string; serviceId: string; memberId: string };
const ownScope = (): Scope => ({ tenantId: ctx.tenantId, serviceId, memberId: ctx.member.id });
const material = (id: string, orderNumber = 0) => ({ materialType: "FILE" as const, orderNumber, fileKey: id, linkLabel: null, linkUrl: null });
async function dropAuditFailure() {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_author_reference_audit ON "AuditEvent"');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_author_reference_audit()');
}
beforeEach(async () => {
  await dropAuditFailure();
  await db.$executeRawUnsafe('TRUNCATE "Company", "User", "AuthorAssetBlob", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Author reference QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = randomUUID() + "@references.example.test", password = "Author-reference-QA!123";
  const authReq = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(authReq("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(authReq("sign-in/email", { email, password })); expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie }), "form.write");
});
afterAll(async () => { await dropAuditFailure(); await db.$disconnect(); });
afterEach(async () => { await Promise.all(storedKeys.splice(0).map(key => privateFiles.remove(key).catch(() => {}))); });
async function asset(purpose: Purpose = "QUESTION_MATERIAL", scope: Scope | null = ownScope()) {
  return db.$transaction(async tx => {
    // Publishing preflights evidence images from private storage. The fixture records
    // actual PNG bytes for image purposes; scan success remains a local DB fixture.
    const bytes = purpose === "QUESTION_MATERIAL" ? Buffer.from("test") : png, storageKey = randomUUID();
    if (purpose !== "QUESTION_MATERIAL") { await privateFiles.write(storageKey, bytes); storedKeys.push(storageKey); }
    const blob = await tx.authorAssetBlob.create({ data: { storageKey, mime: purpose === "QUESTION_MATERIAL" ? "application/pdf" : "image/png",
      size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
    await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "uploaded", version: { increment: 1 } } });
    await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "ready", scanStatus: "clean", scanEngine: "DB fixture, not ClamAV evidence", scannedAt: new Date(), expiresAt: null, version: { increment: 1 } } });
    return tx.authorAsset.create({ data: { blobId: blob.id, ownerKind: scope ? "company" : "system", tenantId: scope?.tenantId, serviceId: scope?.serviceId,
      createdById: scope?.memberId, purpose, nameCipher: encrypt(purpose === "QUESTION_MATERIAL" ? "자료.pdf" : "이미지.png"), size: bytes.length, status: "ready" } });
  });
}
function content(file?: string, image?: string): FormContent {
  return formContentSchema.parse({ body: "참고 자료 안내", questions: [
    { id: randomUUID(), type: "객관식 답변", label: "선택", required: false, options: ["예", "아니오"],
      optionDefinitions: [{ id: randomUUID(), label: "예", value: "예", ...(image ? { optionImageKey: image } : {}) }, { id: randomUUID(), label: "아니오", value: "아니오" }],
      ...(file ? { materialList: [material(file)] } : {}) },
    { id: randomUUID(), type: "단문형 답변", label: "내용", required: false },
  ], font: "16px", bold: false, verify: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100, showSubmitNotice: true });
}
const create = (value: FormContent, target = serviceId) => db.$transaction(tx => createForm(ctx, { serviceId: target, title: "작성 자료 QA", content: value }, randomUUID(), tx));
const stored = (formId: string, status: "draft" | "published" = "draft") => db.formVersion.findFirstOrThrow({ where: { formId, status }, include: versionInclude, orderBy: { number: "desc" } });
const current = async (id: string) => (await readForm(ctx, id)).content!;
const refs = (assetId?: string) => db.authorAssetReference.findMany({ where: assetId ? { assetId } : {}, orderBy: { id: "asc" } });
const publish = (id: string, version = 1) => db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
const template = (value: FormContent) => db.$transaction(tx => createTemplate(ctx, { serviceId, title: "작성 자료 양식", category: "QA", content: value }, randomUUID(), tx));
const request = (path: string, method: string, body: unknown, key = randomUUID()) => new Request(origin + "/api/v1/forms" + path, {
  method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
});
async function auditFailure() {
  await db.$executeRawUnsafe("CREATE FUNCTION qa_author_reference_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'author_asset.%' THEN RAISE EXCEPTION 'injected author reference audit'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER qa_author_reference_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_author_reference_audit()');
}

const richImage = (assetId: string, nodeId = randomUUID()): RichDocumentV1 => ({
  schemaVersion: 1, blocks: [{ type: "image", nodeId, assetId, alt: "본문 이미지" }],
});

test("whole form content pins question and four rich-document slots in one graph", async () => {
  const file = await asset();
  const option = await asset("OPTION_IMAGE");
  const root = await asset("FORM_CONTENT_IMAGE");
  const page = await asset("PAGE_CONTENT_IMAGE");
  const completion = await asset("END_PAGE_CONTENT_IMAGE");
  const closed = await asset("PRIVATE_PAGE_CONTENT_IMAGE");
  const value = content(file.id, option.id);
  const first = randomUUID(), second = randomUUID();
  value.body = "";
  value.bodyRich = richImage(root.id);
  value.sections = [
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
    { id: second, title: "상세", body: "", bodyRich: richImage(page.id), defaultDestination: { kind: "submit" }, allowBack: true },
  ];
  value.questions = value.questions.map((question, index) => ({ ...question, pageId: index ? second : first }));
  value.completionPage = { mode: "custom", body: "", bodyRich: richImage(completion.id) };
  value.closedPage = { mode: "custom", body: "", bodyRich: richImage(closed.id) };

  const form = await create(formContentSchema.parse(value));
  const version = await stored(form.id);
  expect(await refs()).toEqual(expect.arrayContaining([
    expect.objectContaining({ formVersionId: version.id, slot: "form_content", documentKey: "form", assetId: root.id, questionKey: null }),
    expect.objectContaining({ formVersionId: version.id, slot: "page_content", documentKey: second, assetId: page.id, questionKey: null }),
    expect.objectContaining({ formVersionId: version.id, slot: "end_page_content", documentKey: "completion", assetId: completion.id, questionKey: null }),
    expect.objectContaining({ formVersionId: version.id, slot: "private_page_content", documentKey: "closed", assetId: closed.id, questionKey: null }),
    expect.objectContaining({ formVersionId: version.id, slot: "material", assetId: file.id }),
    expect.objectContaining({ formVersionId: version.id, slot: "option", assetId: option.id }),
  ]));
  expect(await refs()).toHaveLength(6);
  expect((await db.authorAsset.findMany()).every(item => item.expiresAt === null)).toBe(true);
});

test("repeated rich nodes keep independent pins while quota and copies count one logical asset", async () => {
  const root = await asset("FORM_CONTENT_IMAGE");
  const value = content();
  value.body = "\n";
  value.bodyRich = { schemaVersion: 1, blocks: [
    { type: "image", nodeId: randomUUID(), assetId: root.id, alt: "첫 위치" },
    { type: "image", nodeId: randomUUID(), assetId: root.id, alt: "둘째 위치" },
  ] };
  const form = await create(formContentSchema.parse(value));
  expect(await refs(root.id)).toHaveLength(2);
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: png.length });

  const copied = await db.$transaction(tx => copyForm(tx, ctx, form.id, "본문 복사", randomUUID()));
  const images = copied.content!.bodyRich!.blocks.filter(block => block.type === "image");
  expect(images).toHaveLength(2);
  expect(images[0].type === "image" && images[1].type === "image" && images[0].assetId).toBe(images[1].type === "image" ? images[1].assetId : "");
  expect(images[0].type === "image" && images[0].assetId).not.toBe(root.id);
  expect(await db.authorAsset.count()).toBe(2);
  expect(await db.authorAssetReference.count()).toBe(4);
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: png.length * 2 });
});

test("rich pins survive publication, revision and approval snapshots independently", async () => {
  const root = await asset("FORM_CONTENT_IMAGE"), value = content();
  value.body = ""; value.bodyRich = richImage(root.id);
  const form = await create(formContentSchema.parse(value));
  await publish(form.id);
  const published = await stored(form.id, "published");
  await db.$transaction(tx => reviseForm(tx, ctx, form.id, 2, randomUUID()));
  expect(await refs(root.id)).toHaveLength(2);
  const next = await current(form.id); next.bodyRich = null;
  await updateForm(ctx, form.id, { version: 3, content: next }, randomUUID());
  expect(await refs(root.id)).toEqual([expect.objectContaining({ formVersionId: published.id, slot: "form_content" })]);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: root.id } })).expiresAt).toBeNull();

  const approvalAsset = await asset("FORM_CONTENT_IMAGE"), approvalContent = content();
  approvalContent.body = ""; approvalContent.bodyRich = richImage(approvalAsset.id);
  const approvalForm = await create(formContentSchema.parse(approvalContent));
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true, approvalRoles: ["owner"] } });
  const approval = await db.$transaction(tx => requestApproval(tx, ctx, approvalForm.id,
    { version: 1, message: "본문 검토", reference: "BODY-1" }, randomUUID()));
  const draft = await current(approvalForm.id); draft.bodyRich = null;
  await updateForm(ctx, approvalForm.id, { version: 2, content: draft }, randomUUID());
  expect(await refs(approvalAsset.id)).toEqual([expect.objectContaining({ approvalId: approval.id, slot: "form_content" })]);
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } }).then(row => row.snapshot as { content: FormContent })).content.bodyRich)
    .toEqual(approvalContent.bodyRich);
});

test("templates pin rich documents and template use remaps every body asset", async () => {
  const root = await asset("FORM_CONTENT_IMAGE"), page = await asset("PAGE_CONTENT_IMAGE"), value = content();
  const first = randomUUID(), second = randomUUID();
  value.body = ""; value.bodyRich = richImage(root.id);
  value.sections = [
    { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
    { id: second, title: "본문", body: "", bodyRich: richImage(page.id), defaultDestination: { kind: "submit" }, allowBack: true },
  ];
  value.questions = value.questions.map((question, index) => ({ ...question, pageId: index ? second : first }));
  const saved = await template(formContentSchema.parse(value));
  expect(await refs()).toEqual(expect.arrayContaining([
    expect.objectContaining({ templateId: saved.id, slot: "form_content", assetId: root.id }),
    expect.objectContaining({ templateId: saved.id, slot: "page_content", assetId: page.id, documentKey: second }),
  ]));
  const used = await db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId, version: 1 }, randomUUID(), tx));
  const usedRoot = used.content!.bodyRich!.blocks[0];
  const usedPage = used.content!.sections![1].bodyRich!.blocks[0];
  expect(usedRoot.type).toBe("image"); expect(usedPage.type).toBe("image");
  if (usedRoot.type !== "image" || usedPage.type !== "image") throw new Error("image fixture");
  expect(usedRoot.assetId).not.toBe(root.id); expect(usedPage.assetId).not.toBe(page.id);
  expect(used.content!.sections![1].id).not.toBe(second);
  expect(await refs(usedRoot.assetId)).toEqual([expect.objectContaining({ formVersionId: expect.any(String), slot: "form_content" })]);
  expect(await refs(usedPage.assetId)).toEqual([expect.objectContaining({ formVersionId: expect.any(String), slot: "page_content",
    documentKey: used.content!.sections![1].id })]);
});
test("template thumbnail has an independent pin, survives use without entering form content, and releases on removal", async () => {
  const thumbnail = await asset("FORM_CONTENT_IMAGE"), replacement = await asset("FORM_CONTENT_IMAGE"), value = content();
  const saved = await db.$transaction(tx => createTemplate(ctx, {
    serviceId, title: "대표 이미지 양식", category: "QA", description: "대표 이미지 수명 검증",
    thumbnailAssetId: thumbnail.id, content: value,
  }, randomUUID(), tx));
  expect(await refs(thumbnail.id)).toEqual([expect.objectContaining({ templateId: saved.id, slot: "template_thumbnail",
    documentKey: "template", questionKey: null, nodeKey: null })]);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: thumbnail.id } })).expiresAt).toBeNull();

  const used = await db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId, version: 1 }, randomUUID(), tx));
  expect(JSON.stringify(used.content)).not.toContain(thumbnail.id);
  expect(await db.authorAsset.count()).toBe(2);

  await updateTemplate(ctx, saved.id, { version: 1, thumbnailAssetId: replacement.id }, randomUUID());
  expect(await refs(thumbnail.id)).toEqual([]);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: thumbnail.id } })).expiresAt!.getTime()).toBeGreaterThan(Date.now());
  expect(await refs(replacement.id)).toEqual([expect.objectContaining({ templateId: saved.id, slot: "template_thumbnail" })]);

  await updateTemplate(ctx, saved.id, { version: 2, thumbnailAssetId: null }, randomUUID());
  expect(await refs(replacement.id)).toEqual([]);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: replacement.id } })).expiresAt!.getTime()).toBeGreaterThan(Date.now());

  await expect(db.$transaction(tx => tx.formTemplate.update({ where: { id: saved.id },
    data: { thumbnailAssetId: replacement.id, version: { increment: 1 } } }))).rejects.toThrow(/Author asset JSON and pins differ/);
  expect(await db.formTemplate.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ thumbnailAssetId: null, version: 3 });

  const wrongPurpose = await asset("OPTION_IMAGE");
  await expect(updateTemplate(ctx, saved.id, { version: 3, thumbnailAssetId: wrongPurpose.id }, randomUUID()))
    .rejects.toMatchObject({ status: 422, code: "AUTHOR_ASSET_PURPOSE" });
  expect(await refs(wrongPurpose.id)).toEqual([]);
});

test("rich assets reject wrong purpose, service, expiry and roll back replacement audit failures", async () => {
  const wrongPurpose = await asset("OPTION_IMAGE"), wrongValue = content();
  wrongValue.body = ""; wrongValue.bodyRich = richImage(wrongPurpose.id);
  await expect(create(formContentSchema.parse(wrongValue))).rejects.toMatchObject({ status: 422, code: "AUTHOR_ASSET_PURPOSE" });

  const otherService = await db.service.create({ data: { tenantId: ctx.tenantId, name: "본문 타 서비스", externalName: "본문 타 서비스" } });
  const foreign = await asset("FORM_CONTENT_IMAGE", { ...ownScope(), serviceId: otherService.id }), foreignValue = content();
  foreignValue.body = ""; foreignValue.bodyRich = richImage(foreign.id);
  await expect(create(formContentSchema.parse(foreignValue))).rejects.toMatchObject({ status: 404, code: "AUTHOR_ASSET_NOT_FOUND" });

  const expired = await asset("FORM_CONTENT_IMAGE");
  await db.authorAsset.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1), version: { increment: 1 } } });
  const expiredValue = content(); expiredValue.body = ""; expiredValue.bodyRich = richImage(expired.id);
  await expect(create(formContentSchema.parse(expiredValue))).rejects.toMatchObject({ status: 410, code: "AUTHOR_ASSET_EXPIRED" });

  const first = await asset("FORM_CONTENT_IMAGE"), replacement = await asset("FORM_CONTENT_IMAGE"), initial = content();
  initial.body = ""; initial.bodyRich = richImage(first.id);
  const form = await create(formContentSchema.parse(initial)), before = await refs();
  const next = await current(form.id); next.bodyRich = richImage(replacement.id);
  await auditFailure();
  try { await expect(updateForm(ctx, form.id, { version: 1, content: next }, randomUUID())).rejects.toThrow(/injected author reference audit/); }
  finally { await dropAuditFailure(); }
  expect(await refs()).toEqual(before);
  expect((await current(form.id)).bodyRich).toEqual(initial.bodyRich);
});

test("database projection, document keys and GC fences reject direct rich-body bypasses", async () => {
  const root = await asset("FORM_CONTENT_IMAGE"), value = content();
  value.body = ""; value.bodyRich = richImage(root.id);
  const form = await create(formContentSchema.parse(value)), version = await stored(form.id);
  const bypass = richImage(randomUUID());
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "bodyRich"=${JSON.stringify(bypass)}::jsonb WHERE id=${version.id}`).rejects.toThrow(/pins differ/);
  expect((await db.formVersion.findUniqueOrThrow({ where: { id: version.id } })).bodyRich).toEqual(value.bodyRich);

  await expect(db.$executeRaw`INSERT INTO "AuthorAssetReference"(id,"assetId","tenantId","serviceId","formVersionId","documentKey","nodeKey",slot)
    VALUES(${randomUUID()},${root.id},${ctx.tenantId},${serviceId},${version.id},'completion',${randomUUID()},'form_content')`).rejects.toThrow();
  const storedAsset = await db.authorAsset.findUniqueOrThrow({ where: { id: root.id } });
  await expect(db.authorAsset.update({ where: { id: root.id }, data: { status: "deleting", version: storedAsset.version + 1 } })).rejects.toThrow(/still referenced/);
  expect(await refs(root.id)).toHaveLength(1);
});

test("concurrent rich attachment and GC transition serialize to one consistent winner", async () => {
  const root = await asset("FORM_CONTENT_IMAGE"), form = await create(content());
  const next = await current(form.id); next.body = ""; next.bodyRich = richImage(root.id);
  const results = await Promise.allSettled([
    updateForm(ctx, form.id, { version: 1, content: next }, randomUUID()),
    db.$transaction(tx => tx.authorAsset.update({ where: { id: root.id }, data: { status: "deleting", version: { increment: 1 } } }), { timeout: 10_000 }),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const storedAsset = await db.authorAsset.findUniqueOrThrow({ where: { id: root.id } });
  const pins = await refs(root.id);
  if (pins.length) {
    expect(storedAsset.status).toBe("ready"); expect(storedAsset.expiresAt).toBeNull();
    expect((await current(form.id)).bodyRich).toEqual(next.bodyRich);
  } else {
    expect(storedAsset.status).toBe("deleting");
    expect((await current(form.id))).not.toHaveProperty("bodyRich");
  }
});

test("form creation stores material/image metadata, exact physical pins and one logical quota charge", async () => {
  const file = await asset(), image = await asset("OPTION_IMAGE"), value = content(file.id, image.id), form = await create(value), row = await stored(form.id);
  expect((await current(form.id)).questions[0]).toMatchObject(value.questions[0]);
  expect(row.questions[0].options[0].optionImageKey).toBe(image.id);
  expect(await refs()).toHaveLength(2);
  expect(await refs()).toEqual(expect.arrayContaining([
    expect.objectContaining({ assetId: file.id, questionId: row.questions[0].id, questionKey: value.questions[0].id, formVersionId: row.id, slot: "material", orderNumber: 0 }),
    expect.objectContaining({ assetId: image.id, questionId: row.questions[0].id, optionKey: value.questions[0].optionDefinitions![0].id, slot: "option" }),
  ]));
  expect((await db.authorAsset.findMany()).every(item => item.expiresAt === null)).toBe(true);
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: 4 + png.length });
  expect(await db.auditEvent.count({ where: { action: "author_asset.attached" } })).toBe(2);
  expect(JSON.stringify(await current(form.id))).not.toContain(file.blobId);
});
test("legacy null images remain absent and a title-only save preserves pins and immutable identities", async () => {
  const image = await asset("OPTION_IMAGE"), form = await create(content(undefined, image.id)), before = await stored(form.id), beforeRefs = await refs();
  expect((await current(form.id)).questions[0].optionDefinitions![1]).not.toHaveProperty("optionImageKey");
  await updateForm(ctx, form.id, { version: 1, title: "제목 수정" }, randomUUID());
  expect((await stored(form.id)).questions).toEqual(before.questions); expect(await refs()).toEqual(beforeRefs);
});
test("current omission preserves images, explicit null and empty materials clear them without resurrection", async () => {
  const file = await asset(), image = await asset("OPTION_IMAGE"), form = await create(content(file.id, image.id));
  const omitted = await current(form.id); delete omitted.questions[0].materialList; delete omitted.questions[0].optionDefinitions![0].optionImageKey;
  await updateForm(ctx, form.id, { version: 1, content: omitted }, randomUUID()); expect(await refs()).toHaveLength(2);
  const clear = await current(form.id); clear.questions[0].materialList = []; clear.questions[0].optionDefinitions![0].optionImageKey = null;
  await updateForm(ctx, form.id, { version: 2, content: clear }, randomUUID()); expect(await refs()).toHaveLength(0);
  expect((await db.authorAsset.findMany()).every(item => !!item.expiresAt && item.expiresAt.getTime() > Date.now())).toBe(true);
  delete clear.questions[0].materialList; delete clear.questions[0].optionDefinitions![0].optionImageKey;
  await updateForm(ctx, form.id, { version: 3, content: clear }, randomUUID()); expect(await refs()).toHaveLength(0);
  expect((await current(form.id)).questions[0].optionDefinitions![0]).not.toHaveProperty("optionImageKey");
});
test("question and option removal releases refs before restrictive question FKs, with one-hour grace", async () => {
  const file = await asset(), image = await asset("OPTION_IMAGE"), form = await create(content(file.id, image.id));
  const next = await current(form.id); next.questions = next.questions.slice(1);
  await updateForm(ctx, form.id, { version: 1, content: next }, randomUUID()); expect(await refs()).toHaveLength(0);
  for (const row of await db.authorAsset.findMany()) expect(row.expiresAt!.getTime() - Date.now()).toBeGreaterThan(3_500_000);
  expect((await stored(form.id)).questions).toHaveLength(1);
});
test("image removal is required for type/custom changes and explicit removal preserves option identity", async () => {
  const image = await asset("OPTION_IMAGE"), form = await create(content(undefined, image.id)), prior = await stored(form.id);
  const next = await current(form.id); next.questions[0].type = "드롭다운";
  await expect(updateForm(ctx, form.id, { version: 1, content: next }, randomUUID())).rejects.toMatchObject({ status: 422 });
  next.questions[0].optionDefinitions![0].optionImageKey = null;
  await updateForm(ctx, form.id, { version: 1, content: next }, randomUUID());
  expect((await stored(form.id)).questions[0].options.map(o => o.id)).toEqual(prior.questions[0].options.map(o => o.id));
  expect(await refs()).toHaveLength(0);
});
test("scope, purpose, expiry and unknown keys reject atomically without creating forms or pins", async () => {
  const otherService = await db.service.create({ data: { tenantId: ctx.tenantId, name: "다른 서비스", externalName: "다른 서비스" } });
  const foreign = await asset("QUESTION_MATERIAL", { ...ownScope(), serviceId: otherService.id }), image = await asset("OPTION_IMAGE"), expired = await asset();
  await db.authorAsset.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1), version: { increment: 1 } } });
  for (const [id, status] of [[foreign.id, 404], [image.id, 422], [expired.id, 410], [randomUUID(), 404]] as const)
    await expect(create(content(id))).rejects.toMatchObject({ status });
  expect(await db.form.count()).toBe(0); expect(await refs()).toHaveLength(0);
});
test("a foreign member's unbound upload is rejected but an authorized same-service template may reuse a bound key", async () => {
  const user = await db.user.create({ data: { name: "동료", email: randomUUID() + "@example.test" } });
  const member = await db.membership.create({ data: { tenantId: ctx.tenantId, userId: user.id, role: "owner" } });
  const foreign = await asset("QUESTION_MATERIAL", { ...ownScope(), memberId: member.id });
  await expect(create(content(foreign.id))).rejects.toMatchObject({ status: 403, code: "AUTHOR_ASSET_UPLOAD_OWNER" });
  const file = await asset(), form = await create(content(file.id));
  const saved = await template(await current(form.id)); expect((await refs(file.id)).map(ref => ref.templateId)).toContain(saved.id);
  expect(await db.authorAsset.count()).toBe(2);
});
test("quarantined old pins survive unrelated editing but new attachments, publication and copying fail", async () => {
  const file = await asset(), form = await create(content(file.id)), before = await refs();
  await db.authorAssetBlob.update({ where: { id: file.blobId }, data: { status: "quarantined", scanStatus: "infected", version: { increment: 1 } } });
  const next = await current(form.id); next.questions[0].label = "문구 수정";
  await updateForm(ctx, form.id, { version: 1, content: next }, randomUUID()); expect(await refs()).toEqual(before);
  await expect(create(content(file.id))).rejects.toMatchObject({ status: 409, code: "AUTHOR_ASSET_NOT_READY" });
  await expect(publish(form.id, 2)).rejects.toMatchObject({ status: 409, code: "AUTHOR_ASSET_NOT_READY" });
  await expect(db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()))).rejects.toMatchObject({ status: 409 });
  expect(await db.form.count()).toBe(1); expect(await db.authorAsset.count()).toBe(1);
});
test("409 conflicts and attachment/detachment audit failures roll back rows, pins and lifetime together", async () => {
  const first = await asset(), second = await asset(), form = await create(content(first.id)), before = await refs(), old = await db.authorAsset.findMany({ orderBy: { id: "asc" } });
  const next = await current(form.id); next.questions[0].materialList = [material(second.id)];
  await expect(updateForm(ctx, form.id, { version: 99, content: next }, randomUUID())).rejects.toMatchObject({ status: 409 });
  await auditFailure();
  try { await expect(updateForm(ctx, form.id, { version: 1, content: next }, randomUUID())).rejects.toThrow(/injected author reference audit/); }
  finally { await dropAuditFailure(); }
  expect(await refs()).toEqual(before); expect(await db.authorAsset.findMany({ orderBy: { id: "asc" } })).toEqual(old);
  expect((await readForm(ctx, form.id)).version).toBe(1);
});
test("publication and revision retain original asset IDs with independent immutable version pins", async () => {
  const file = await asset(), image = await asset("OPTION_IMAGE"), form = await create(content(file.id, image.id));
  await publish(form.id); const historical = await stored(form.id, "published"), oldPins = await refs();
  await db.$transaction(tx => reviseForm(tx, ctx, form.id, 2, randomUUID()));
  expect(await db.authorAsset.count()).toBe(2); expect(await refs()).toHaveLength(4);
  const next = await current(form.id); next.questions[0].materialList = []; next.questions[0].optionDefinitions![0].optionImageKey = null;
  await updateForm(ctx, form.id, { version: 3, content: next }, randomUUID());
  expect(await refs()).toEqual(oldPins); expect(await stored(form.id, "published")).toEqual(historical);
  expect((await db.authorAsset.findMany()).every(item => item.expiresAt === null)).toBe(true);
  await expect(db.authorAssetReference.delete({ where: { id: oldPins[0].id } })).rejects.toThrow();
});
test("approval snapshots own independent pins after editable draft removes its materials", async () => {
  const file = await asset(), form = await create(content(file.id));
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true, approvalRoles: ["owner"] } });
  const approval = await db.$transaction(tx => requestApproval(tx, ctx, form.id, { version: 1, message: "검토", reference: "QA" }, randomUUID()));
  const frozen = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
  const next = await current(form.id); next.questions[0].materialList = [];
  await updateForm(ctx, form.id, { version: 2, content: next }, randomUUID());
  expect(await refs(file.id)).toEqual([expect.objectContaining({ approvalId: approval.id, formVersionId: null, questionId: null })]);
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).snapshot).toEqual(frozen.snapshot);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: file.id } })).expiresAt).toBeNull();
});
test("explicit same-service form copy allocates one new owner per unique old key, shared blob and charged bytes", async () => {
  const file = await asset(), image = await asset("OPTION_IMAGE"), value = content(file.id, image.id); value.questions[1].materialList = [material(file.id)];
  const form = await create(value), copied = await db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()));
  const first = copied.content!.questions[0].materialList![0].fileKey!, second = copied.content!.questions[1].materialList![0].fileKey!;
  expect(first).not.toBe(file.id); expect(first).toBe(second); expect(copied.content!.questions[0].id).not.toBe(value.questions[0].id);
  expect(await db.authorAsset.count()).toBe(4); expect(await db.authorAssetBlob.count()).toBe(2);
  expect(await db.authorAsset.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ blobId: file.blobId, tenantId: ctx.tenantId, serviceId, createdById: ctx.member.id, expiresAt: null });
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: (4 + png.length) * 2 });
});
test("cross-service template use copies owners while retaining source template and byte identity", async () => {
  const file = await asset(), image = await asset("OPTION_IMAGE"), saved = await template(content(file.id, image.id)), source = await db.formTemplate.findUniqueOrThrow({ where: { id: saved.id } });
  const target = await db.service.create({ data: { tenantId: ctx.tenantId, name: "대상", externalName: "대상" } });
  const copied = await db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId: target.id, version: 1 }, randomUUID(), tx));
  const id = copied.content!.questions[0].materialList![0].fileKey!;
  expect(id).not.toBe(file.id); expect(await db.authorAsset.findUniqueOrThrow({ where: { id } })).toMatchObject({ serviceId: target.id, blobId: file.blobId });
  expect(await db.formTemplate.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(source);
  expect(await refs()).toHaveLength(4);
});
test("public system templates copy new company assets and never reuse a foreign company's logical key", async () => {
  const file = await asset("QUESTION_MATERIAL", null), value = content(file.id);
  const saved = await db.$transaction(async tx => {
    const row = await tx.formTemplate.create({ data: { title: "공용 자료", category: "QA", licenseScope: "ACTIVE_SUBSCRIPTION", content: value } });
    await withAuthorAssetReferences(tx, { tenantId: null, serviceId: null, memberId: null }, { kind: "template", id: row.id }, value, randomUUID(), async () => undefined);
    return row;
  });
  const version = await db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000) + 100,
    cycle: "trial", priceKrw: 0, features: {} } });
  const trialStart = new Date(Date.now() - 1000);
  await db.billingSubscription.create({ data: { tenantId: ctx.tenantId, planId: "trial", planVersionId: version.id,
    status: "trialing", activationSource: "trial", priceKrw: 0,
    periodStart: trialStart, periodEnd: new Date(trialStart.getTime() + 7 * 86400000) } });
  const copied = await db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId, version: 1 }, randomUUID(), tx));
  const id = copied.content!.questions[0].materialList![0].fileKey!; expect(id).not.toBe(file.id);
  expect(await db.authorAsset.findUniqueOrThrow({ where: { id } })).toMatchObject({ ownerKind: "company", tenantId: ctx.tenantId, serviceId, blobId: file.blobId });
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: file.id } })).tenantId).toBeNull();
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: 4 });
});
test("template update/delete and draft purge release only their own pins with final-owner grace", async () => {
  const file = await asset(), form = await create(content(file.id)), saved = await template(await current(form.id));
  const next = structuredClone(saved.content); next.questions[0].materialList = [];
  await updateTemplate(ctx, saved.id, { version: 1, content: next }, randomUUID());
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: file.id } })).expiresAt).toBeNull();
  await deleteTemplate(ctx, saved.id, 2, randomUUID()); await purgeForm(ctx, form.id, 1, randomUUID());
  expect(await refs()).toHaveLength(0); expect(await db.form.count()).toBe(0); expect(await db.formTemplate.count()).toBe(0);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: file.id } })).expiresAt!.getTime()).toBeGreaterThan(Date.now());
});
test("quota denial rolls back copied owners and simultaneous canonical copies consume only one remaining reservation", async () => {
  const file = await asset(), form = await create(content(file.id)), limit = env.FILE_TENANT_QUOTA_BYTES;
  env.FILE_TENANT_QUOTA_BYTES = 7;
  try { await expect(db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()))).rejects.toMatchObject({ status: 409, code: "FILE_QUOTA_EXCEEDED" }); }
  finally { env.FILE_TENANT_QUOTA_BYTES = limit; }
  expect(await db.authorAsset.count()).toBe(1); expect(await db.form.count()).toBe(1);
  env.FILE_TENANT_QUOTA_BYTES = 8;
  try {
    const results = await Promise.allSettled([1, 2].map(() => db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()), { timeout: 10000 })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: "FILE_QUOTA_EXCEEDED" }) })]);
  } finally { env.FILE_TENANT_QUOTA_BYTES = limit; }
  expect(await db.authorAsset.count()).toBe(2); expect(await db.form.count()).toBe(2);
});
test("copy audit failure rolls back all owner reservations and parent graphs", async () => {
  const file = await asset(), form = await create(content(file.id)), before = await refs();
  await auditFailure();
  try { await expect(db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()))).rejects.toThrow(/injected author reference audit/); }
  finally { await dropAuditFailure(); }
  expect(await db.authorAsset.count()).toBe(1); expect(await db.authorAssetBlob.count()).toBe(1); expect(await db.form.count()).toBe(1); expect(await refs()).toEqual(before);
});
test("current membership authority and unauthorized target service reject copies without new assets", async () => {
  const file = await asset(), saved = await template(content(file.id));
  const backup = await db.user.create({ data: { name: "Backup", email: randomUUID() + "@example.test" } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: backup.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId, version: 1 }, randomUUID(), tx))).rejects.toMatchObject({ status: 403 });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "owner" } });
  const foreign = await db.company.create({ data: { name: "다른 회사", publicName: "다른 회사", services: { create: { name: "비공개", externalName: "비공개" } } }, include: { services: true } });
  await expect(db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId: foreign.services[0].id, version: 1 }, randomUUID(), tx))).rejects.toMatchObject({ status: 404 });
  expect(await db.authorAsset.count()).toBe(1); expect(await db.form.count()).toBe(0);
});
test("HTTP create/copy replay is idempotent and draft 200/409 preserves exact graph on stale save", async () => {
  const file = await asset(), value = content(file.id), created = await createRoute(request("", "POST", { serviceId, title: "HTTP 자료", content: value }));
  expect(created.status).toBe(201); const form = await created.json();
  const key = randomUUID(), copyRequest = () => request("/" + form.id + "/copy", "POST", {}, key);
  const one = await actionRoute(copyRequest()), two = await actionRoute(copyRequest());
  expect(one.status).toBe(201); expect(two.status).toBe(201); expect((await one.json()).id).toBe((await two.json()).id);
  expect(await db.authorAsset.count()).toBe(2);
  const before = await refs();
  expect((await patchRoute(request("/" + form.id, "PATCH", { version: 1, title: "수정" }))).status).toBe(200);
  expect((await patchRoute(request("/" + form.id, "PATCH", { version: 1, title: "경합" }))).status).toBe(409);
  expect(await refs()).toEqual(before);
});
test("strict database isolation and direct JSON bypass fail rather than committing an unpinned graph", async () => {
  const file = await asset(), form = await create(content(file.id)), row = await stored(form.id), before = await refs();
  await expect(db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()), { isolationLevel: "RepeatableRead" })).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "Question" SET "materialList"=NULL WHERE id=${row.questions[0].id}`).rejects.toThrow(/pins differ/);
  expect(await refs()).toEqual(before); expect(await db.authorAsset.count()).toBe(1); expect(await db.form.count()).toBe(1);
});
