import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { consentBundle } from "@/server/form-documents";
import { contentDto, copyForm, createForm, fingerprint, publishForm, readForm, reviseForm, updateForm, versionInclude } from "@/server/forms";
import { createTemplate, getTemplate, updateTemplate, useTemplate } from "@/server/templates";
import { formContentSchema } from "@/contracts/domains";
import type { RichDocumentV1 } from "@/contracts/rich-content";
import { POST as createFormRoute } from "@/app/api/v1/forms/route";
import { GET as readFormRoute, PATCH as updateFormRoute } from "@/app/api/v1/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Isolated test DB required");

let ctx: Context, serviceId: string, cookie: string;
const questionId = "6f034ba3-703a-4ae1-948d-d438d205cc28";

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Rich body QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = "rich-body-" + randomUUID() + "@example.test", password = "Rich-body-test!12345";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie }), "form.write");
});
afterAll(() => db.$disconnect());

function rich(text: string): RichDocumentV1 {
  return { schemaVersion: 1, blocks: text === "" ? [] : [{ type: "paragraph", children: [{ type: "text", text }] }] };
}
function content(body = "안내", bodyRich?: RichDocumentV1 | null) {
  return formContentSchema.parse({ body, ...(bodyRich !== undefined ? { bodyRich } : {}),
    questions: [{ id: questionId, type: "단문형 답변", label: "이름", required: true }],
    consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
}
async function create(value = content()) {
  return db.$transaction(tx => createForm(ctx, { serviceId, title: "Rich body", content: value }, randomUUID(), tx));
}
function api(path: string, method: string, value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...headers,
    ...(value === undefined ? {} : { "content-type": "application/json" }) },
  ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}

test("legacy SQL null stays omitted from DTO and from the exact approval fingerprint payload", async () => {
  const form = await create(content("기존 본문", null));
  const stored = await db.formVersion.findFirstOrThrow({ where: { formId: form.id }, include: versionInclude });
  expect(stored.bodyRich).toBeNull();
  const dto = contentDto(stored);
  expect(dto).not.toHaveProperty("bodyRich");
  const expectedContent = structuredClone(dto);
  const expected = createHash("sha256").update(JSON.stringify({ title: stored.title, content: expectedContent,
    ...([1, 2].includes(stored.receiptEvidenceVersion) ? { consentBundle: consentBundle(stored) } : {}) })).digest("hex");
  expect(fingerprint(stored)).toBe(expected);
  expect((await readForm(ctx, form.id)).content).not.toHaveProperty("bodyRich");
});

test("rich body persists while omission preserves only the current draft and explicit null never resurrects history", async () => {
  const document = rich("서식 본문"), form = await create(content("서식 본문", document));
  expect((await db.formVersion.findFirstOrThrow({ where: { formId: form.id } })).bodyRich).toEqual(document);
  expect((await readForm(ctx, form.id)).content).toHaveProperty("bodyRich", document);

  const oldSame = content("서식 본문") as Record<string, unknown>;
  await updateForm(ctx, form.id, { version: 1, content: formContentSchema.parse(oldSame) }, randomUUID());
  expect((await readForm(ctx, form.id)).content).toHaveProperty("bodyRich", document);

  await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: 2 }, randomUUID()));
  await db.$transaction(tx => reviseForm(tx, ctx, form.id, 3, randomUUID()));
  await updateForm(ctx, form.id, { version: 4, content: formContentSchema.parse(oldSame) }, randomUUID());

  const changedWithoutRich = content("모호한 구형 수정");
  await expect(updateForm(ctx, form.id, { version: 5, content: changedWithoutRich }, randomUUID()))
    .rejects.toMatchObject({ status: 422, code: "RICH_BODY_AMBIGUOUS" });
  expect((await readForm(ctx, form.id)).version).toBe(5);

  await updateForm(ctx, form.id, { version: 5, content: content("평문 전환", null) }, randomUUID());
  expect((await readForm(ctx, form.id)).content).not.toHaveProperty("bodyRich");
  await updateForm(ctx, form.id, { version: 6, content: content("평문 후속 수정") }, randomUUID());
  const versions = await db.formVersion.findMany({ where: { formId: form.id }, orderBy: { number: "asc" } });
  expect(versions).toHaveLength(2);
  expect(versions[0].bodyRich).toEqual(document);
  expect(versions[1].bodyRich).toBeNull();
  await expect(db.formVersion.update({ where: { id: versions[0].id }, data: { bodyRich: rich("게시본 변조") } })).rejects.toThrow();
  expect((await readForm(ctx, form.id)).content).not.toHaveProperty("bodyRich");
});

test("template JSON follows the same preserve, ambiguous omission and explicit removal rules", async () => {
  const document = rich("템플릿 본문"), initial = content("템플릿 본문", document);
  const template = await db.$transaction(tx => createTemplate(ctx,
    { serviceId, title: "Rich template", category: "QA", content: initial }, randomUUID(), tx));
  expect(template.content).toHaveProperty("bodyRich", document);

  await updateTemplate(ctx, template.id, { version: 1, content: content("템플릿 본문") }, randomUUID());
  expect((await getTemplate(ctx, template.id)).content).toHaveProperty("bodyRich", document);
  await expect(updateTemplate(ctx, template.id, { version: 2, content: content("모호한 수정") }, randomUUID()))
    .rejects.toMatchObject({ status: 422, code: "RICH_BODY_AMBIGUOUS" });
  await updateTemplate(ctx, template.id, { version: 2, content: content("평문 템플릿", null) }, randomUUID());
  expect((await getTemplate(ctx, template.id)).content).not.toHaveProperty("bodyRich");
  expect((await db.formTemplate.findUniqueOrThrow({ where: { id: template.id } }).then(row => row.content))).not.toHaveProperty("bodyRich");
});

test("adding rich semantics changes the approval fingerprint and form/template copies retain the snapshot", async () => {
  const document = rich("같은 평문"), source = await create(content("같은 평문"));
  const legacy = await db.formVersion.findFirstOrThrow({ where: { formId: source.id }, include: versionInclude });
  const legacyHash = fingerprint(legacy);
  await updateForm(ctx, source.id, { version: 1, content: content("같은 평문", document) }, randomUUID());
  const richVersion = await db.formVersion.findFirstOrThrow({ where: { formId: source.id }, include: versionInclude });
  expect(fingerprint(richVersion)).not.toBe(legacyHash);

  const copied = await db.$transaction(tx => copyForm(tx, ctx, source.id, "Rich copy", randomUUID()));
  expect(copied.content).toHaveProperty("bodyRich", document);
  const template = await db.$transaction(tx => createTemplate(ctx,
    { serviceId, title: "Copy template", category: "QA", content: content("같은 평문", document) }, randomUUID(), tx));
  const used = await db.$transaction(tx => useTemplate(ctx, template.id,
    { version: 1, serviceId, title: "Template copy" }, randomUUID(), tx));
  expect(used.content).toHaveProperty("bodyRich", document);
});

test("real HTTP create, read and patch routes expose the same compatibility behavior", async () => {
  const document = rich("HTTP 서식");
  const createdResponse = await createFormRoute(api("/forms", "POST",
    { serviceId, title: "HTTP rich", content: content("HTTP 서식", document) }, { "idempotency-key": randomUUID() }));
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.content.bodyRich).toEqual(document);
  const id = created.id as string;

  const readResponse = await readFormRoute(api("/forms/" + id, "GET"));
  expect(readResponse.status).toBe(200);
  expect((await readResponse.json()).content.bodyRich).toEqual(document);

  const preserved = await updateFormRoute(api("/forms/" + id, "PATCH", { version: 1, content: content("HTTP 서식") }));
  expect(preserved.status).toBe(200);
  expect((await preserved.json()).content.bodyRich).toEqual(document);

  const ambiguous = await updateFormRoute(api("/forms/" + id, "PATCH", { version: 2, content: content("구형 수정") }));
  expect(ambiguous.status).toBe(422);
  expect((await ambiguous.json()).error.code).toBe("RICH_BODY_AMBIGUOUS");

  const removed = await updateFormRoute(api("/forms/" + id, "PATCH", { version: 2, content: content("평문", null) }));
  expect(removed.status).toBe(200);
  expect((await removed.json()).content).not.toHaveProperty("bodyRich");
});

test("projection mismatches, unknown image IDs and grossly invalid SQL JSON fail without partial rows", async () => {
  expect(formContentSchema.safeParse({ ...content("일치"), bodyRich: rich("불일치") }).success).toBe(false);
  const image: RichDocumentV1 = { schemaVersion: 1, blocks: [{ type: "image", nodeId: randomUUID(), assetId: randomUUID(), alt: "" }] };
  await expect(create(content("", image))).rejects.toMatchObject({ status: 404, code: "AUTHOR_ASSET_NOT_FOUND" });
  expect(await db.form.count()).toBe(0);
  await expect(db.$transaction(tx => createTemplate(ctx,
    { serviceId, title: "Image template", category: "QA", content: content("", image) }, randomUUID(), tx)))
    .rejects.toMatchObject({ status: 404, code: "AUTHOR_ASSET_NOT_FOUND" });
  expect(await db.formTemplate.count()).toBe(0);

  const form = await create();
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id } });
  await expect(db.$executeRaw`UPDATE "FormVersion" SET "bodyRich"=${JSON.stringify({ schemaVersion: 1, blocks: {} })}::jsonb WHERE id=${version.id}`)
    .rejects.toThrow();
  expect((await db.formVersion.findUniqueOrThrow({ where: { id: version.id } })).bodyRich).toBeNull();
  await db.$executeRaw`UPDATE "FormVersion" SET "bodyRich"=${JSON.stringify(rich("다른 투영"))}::jsonb WHERE id=${version.id}`;
  const corrupted = await db.formVersion.findUniqueOrThrow({ where: { id: version.id }, include: versionInclude });
  expect(() => contentDto(corrupted)).toThrow("Stored rich body text projection does not match body");
});
