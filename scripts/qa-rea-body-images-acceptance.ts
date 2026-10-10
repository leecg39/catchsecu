import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { contentDto, versionInclude } from "../src/server/forms";
import { formContentSchema } from "../src/contracts/domains";
import type { FormContent, FormRecord } from "../src/contracts/forms";
import type { ConsentEvidenceV2 } from "../src/contracts/form-documents";
import { plainTextRichDocument, richDocumentImages, richDocumentText, type RichDocumentV1 } from "../src/contracts/rich-content";
import { authorAssetSlots } from "../src/server/author-asset-references";
import { readConsentEvidence } from "../src/server/consent-receipts";

const mode = process.argv[2];
assert.ok(["prepare", "capture-original", "capture-submission", "publish-responsive", "pause-responsive", "resume-responsive", "revise", "assert-history", "state", "freeze", "verify"].includes(mode));
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert.equal(origin, "http://localhost:3115");
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));

const localDirectory = resolve(".local/rea-fullstack/body-images-acceptance");
const fixturePath = resolve(localDirectory, "fixture.json");
const evidenceDirectory = resolve("docs/qa/R08-T02/body-images/full-acceptance");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const revised = {
  root: "BI07 수정 루트",
  page: "BI07 수정 페이지",
  completion: "BI07 수정 완료",
  closed: "BI07 수정 마감",
};

type Sample = { path: string; name: string; mime: "image/png" | "image/jpeg"; size: number; sha256: string; width: number; height: number };
type Fixture = {
  format: 1;
  email: string;
  password: string;
  tenantId: string;
  serviceId: string;
  formId: string;
  pageIds: string[];
  questionIds: string[];
  samples: Record<"root" | "page" | "completion" | "closed", Sample>;
  preparedAt: string;
  original?: {
    versionId: string;
    publicationId: string;
    publicToken: string;
    versionHash: string;
    pinsHash: string;
    assetIds: string[];
    sourceHashes: string[];
    copiedFormId: string;
    templateUsedFormId: string;
    deletedTemplateId: string;
  };
  submission?: { id: string; receiptId: string; documentHash: string; pdfHash: string };
  responsive?: { formId: string; publicationId: string; publicToken: string };
  historyVerifiedAt?: string;
  frozenAt?: string;
  frozenHash?: string;
};

type HttpOptions = { method?: string; body?: unknown; headers?: Record<string, string>; expected?: number };
async function request<T>(path: string, cookie: string, options: HttpOptions = {}) {
  const response = await fetch(origin + "/api/v1" + path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    redirect: "error",
    headers: {
      origin,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(options.method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, options.expected ?? 200, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return { response, body: body as T };
}
async function login(fixture: Pick<Fixture, "email" | "password">) {
  const response = await request("/auth/sign-in/email", "", {
    method: "POST", body: { email: fixture.email, password: fixture.password }, expected: 200,
  });
  return response.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
}
function documents(content: FormContent) {
  const rows: { slot: "form_content" | "page_content" | "end_page_content" | "private_page_content"; key: string; document: RichDocumentV1 }[] = [];
  if (content.bodyRich) rows.push({ slot: "form_content", key: "form", document: content.bodyRich });
  for (const section of content.sections ?? []) if (section.bodyRich)
    rows.push({ slot: "page_content", key: section.id, document: section.bodyRich });
  if (content.completionPage?.mode === "custom" && content.completionPage.bodyRich)
    rows.push({ slot: "end_page_content", key: "completion", document: content.completionPage.bodyRich });
  if (content.closedPage?.mode === "custom" && content.closedPage.bodyRich)
    rows.push({ slot: "private_page_content", key: "closed", document: content.closedPage.bodyRich });
  return rows;
}
function contentImages(content: FormContent) {
  return documents(content).flatMap(row => richDocumentImages(row.document).map(image => ({ ...row, image })));
}
async function storedForm(id: string) {
  return db.form.findUniqueOrThrow({ where: { id }, include: {
    versions: { include: versionInclude, orderBy: { number: "asc" } },
    publications: { orderBy: { createdAt: "asc" } },
  } });
}
async function blobProof(tenantId: string) {
  const assets = await db.authorAsset.findMany({ where: { tenantId, status: "ready" }, include: { blob: true }, orderBy: { id: "asc" } });
  const unique = new Map(assets.map(asset => [asset.blobId, asset.blob]));
  const proof = [];
  for (const blob of unique.values()) {
    assert.equal(blob.status, "ready"); assert.equal(blob.scanStatus, "clean"); assert.match(blob.scanEngine!, /^ClamAV /);
    const bytes = await privateFiles.read(blob.storageKey);
    assert.equal(bytes.length, blob.size); assert.equal(hash(bytes), blob.sha256);
    proof.push({ sha256: blob.sha256, size: blob.size });
  }
  return proof.sort((a, b) => a.sha256.localeCompare(b.sha256));
}
async function state(fixture: Fixture) {
  const forms = await db.form.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" }, include: {
    versions: { include: versionInclude, orderBy: { number: "asc" } },
    publications: { orderBy: { id: "asc" } },
  } });
  const assets = await db.authorAsset.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" }, include: { blob: true } });
  const references = await db.authorAssetReference.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" } });
  const submissions = await db.submission.findMany({ where: { tenantId: fixture.tenantId }, orderBy: { id: "asc" }, include: { receipts: { orderBy: { id: "asc" } } } });
  return {
    forms: forms.map(form => ({ id: form.id, title: form.title, status: form.status, version: form.version,
      versions: form.versions.map(version => ({ id: version.id, number: version.number, status: version.status, content: contentDto(version) })),
      publications: form.publications.map(publication => ({ id: publication.id, formVersionId: publication.formVersionId, status: publication.status,
        responseCount: publication.responseCount, maxResponses: publication.maxResponses, expiresAt: publication.expiresAt })) })),
    assets: assets.map(asset => ({ id: asset.id, purpose: asset.purpose, status: asset.status, expiresAt: asset.expiresAt,
      blob: { id: asset.blob.id, status: asset.blob.status, scanStatus: asset.blob.scanStatus, sha256: asset.blob.sha256, size: asset.blob.size } })),
    references: references.map(reference => ({ assetId: reference.assetId, formVersionId: reference.formVersionId, templateId: reference.templateId,
      slot: reference.slot, documentKey: reference.documentKey, nodeKey: reference.nodeKey })),
    submissions: submissions.map(submission => ({ id: submission.id, formVersionId: submission.formVersionId,
      pagePathVersion: submission.pagePathVersion, visitedPageKeys: submission.visitedPageKeys, terminationKind: submission.terminationKind,
      receipts: submission.receipts.map(receipt => ({ id: receipt.id, evidenceVersion: receipt.evidenceVersion,
        documentHash: receipt.documentHash, pdfHash: receipt.pdfHash })) })),
    templates: await db.formTemplate.count({ where: { tenantId: fixture.tenantId } }),
  };
}
async function assertClone(sourceIds: string[], formId: string) {
  const form = await storedForm(formId), content = contentDto(form.versions.at(-1)!);
  const cloneIds = contentImages(content).map(row => row.image.assetId);
  assert.equal(cloneIds.length, 4); assert.equal(new Set(cloneIds).size, 4);
  assert.equal(cloneIds.some(id => sourceIds.includes(id)), false);
  const rows = await db.authorAsset.findMany({ where: { id: { in: cloneIds } }, include: { blob: true } });
  return rows.map(row => row.blob.sha256).sort();
}

let fixture: Fixture | undefined;
try {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 }); await chmod(localDirectory, 0o700);
  await mkdir(evidenceDirectory, { recursive: true });
  if (mode === "prepare") {
    const email = `body-images-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(24).toString("base64url") + "Aa!1";
    await request("/auth/sign-up/email", "", { method: "POST", body: { email, password, name: "본문 이미지 전체 수용" }, expected: 200 });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const cookie = await login({ email, password });
    const company = await request<{ id: string }>("/companies", cookie, {
      method: "POST", body: { name: "본문 이미지 전체 수용", publicName: "Body Images Acceptance" }, expected: 201,
    });
    const service = await db.service.findFirstOrThrow({ where: { tenantId: company.body.id }, orderBy: { createdAt: "asc" } });
    const samples = {} as Fixture["samples"];
    for (const sample of [
      { key: "root" as const, name: "root-landscape.png", mime: "image/png" as const, width: 960, height: 480, color: "#2563eb" },
      { key: "page" as const, name: "page-portrait.jpg", mime: "image/jpeg" as const, width: 480, height: 960, color: "#ea580c" },
      { key: "completion" as const, name: "completion-green.png", mime: "image/png" as const, width: 720, height: 360, color: "#15803d" },
      { key: "closed" as const, name: "closed-purple.jpg", mime: "image/jpeg" as const, width: 720, height: 360, color: "#7e22ce" },
    ]) {
      const image = sharp({ create: { width: sample.width, height: sample.height, channels: 3, background: sample.color } });
      const bytes = await (sample.mime === "image/png" ? image.png() : image.jpeg({ quality: 90 })).toBuffer();
      const path = resolve(localDirectory, sample.name); await writeFile(path, bytes, { mode: 0o600 });
      samples[sample.key] = { path, name: sample.name, mime: sample.mime, size: bytes.length, sha256: hash(bytes), width: sample.width, height: sample.height };
    }
    const pageIds = [randomUUID(), randomUUID()], questionIds = [randomUUID(), randomUUID()];
    const content = formContentSchema.parse({
      body: "BI07 루트 초기 안내", formLanguage: "ar", consentRequired: true,
      consentPurpose: "BI07 rich body image lifecycle", retentionDays: 30, maxResponses: 10, showSubmitNotice: true,
      sections: [
        { id: pageIds[0], title: "", body: "", defaultDestination: { kind: "page", pageId: pageIds[1] }, allowBack: false },
        { id: pageIds[1], title: "BI07 الصفحة الثانية", body: "BI07 페이지 초기 안내",
          defaultDestination: { kind: "consent" }, allowBack: true },
      ],
      completionPage: { mode: "custom", body: "BI07 완료 초기", bodyRich: plainTextRichDocument("BI07 완료 초기") },
      closedPage: { mode: "custom", body: "BI07 마감 초기", bodyRich: plainTextRichDocument("BI07 마감 초기") },
      questions: [
        { id: questionIds[0], pageId: pageIds[0], type: "단문형 답변", label: "BI07 첫 입력", required: true, textMaxLength: 100 },
        { id: questionIds[1], pageId: pageIds[1], type: "단문형 답변", label: "BI07 둘째 입력", required: true, textMaxLength: 100 },
      ],
    });
    const form = await request<FormRecord>("/forms", cookie, {
      method: "POST", body: { serviceId: service.id, title: "BI07 본문 이미지 전체 수용", content }, expected: 201,
    });
    fixture = { format: 1, email, password, tenantId: company.body.id, serviceId: service.id, formId: form.body.id,
      pageIds, questionIds, samples, preparedAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    const report = { result: "passed", mode, at: new Date().toISOString(), formId: fixture.formId, pages: 2, sampleImages: 4,
      credentialsStoredOnlyInIgnoredFixture: true, priorFrozenFixturesTouched: false };
    await writeFile(resolve(evidenceDirectory, "prepare.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } else {
    fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
    assert.equal(fixture.format, 1); assert(!fixture.frozenHash || ["state", "verify"].includes(mode), "Frozen fixture is read-only");
    const cookie = ["capture-original", "publish-responsive", "pause-responsive", "resume-responsive", "revise"].includes(mode) ? await login(fixture) : "";
    if (mode === "capture-original") {
      assert(!fixture.original, "Original publication may be captured once");
      const api = (await request<FormRecord>(`/forms/${fixture.formId}`, cookie)).body;
      assert(api.publication?.token); assert.equal(api.status, "published");
      const form = await storedForm(fixture.formId);
      const publication = form.publications.find(row => row.status === "active"); assert(publication);
      const version = form.versions.find(row => row.id === publication.formVersionId); assert(version);
      const content = contentDto(version), images = contentImages(content);
      assert.deepEqual(images.map(row => row.slot).sort(), ["end_page_content", "form_content", "page_content", "private_page_content"]);
      assert.equal(images.length, 4); assert.equal(new Set(images.map(row => row.image.assetId)).size, 4);
      const expectedPresentation = new Map([
        ["form", { alt: "BI07 루트 가로 이미지", caption: "BI07 루트 캡션", alignment: "right", width: 75 }],
        [fixture.pageIds[1], { alt: "BI07 세로 페이지 이미지", caption: "BI07 페이지 캡션", alignment: "left", width: 50 }],
        ["completion", { alt: "BI07 완료 초록 이미지", caption: "BI07 완료 캡션", alignment: "center", width: 75 }],
        ["closed", { alt: "BI07 마감 보라 이미지", caption: "BI07 마감 캡션", alignment: "right", width: 50 }],
      ]);
      for (const document of documents(content)) {
        const paragraph = document.document.blocks.find(block => block.type === "paragraph");
        assert(paragraph && paragraph.direction === "rtl", `${document.key}: expected RTL paragraph`);
        const image = richDocumentImages(document.document)[0], expected = expectedPresentation.get(document.key);
        assert(image && expected, `${document.key}: missing presentation expectation`);
        assert.equal(image.alt, expected.alt); assert.equal(image.alignment, expected.alignment);
        assert.deepEqual(image.width, { unit: "percent", value: expected.width });
        assert.equal(image.caption?.map(node => node.type === "text" ? node.text : "").join(""), expected.caption);
      }
      const slots = authorAssetSlots(content).filter(slot => slot.documentKey !== null);
      assert.equal(slots.length, 4);
      const assets = await db.authorAsset.findMany({ where: { id: { in: images.map(row => row.image.assetId) } }, include: { blob: true } });
      assert.deepEqual(assets.map(row => row.purpose).sort(), ["END_PAGE_CONTENT_IMAGE", "FORM_CONTENT_IMAGE", "PAGE_CONTENT_IMAGE", "PRIVATE_PAGE_CONTENT_IMAGE"]);
      assert(assets.every(row => row.status === "ready" && row.blob.scanStatus === "clean"));
      const sourceHashes = assets.map(row => row.blob.sha256).sort();
      assert.deepEqual(sourceHashes, Object.values(fixture.samples).map(sample => sample.sha256).sort());
      const pins = await db.authorAssetReference.findMany({ where: { formVersionId: version.id }, orderBy: { id: "asc" } });
      assert.equal(pins.filter(row => row.documentKey !== null).length, 4);

      const copied = await request<FormRecord>(`/forms/${fixture.formId}/copy`, cookie, {
        method: "POST", body: { title: "BI07 네 영역 복제본" }, expected: 201,
      });
      const template = await request<{ id: string; version: number }>("/templates", cookie, {
        method: "POST", body: { serviceId: fixture.serviceId, title: "BI07 네 영역 템플릿", category: "QA", content }, expected: 201,
      });
      const updatedTemplate = await request<{ id: string; version: number }>(`/templates/${template.body.id}`, cookie, {
        method: "PATCH", body: { version: template.body.version, title: "BI07 네 영역 템플릿 수정" }, expected: 200,
      });
      const used = await request<FormRecord>(`/templates/${template.body.id}/use`, cookie, {
        method: "POST", body: { version: updatedTemplate.body.version, serviceId: fixture.serviceId, title: "BI07 템플릿 사용본" }, expected: 201,
      });
      await request(`/templates/${template.body.id}`, cookie, {
        method: "DELETE", headers: { "if-match": String(updatedTemplate.body.version) }, expected: 204,
      });
      assert.equal(await db.formTemplate.count({ where: { id: template.body.id } }), 0);
      assert.deepEqual(await assertClone(images.map(row => row.image.assetId), copied.body.id), sourceHashes);
      assert.deepEqual(await assertClone(images.map(row => row.image.assetId), used.body.id), sourceHashes);

      fixture.original = { versionId: version.id, publicationId: publication.id, publicToken: api.publication.token,
        versionHash: hash(JSON.stringify(version)), pinsHash: hash(JSON.stringify(pins)), assetIds: images.map(row => row.image.assetId).sort(), sourceHashes,
        copiedFormId: copied.body.id, templateUsedFormId: used.body.id, deletedTemplateId: template.body.id };
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
      const report = { result: "passed", mode, at: new Date().toISOString(), formId: fixture.formId, originalVersionId: version.id,
        documents: documents(content).length, images: images.length, cleanAssets: assets.length, copiedForms: 2, templateCrud: "create-update-use-delete",
        publicTokenStoredOnlyInIgnoredFixture: true };
      await writeFile(resolve(evidenceDirectory, "capture-original.json"), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    } else if (mode === "capture-submission") {
      assert(fixture.original); assert(!fixture.submission, "Submission may be captured once");
      const originalFixture = fixture.original;
      const submission = await db.submission.findFirstOrThrow({ where: { publicationId: originalFixture.publicationId }, include: { receipts: true } });
      assert.deepEqual(submission.visitedPageKeys, fixture.pageIds); assert.equal(submission.terminationKind, "consent");
      assert.equal(submission.receipts.length, 1);
      const receipt = submission.receipts[0], evidence = readConsentEvidence(receipt) as ConsentEvidenceV2;
      assert.equal(evidence.schemaVersion, 2); assert.deepEqual(evidence.presentation.visitedPageIds, fixture.pageIds);
      const receiptImages = evidence.presentation.documents.flatMap(document => document.images);
      assert.equal(receiptImages.length, 2);
      assert(receiptImages.every(image => originalFixture.assetIds.includes(image.assetId)));
      assert.deepEqual(receiptImages.map(image => image.purpose).sort(), ["FORM_CONTENT_IMAGE", "PAGE_CONTENT_IMAGE"]);
      const serializedEvidence = JSON.stringify(evidence);
      assert.equal(serializedEvidence.includes("BI07 완료 초록 이미지"), false);
      assert.equal(serializedEvidence.includes("BI07 마감 보라 이미지"), false);
      const pdf = Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64"); assert.equal(hash(pdf), receipt.pdfHash);
      fixture.submission = { id: submission.id, receiptId: receipt.id, documentHash: receipt.documentHash, pdfHash: receipt.pdfHash! };
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
      const report = { result: "passed", mode, at: new Date().toISOString(), submissionId: submission.id, evidenceVersion: receipt.evidenceVersion,
        visitedPages: fixture.pageIds.length, receiptDocuments: evidence.presentation.documents.length, receiptImages: receiptImages.length,
        pdfHash: receipt.pdfHash, completionAndClosedExcluded: true };
      await writeFile(resolve(evidenceDirectory, "capture-submission.json"), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    } else if (mode === "publish-responsive") {
      assert(fixture.original); assert(!fixture.responsive, "Responsive clone may be published once");
      const copy = (await request<FormRecord>(`/forms/${fixture.original.copiedFormId}`, cookie)).body;
      await request(`/forms/${copy.id}/publish`, cookie, { method: "POST", body: { version: copy.version }, expected: 201 });
      const published = (await request<FormRecord>(`/forms/${copy.id}`, cookie)).body;
      assert(published.publication?.token); assert.equal(published.status, "published");
      fixture.responsive = { formId: published.id, publicationId: published.publication.id, publicToken: published.publication.token };
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
      const report = { result: "passed", mode, at: new Date().toISOString(), formId: published.id,
        images: contentImages(published.content).length, publicTokenStoredOnlyInIgnoredFixture: true };
      assert.equal(report.images, 4);
      await writeFile(resolve(evidenceDirectory, "publish-responsive.json"), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    } else if (mode === "pause-responsive" || mode === "resume-responsive") {
      assert(fixture.responsive);
      const form = (await request<FormRecord>(`/forms/${fixture.responsive.formId}`, cookie)).body;
      const action = mode === "pause-responsive" ? "pause" : "resume";
      const expectedBefore = mode === "pause-responsive" ? "published" : "paused";
      const expectedAfter = mode === "pause-responsive" ? "paused" : "published";
      assert.equal(form.status, expectedBefore);
      const updated = (await request<FormRecord>(`/forms/${form.id}/${action}`, cookie, {
        method: "POST", body: { version: form.version }, expected: 200,
      })).body;
      assert.equal(updated.status, expectedAfter);
      const report = { result: "passed", mode, at: new Date().toISOString(), formId: form.id, status: updated.status };
      await writeFile(resolve(evidenceDirectory, `${mode}.json`), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    } else if (mode === "revise") {
      assert(fixture.original && fixture.submission, "Capture the original publication and submission first");
      const api = (await request<FormRecord>(`/forms/${fixture.formId}`, cookie)).body;
      const content = structuredClone(api.content);
      content.body = revised.root; content.bodyRich = plainTextRichDocument(revised.root);
      assert(content.sections?.[1]);
      content.sections[1] = { ...content.sections[1], body: revised.page, bodyRich: plainTextRichDocument(revised.page) };
      content.completionPage = { mode: "custom", body: revised.completion, bodyRich: plainTextRichDocument(revised.completion) };
      content.closedPage = { mode: "custom", body: revised.closed, bodyRich: plainTextRichDocument(revised.closed) };
      const updated = (await request<FormRecord>(`/forms/${fixture.formId}/draft`, cookie, {
        method: "PATCH", body: { version: api.version, content }, expected: 200,
      })).body;
      assert.equal(contentImages(updated.content).length, 0);
      assert.equal(updated.hasDraft, true);
      const report = { result: "passed", mode, at: new Date().toISOString(), formId: fixture.formId,
        version: updated.version, revisedDocuments: 4, revisedImages: 0, originalVersionId: fixture.original.versionId };
      await writeFile(resolve(evidenceDirectory, "revise.json"), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    } else if (mode === "assert-history") {
      assert(fixture.original && fixture.submission); assert(!fixture.historyVerifiedAt);
      const originalFixture = fixture.original, submissionFixture = fixture.submission;
      const form = await storedForm(fixture.formId), original = form.versions.find(row => row.id === originalFixture.versionId); assert(original);
      assert.equal(hash(JSON.stringify(original)), originalFixture.versionHash);
      const originalPins = await db.authorAssetReference.findMany({ where: { formVersionId: original.id }, orderBy: { id: "asc" } });
      assert.equal(hash(JSON.stringify(originalPins)), originalFixture.pinsHash);
      const current = form.versions.find(row => row.status === "published" && row.id !== original.id); assert(current);
      const content = contentDto(current); assert.equal(contentImages(content).length, 0);
      assert.match(richDocumentText(content.bodyRich!), new RegExp(revised.root));
      assert.match(richDocumentText(content.sections![1].bodyRich!), new RegExp(revised.page));
      assert(content.completionPage?.mode === "custom" && content.closedPage?.mode === "custom");
      assert.match(richDocumentText(content.completionPage.bodyRich!), new RegExp(revised.completion));
      assert.match(richDocumentText(content.closedPage.bodyRich!), new RegExp(revised.closed));
      const submission = await db.submission.findUniqueOrThrow({ where: { id: submissionFixture.id }, include: { receipts: true } });
      assert.equal(submission.formVersionId, original.id); assert.equal(submission.receipts.length, 1);
      assert.equal(submission.receipts[0].id, submissionFixture.receiptId);
      assert.equal(submission.receipts[0].documentHash, submissionFixture.documentHash);
      assert.equal(submission.receipts[0].pdfHash, submissionFixture.pdfHash);
      assert.equal(hash(Buffer.from(decrypt<string>(submission.receipts[0].pdfCipher!), "base64")), submissionFixture.pdfHash);
      const originalAssets = await db.authorAsset.findMany({ where: { id: { in: originalFixture.assetIds } }, include: { references: true, blob: true } });
      assert.equal(originalAssets.length, 4); assert(originalAssets.every(row => row.status === "ready" && row.blob.scanStatus === "clean"));
      assert(originalAssets.every(row => row.references.some(reference => reference.formVersionId === original.id)));
      assert.deepEqual(await assertClone(originalFixture.assetIds, originalFixture.copiedFormId), originalFixture.sourceHashes);
      assert.deepEqual(await assertClone(originalFixture.assetIds, originalFixture.templateUsedFormId), originalFixture.sourceHashes);
      assert.equal(await db.authorAssetReference.count({ where: { templateId: originalFixture.deletedTemplateId } }), 0);
      await blobProof(fixture.tenantId);
      fixture.historyVerifiedAt = new Date().toISOString();
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
      const report = { result: "passed", mode, at: new Date().toISOString(), originalVersionUnchanged: true, originalPinsUnchanged: true,
        revisedVersionId: current.id, revisedImages: 0, oldReceiptUnchanged: true, clonedFormsIndependent: 2, templateReferencesAfterDelete: 0 };
      await writeFile(resolve(evidenceDirectory, "history.json"), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    } else {
      assert(fixture.historyVerifiedAt, "Run history verification first");
      const current = await state(fixture), bytes = await blobProof(fixture.tenantId), digest = hash(JSON.stringify({ current, bytes }));
      if (mode === "freeze") {
        assert(!fixture.frozenHash); fixture.frozenAt = new Date().toISOString(); fixture.frozenHash = digest;
        await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
      } else if (mode === "verify") assert.equal(digest, fixture.frozenHash);
      const report = { result: "passed", mode, at: new Date().toISOString(), hash: digest, forms: current.forms.length,
        assets: current.assets.length, references: current.references.length, submissions: current.submissions.length,
        storedBlobs: bytes.length, frozen: mode === "freeze" || mode === "verify" };
      await writeFile(resolve(evidenceDirectory, `${mode}.json`), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
    }
  }
} finally {
  await db.$disconnect();
}
