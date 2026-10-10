import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import sharp from "sharp";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { formContentSchema } from "@/contracts/domains";
import type { ConsentEvidenceV2 } from "@/contracts/form-documents";
import { plainTextRichDocument } from "@/contracts/rich-content";
import { createForm, publishForm } from "@/server/forms";
import { submitForm } from "@/server/submissions";
import { privateConsentReceiptPdf } from "@/server/consent-receipts";
import { correctSubmission } from "@/server/submission-management";
import { decrypt } from "@/server/crypto";
import { initAuthorAssetUpload, putAuthorAssetContent, completeAuthorAssetUpload } from "@/server/author-asset-uploads";
import { privateFiles } from "@/server/file-storage";
import { requireFileScanner } from "@/server/file-scanner";
import { pdfActualText } from "../fixtures/pdf-actual-text";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required");
let ctx: Context, serviceId: string;

async function clearStored() {
  for (const row of await db.authorAssetBlob.findMany({ select: { storageKey: true } })) await privateFiles.remove(row.storageKey);
}
beforeAll(() => requireFileScanner());
beforeEach(async () => {
  await clearStored();
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Rich receipt QA", publicName: "Rich receipt QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "Receipt service", externalName: "Receipt service" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = `receipt-${randomUUID()}@example.test`, password = "Receipt-rich-test!123";
  const request = (path: string, body: unknown) => new Request(`${origin}/api/v1/auth/${path}`,
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  ctx = await requireContext(new Headers({ cookie: login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
});
afterAll(async () => { await clearStored(); await db.$disconnect(); });

async function imageAsset(purpose: "FORM_CONTENT_IMAGE" | "PAGE_CONTENT_IMAGE", color: string, width = 800, height = 420) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex"), name = purpose === "FORM_CONTENT_IMAGE" ? "root.png" : "page.png";
  const init = await initAuthorAssetUpload(ctx, { serviceId, purpose, name, mime: "image/png", size: bytes.length, sha256: sourceSha256 }, randomUUID(), randomUUID());
  await putAuthorAssetContent(ctx, init.body.id, new Request(origin + "/upload", { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes) }), randomUUID());
  await completeAuthorAssetUpload(ctx, init.body.id, randomUUID());
  return { id: init.body.id, sourceSha256, bytes };
}
function rich(text: string, image?: { id: string; nodeId: string; alt: string }) {
  return { schemaVersion: 1 as const, blocks: [
    { type: "heading" as const, level: 2 as const, children: [{ type: "text" as const, text }] },
    ...(image ? [{ type: "image" as const, nodeId: image.nodeId, assetId: image.id, alt: image.alt,
      alignment: "center" as const, width: { unit: "percent" as const, value: 72 } }] : []),
  ] };
}
async function imageOperators(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const document = await task.promise; let count = 0;
    for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
      const page = await document.getPage(pageNo), operators = await page.getOperatorList();
      count += operators.fnArray.filter(operator => operator === OPS.paintImageXObject || operator === OPS.paintInlineImageXObject).length;
    }
    return count;
  } finally { await task.destroy(); }
}

test("rich v2 receipts pin the exact visited documents and image hashes while old receipts remain immutable", async () => {
  const root = await imageAsset("FORM_CONTENT_IMAGE", "#2563eb"), page = await imageAsset("PAGE_CONTENT_IMAGE", "#d97706");
  const first = randomUUID(), detail = randomUUID(), finish = randomUUID(), route = randomUUID(), detailQuestion = randomUUID(), finishQuestion = randomUUID();
  const rootNode = randomUUID(), pageNode = randomUUID(), short = randomUUID(), long = randomUUID();
  const content = formContentSchema.parse({
    body: "영수증 루트 본문\n", bodyRich: rich("영수증 루트 본문", { id: root.id, nodeId: rootNode, alt: "루트 파란 이미지" }),
    sections: [
      { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: detail }, allowBack: false },
      { id: detail, title: "상세 안내", body: "영수증 상세 페이지\n", bodyRich: rich("영수증 상세 페이지", { id: page.id, nodeId: pageNode, alt: "상세 주황 이미지" }),
        defaultDestination: { kind: "page", pageId: finish }, allowBack: true },
      { id: finish, title: "최종 안내", body: "최종 확인", bodyRich: plainTextRichDocument("최종 확인"), defaultDestination: { kind: "consent" }, allowBack: true },
    ],
    completionPage: { mode: "custom", body: "완료 안내는 증거에 없어야 합니다", bodyRich: plainTextRichDocument("완료 안내는 증거에 없어야 합니다") },
    closedPage: { mode: "custom", body: "마감 안내는 증거에 없어야 합니다", bodyRich: plainTextRichDocument("마감 안내는 증거에 없어야 합니다") },
    questions: [
      { id: route, pageId: first, type: "객관식 답변", label: "경로", required: true, options: ["짧게", "상세"], optionDefinitions: [
        { id: short, label: "짧게", value: "짧게", branchDestination: { kind: "page", pageId: finish } },
        { id: long, label: "상세", value: "상세", branchDestination: { kind: "page", pageId: detail } },
      ] },
      { id: detailQuestion, pageId: detail, type: "단문형 답변", label: "상세 답변", required: true },
      { id: finishQuestion, pageId: finish, type: "단문형 답변", label: "최종 답변", required: true },
    ],
    consentRequired: true, consentPurpose: "rich v2 영수증", retentionDays: 30, maxResponses: 10,
  });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "Rich receipt", content }, randomUUID(), tx));
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id } });
  expect(version.receiptEvidenceVersion).toBe(2);
  const storage = await db.authorAsset.findMany({ where: { id: { in: [root.id, page.id] } }, include: { blob: true } });
  const read = vi.spyOn(privateFiles, "read");
  const publication = await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: form.version }, randomUUID()));
  expect(new Set(read.mock.calls.map(call => call[0]))).toEqual(new Set(storage.map(item => item.blob.storageKey)));
  read.mockRestore();

  const longSubmission = await submitForm(publication.token, { consent: true, answers: {
    [route]: "상세", [detailQuestion]: "상세 입력", [finishQuestion]: "최종 입력",
  } }, randomUUID(), randomUUID());
  const longReceipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: longSubmission.body.id } });
  const evidence = decrypt<ConsentEvidenceV2>(longReceipt.evidenceCipher!);
  expect(longReceipt.evidenceVersion).toBe(2);
  expect(evidence).toMatchObject({ schemaVersion: 2, presentation: {
    pagePathVersion: 1, visitedPageIds: [first, detail, finish], terminationKind: "consent",
  } });
  expect(evidence.presentation.documents.map(document => [document.kind, document.key])).toEqual([
    ["root", "form"], ["page", first], ["page", detail], ["page", finish],
  ]);
  const images = evidence.presentation.documents.flatMap(document => document.images);
  expect(images.map(image => image.sourceSha256)).toEqual([root.sourceSha256, page.sourceSha256]);
  expect(images.every(image => image.renderSha256 !== image.sourceSha256 && image.renderBytes > 0)).toBe(true);
  expect(images.map(image => image.purpose)).toEqual(["FORM_CONTENT_IMAGE", "PAGE_CONTENT_IMAGE"]);
  expect(JSON.stringify(evidence)).not.toMatch(/완료 안내는|마감 안내는/);
  const pdfBytes = Buffer.from(decrypt<string>(longReceipt.pdfCipher!), "base64");
  expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(longReceipt.pdfHash);
  const actualText = pdfActualText(pdfBytes).join("\n");
  expect(actualText).toContain("영수증 루트 본문"); expect(actualText).toContain("영수증 상세 페이지");
  expect(actualText).not.toMatch(/완료 안내는|마감 안내는/);
  expect(await imageOperators(pdfBytes)).toBeGreaterThanOrEqual(2);
  expect(Buffer.from((await privateConsentReceiptPdf(ctx, longSubmission.body.id, longReceipt.id, randomUUID())).bytes)).toEqual(pdfBytes);

  const shortSubmission = await submitForm(publication.token, { consent: true, answers: {
    [route]: "짧게", [finishQuestion]: "바로 완료",
  } }, randomUUID(), randomUUID());
  const shortReceipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: shortSubmission.body.id } });
  const shortEvidence = decrypt<ConsentEvidenceV2>(shortReceipt.evidenceCipher!);
  expect(shortEvidence.presentation.visitedPageIds).toEqual([first, finish]);
  expect(shortEvidence.presentation.documents.map(document => document.key)).toEqual(["form", first, finish]);
  expect(shortEvidence.presentation.documents.flatMap(document => document.images).map(image => image.assetId)).toEqual([root.id]);
  expect(JSON.stringify(shortEvidence)).not.toContain("영수증 상세 페이지");

  const frozen = { evidenceCipher: longReceipt.evidenceCipher, pdfCipher: longReceipt.pdfCipher, documentHash: longReceipt.documentHash, pdfHash: longReceipt.pdfHash };
  await correctSubmission(ctx, longSubmission.body.id, { version: 1, reason: "짧은 경로로 정정", answers: { [route]: "짧게" } }, randomUUID());
  expect(await db.submission.findUniqueOrThrow({ where: { id: longSubmission.body.id } })).toMatchObject({ visitedPageKeys: [first, finish], version: 2 });
  expect(await db.consentReceipt.findUniqueOrThrow({ where: { id: longReceipt.id } })).toMatchObject(frozen);
});

test("v2 database constraints reject incomplete evidence while legacy v1 still renders", async () => {
  const content = formContentSchema.parse({ body: "legacy", questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }],
    consentRequired: true, consentPurpose: "legacy v1", retentionDays: 30, maxResponses: 2 });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "Legacy", content }, randomUUID(), tx));
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id } }); expect(version.receiptEvidenceVersion).toBe(1);
  const publication = await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: form.version }, randomUUID()));
  const submitted = await submitForm(publication.token, { consent: true, answers: { [content.questions[0].id]: "홍길동" } }, randomUUID(), randomUUID());
  expect(await db.consentReceipt.findFirstOrThrow({ where: { submissionId: submitted.body.id } })).toMatchObject({ evidenceVersion: 1, pdfHash: expect.any(String) });
  await expect(db.consentReceipt.create({ data: { tenantId: ctx.tenantId, submissionId: submitted.body.id, purpose: "invalid", documentHash: "a".repeat(64),
    retentionDays: 1, evidenceVersion: 2 } })).rejects.toThrow();
});

test("publish preflight rejects the largest page composition when repeated images exceed the decoded-pixel budget", async () => {
  const asset = await imageAsset("FORM_CONTENT_IMAGE", "#16a34a", 2048, 2048);
  const images = Array.from({ length: 25 }, () => ({ type: "image" as const, nodeId: randomUUID(), assetId: asset.id,
    alt: "반복되는 고해상도 이미지", width: { unit: "percent" as const, value: 100 } }));
  const content = formContentSchema.parse({
    body: "픽셀 예산" + "\n".repeat(images.length),
    bodyRich: { schemaVersion: 1, blocks: [
      { type: "heading", level: 2, children: [{ type: "text", text: "픽셀 예산" }] }, ...images,
    ] },
    questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }],
    consentRequired: true, consentPurpose: "픽셀 예산 확인", retentionDays: 30, maxResponses: 2,
  });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "Pixel budget", content }, randomUUID(), tx));
  await expect(db.$transaction(tx => publishForm(tx, ctx, form.id, { version: form.version }, randomUUID())))
    .rejects.toMatchObject({ status: 422, code: "PDF_IMAGE_TOO_LARGE" });
  expect(await db.publication.count({ where: { formId: form.id } })).toBe(0);
  expect(await db.form.findUniqueOrThrow({ where: { id: form.id } })).toMatchObject({ status: "draft", version: 1 });
});
