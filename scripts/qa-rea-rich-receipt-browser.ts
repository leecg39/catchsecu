import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { auth } from "../src/server/auth";
import { requireContext, type Context } from "../src/server/context";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { formContentSchema } from "../src/contracts/domains";
import type { ConsentEvidenceV2 } from "../src/contracts/form-documents";
import { plainTextRichDocument } from "../src/contracts/rich-content";
import { initAuthorAssetUpload, putAuthorAssetContent, completeAuthorAssetUpload } from "../src/server/author-asset-uploads";
import { privateFiles } from "../src/server/file-storage";
import { createForm, publishForm } from "../src/server/forms";
import { readConsentEvidence, privateConsentReceiptPdf } from "../src/server/consent-receipts";
import { pdfActualText } from "../tests/fixtures/pdf-actual-text";

const mode = process.argv[2];
assert.ok(["prepare", "verify"].includes(mode));
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert.equal(origin, "http://localhost:3114");
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const localDirectory = resolve(".local/rea-fullstack/rich-receipt-v2");
const fixturePath = resolve(localDirectory, "fixture.json");
const evidenceDirectory = resolve("docs/qa/R08-T02/body-images/receipt-v2/browser");
type Fixture = { email: string; password: string; tenantId: string; serviceId: string; formId: string; publicToken: string;
  pageIds: string[]; assetIds: string[]; sourceHashes: string[]; preparedAt: string };

async function request(path: string, body: unknown) {
  return new Request(origin + "/api/v1/auth/" + path, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
async function login(email: string, password: string) {
  const response = await auth.handler(await request("sign-in/email", { email, password }));
  assert.equal(response.status, 200);
  return requireContext(new Headers({ cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") }), "form.write");
}
async function imageAsset(ctx: Context, serviceId: string, purpose: "FORM_CONTENT_IMAGE" | "PAGE_CONTENT_IMAGE", color: string) {
  const bytes = await sharp({ create: { width: 920, height: 480, channels: 3, background: color } }).png().toBuffer();
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const upload = await initAuthorAssetUpload(ctx, { serviceId, purpose, name: purpose === "FORM_CONTENT_IMAGE" ? "root-blue.png" : "page-orange.png",
    mime: "image/png", size: bytes.length, sha256: sourceSha256 }, randomUUID(), randomUUID());
  await putAuthorAssetContent(ctx, upload.body.id, new Request(origin + "/upload", {
    method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes),
  }), randomUUID());
  await completeAuthorAssetUpload(ctx, upload.body.id, randomUUID());
  return { id: upload.body.id, sourceSha256 };
}
function rich(text: string, image: { id: string; nodeId: string; alt: string }) {
  return { schemaVersion: 1 as const, blocks: [
    { type: "heading" as const, level: 2 as const, children: [{ type: "text" as const, text }] },
    { type: "image" as const, nodeId: image.nodeId, assetId: image.id, alt: image.alt,
      alignment: "center" as const, width: { unit: "percent" as const, value: 72 } },
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
    return { count, pages: document.numPages };
  } finally { await task.destroy(); }
}

try {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 }); await chmod(localDirectory, 0o700);
  await mkdir(evidenceDirectory, { recursive: true });
  if (mode === "prepare") {
    for (const row of await db.authorAssetBlob.findMany({ select: { storageKey: true } })) await privateFiles.remove(row.storageKey);
    await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
    const email = `receipt-browser-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(24).toString("base64url") + "Aa!1";
    assert.equal((await auth.handler(await request("sign-up/email", { email, password, name: "영수증 브라우저 검증" }))).status, 200);
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    const company = await db.company.create({ data: { name: "영수증 브라우저 검증", publicName: "Receipt Browser QA",
      policy: { create: { passwordMonths: 0 } }, services: { create: { name: "영수증 검증 서비스", externalName: "영수증 검증 서비스" } } }, include: { services: true } });
    await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
    const ctx = await login(email, password), serviceId = company.services[0].id;
    const root = await imageAsset(ctx, serviceId, "FORM_CONTENT_IMAGE", "#2563eb");
    const page = await imageAsset(ctx, serviceId, "PAGE_CONTENT_IMAGE", "#d97706");
    const first = randomUUID(), second = randomUUID(), firstQuestion = randomUUID(), secondQuestion = randomUUID();
    const content = formContentSchema.parse({
      body: "브라우저 영수증 루트\n", bodyRich: rich("브라우저 영수증 루트", { id: root.id, nodeId: randomUUID(), alt: "파란 루트 이미지" }),
      sections: [
        { id: first, title: "", body: "", defaultDestination: { kind: "page", pageId: second }, allowBack: false },
        { id: second, title: "두 번째 안내", body: "브라우저 영수증 페이지\n",
          bodyRich: rich("브라우저 영수증 페이지", { id: page.id, nodeId: randomUUID(), alt: "주황 페이지 이미지" }),
          defaultDestination: { kind: "consent" }, allowBack: true },
      ],
      completionPage: { mode: "custom", body: "브라우저 제출 완료 안내", bodyRich: plainTextRichDocument("브라우저 제출 완료 안내") },
      closedPage: { mode: "custom", body: "브라우저 마감 안내", bodyRich: plainTextRichDocument("브라우저 마감 안내") },
      questions: [
        { id: firstQuestion, pageId: first, type: "단문형 답변", label: "첫 페이지 입력", required: true },
        { id: secondQuestion, pageId: second, type: "단문형 답변", label: "두 번째 페이지 입력", required: true },
      ],
      consentRequired: true, consentPurpose: "브라우저 rich 영수증 검증", retentionDays: 30, maxResponses: 5,
    });
    const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "브라우저 rich 영수증 v2", content }, randomUUID(), tx));
    const publication = await db.$transaction(tx => publishForm(tx, ctx, form.id, { version: form.version }, randomUUID()));
    const fixture: Fixture = { email, password, tenantId: company.id, serviceId, formId: form.id, publicToken: publication.token,
      pageIds: [first, second], assetIds: [root.id, page.id], sourceHashes: [root.sourceSha256, page.sourceSha256], preparedAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    await writeFile(resolve(evidenceDirectory, "prepare.json"), JSON.stringify({ result: "passed", at: new Date().toISOString(),
      formId: form.id, pages: 2, assets: 2, receiptEvidenceVersion: 2, publicTokenStoredOnlyInIgnoredFixture: true }, null, 2) + "\n");
    console.log(JSON.stringify({ result: "passed", formId: form.id, publicTokenStoredOnlyInIgnoredFixture: true }));
  } else {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
    const ctx = await login(fixture.email, fixture.password);
    const submission = await db.submission.findFirstOrThrow({ where: { formVersion: { formId: fixture.formId } }, include: { receipts: true } });
    assert.deepEqual(submission.visitedPageKeys, fixture.pageIds); assert.equal(submission.pagePathVersion, 1); assert.equal(submission.terminationKind, "consent");
    assert.equal(submission.receipts.length, 1);
    const receipt = submission.receipts[0], evidence = readConsentEvidence(receipt) as ConsentEvidenceV2;
    assert.equal(evidence.schemaVersion, 2); assert.deepEqual(evidence.presentation.visitedPageIds, fixture.pageIds);
    assert.deepEqual(evidence.presentation.documents.map(document => [document.kind, document.key]),
      [["root", "form"], ["page", fixture.pageIds[0]], ["page", fixture.pageIds[1]]]);
    const images = evidence.presentation.documents.flatMap(document => document.images);
    assert.deepEqual(images.map(image => image.assetId), fixture.assetIds); assert.deepEqual(images.map(image => image.sourceSha256), fixture.sourceHashes);
    assert(images.every(image => image.renderSha256 !== image.sourceSha256));
    assert.doesNotMatch(JSON.stringify(evidence), /브라우저 제출 완료 안내|브라우저 마감 안내/);
    const pdfBytes = Buffer.from(decrypt<string>(receipt.pdfCipher!), "base64");
    assert.equal(createHash("sha256").update(pdfBytes).digest("hex"), receipt.pdfHash);
    const text = pdfActualText(pdfBytes).join("\n");
    assert.match(text, /브라우저 영수증 루트/); assert.match(text, /브라우저 영수증 페이지/);
    assert.doesNotMatch(text, /브라우저 제출 완료 안내|브라우저 마감 안내/);
    const pdf = await imageOperators(pdfBytes); assert.equal(pdf.count, 2);
    const downloaded = await privateConsentReceiptPdf(ctx, submission.id, receipt.id, randomUUID());
    assert.deepEqual(Buffer.from(downloaded.bytes), pdfBytes);
    await writeFile(resolve(evidenceDirectory, "receipt-v2-browser.pdf"), pdfBytes);
    const report = { result: "passed", at: new Date().toISOString(), formId: fixture.formId, submissionId: submission.id,
      receiptId: receipt.id, evidenceVersion: receipt.evidenceVersion, pagePathVersion: submission.pagePathVersion,
      visitedPageIds: submission.visitedPageKeys, documentKeys: evidence.presentation.documents.map(document => document.key),
      images: images.map(image => ({ assetId: image.assetId, purpose: image.purpose, sourceSha256: image.sourceSha256,
        renderSha256: image.renderSha256, sourcePixels: image.sourceWidth * image.sourceHeight, renderBytes: image.renderBytes })),
      pdfHash: receipt.pdfHash, pdfBytes: pdfBytes.length, pdfPages: pdf.pages, pdfImageOperators: pdf.count,
      storedPdfDownloadExact: true, completionAndClosedExcluded: true };
    await writeFile(resolve(evidenceDirectory, "browser-db.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  }
} finally { await db.$disconnect(); }
