import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { ConsentReceipt } from "@/generated/prisma/client";
import type {
  ConsentDisplaySnapshot, ConsentEvidence, ConsentEvidenceDocumentV2, ConsentEvidenceImageV2,
  ConsentEvidenceV1, ConsentEvidenceV2,
} from "@/contracts/form-documents";
import { plainTextRichDocument, richDocumentImages, richDocumentSchema, type RichInline } from "@/contracts/rich-content";
import type { FormVisit } from "@/contracts/form-sections";
import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { consentBundle, type ConsentVersion } from "./form-documents";
import { canonicalDocument } from "./documents";
import { consentItemsSchema } from "@/contracts/consent-items";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { fail } from "./http";
import { renderPdf, sha256 } from "./pdf-renderer";
import { renderPdfV2, type RichPdfDocument } from "./pdf-renderer-v2";
import { privateFiles } from "./file-storage";
import { lockSubmission, requireSubmissionContent } from "./submission-access";
import { audit } from "./audit";

const RECEIPT_V2_LIMITS = {
  decodedPixels: 96 * 1024 * 1024,
  convertedBytes: 16 * 1024 * 1024,
  imageDimension: 16_384,
  imagePixels: 24 * 1024 * 1024,
  renderWidth: 1_440,
  renderHeight: 1_920,
} as const;

type PreparedDocument = { evidence: ConsentEvidenceDocumentV2; pdf: RichPdfDocument };
type PreparedAsset = {
  bytes: Buffer; sourceBytes: number; sourceSha256: string; sourceWidth: number; sourceHeight: number;
  renderBytes: number; renderSha256: string; renderWidth: number; renderHeight: number;
};

export function validateDocumentConsents(version: ConsentVersion, keys: string[] = []) {
  if (new Set(keys).size !== keys.length || keys.some(key => !version.documentBindings.some(binding => binding.id === key)))
    fail(422, "INVALID_DOCUMENT_CONSENT", "현재 폼에 표시된 동의 항목만 선택해주세요.");
  if (version.documentBindings.some(binding => binding.required && !keys.includes(binding.id)))
    fail(422, "DOCUMENT_CONSENT_REQUIRED", "필수 문서에 대한 동의가 필요합니다.");
}

function commonEvidence(version: ConsentVersion, submissionId: string, receiptId: string, grantedAt: Date,
  generalConsent: boolean, keys: string[], policyDays: number) {
  const bundle = consentBundle(version);
  return {
    receiptId, submissionId, grantedAt: grantedAt.toISOString(), formTitle: version.title,
    formVersion: version.number, formBody: version.body, purpose: version.consentPurpose,
    retentionDays: version.retentionDays ?? policyDays, generalConsent,
    bundle: {
      display: bundle.display,
      ...(bundle.collectedItems ? { collectedItems: bundle.collectedItems } : {}),
      documents: bundle.documents.filter(document => keys.includes(document.key)),
    },
  };
}

function evidenceForV1(version: ConsentVersion, submissionId: string, receiptId: string, grantedAt: Date,
  generalConsent: boolean, keys: string[], policyDays: number): ConsentEvidenceV1 {
  return { schemaVersion: 1, ...commonEvidence(version, submissionId, receiptId, grantedAt, generalConsent, keys, policyDays) };
}

function inlineText(nodes: RichInline[] = []): string {
  return nodes.map(node => node.type === "text" ? node.text : node.type === "break" ? "\n" : inlineText(node.children)).join("");
}

async function prepareAsset(bytes: Buffer, expected: { size: number; sha256: string }): Promise<PreparedAsset> {
  if (bytes.length !== expected.size || sha256(bytes) !== expected.sha256)
    fail(500, "RECEIPT_INTEGRITY_ERROR", "영수증 이미지 원본의 무결성을 확인할 수 없습니다.");
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, { failOn: "warning", limitInputPixels: RECEIPT_V2_LIMITS.imagePixels,
      limitInputChannels: 4, unlimited: false, sequentialRead: true }).metadata();
  } catch {
    return fail(422, "PDF_IMAGE_UNAVAILABLE", "영수증에 포함할 이미지의 크기나 형식을 확인해주세요.");
  }
  const sourceWidth = metadata.width ?? 0, sourceHeight = metadata.height ?? 0;
  if (!sourceWidth || !sourceHeight || sourceWidth > RECEIPT_V2_LIMITS.imageDimension || sourceHeight > RECEIPT_V2_LIMITS.imageDimension
    || sourceWidth * sourceHeight > RECEIPT_V2_LIMITS.imagePixels || (metadata.pages ?? 1) !== 1)
    fail(422, "PDF_IMAGE_TOO_LARGE", "영수증에 포함할 이미지의 해상도 제한을 초과했습니다.");
  try {
    const rendered = await sharp(bytes, { failOn: "warning", limitInputPixels: RECEIPT_V2_LIMITS.imagePixels,
      limitInputChannels: 4, unlimited: false, sequentialRead: true })
      .rotate().resize({ width: RECEIPT_V2_LIMITS.renderWidth, height: RECEIPT_V2_LIMITS.renderHeight,
        fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
      .png({ compressionLevel: 9, palette: false }).timeout({ seconds: 3 }).toBuffer({ resolveWithObject: true });
    return {
      bytes: rendered.data, sourceBytes: bytes.length, sourceSha256: expected.sha256, sourceWidth, sourceHeight,
      renderBytes: rendered.data.length, renderSha256: sha256(rendered.data),
      renderWidth: rendered.info.width, renderHeight: rendered.info.height,
    };
  } catch {
    return fail(422, "PDF_IMAGE_UNAVAILABLE", "영수증 이미지를 안전하게 변환하지 못했습니다.");
  }
}

async function prepareEvidenceDocuments(tx: Transaction, version: ConsentVersion, pageIds: string[]): Promise<PreparedDocument[]> {
  const sections = new Map(version.sections.map(section => [section.pageKey, section]));
  if (new Set(pageIds).size !== pageIds.length || pageIds.some(id => !sections.has(id)))
    fail(500, "RECEIPT_INTEGRITY_ERROR", "제출 당시 페이지 경로를 확인할 수 없습니다.");
  const documents = [
    { kind: "root" as const, key: "form", title: "폼 안내", body: version.body,
      bodyRich: version.bodyRich === null ? plainTextRichDocument(version.body) : richDocumentSchema.parse(version.bodyRich),
      slot: "form_content" as const, purpose: "FORM_CONTENT_IMAGE" as const },
    ...pageIds.map((pageId, index) => { const section = sections.get(pageId)!; return {
      kind: "page" as const, key: pageId, title: section.title || `페이지 ${index + 1}`, body: section.body,
      bodyRich: section.bodyRich === null ? plainTextRichDocument(section.body) : richDocumentSchema.parse(section.bodyRich),
      slot: "page_content" as const, purpose: "PAGE_CONTENT_IMAGE" as const,
    }; }),
  ];
  const references = await tx.authorAssetReference.findMany({ where: {
    formVersionId: version.id, slot: { in: ["form_content", "page_content"] },
    OR: [{ slot: "form_content", documentKey: "form" }, { slot: "page_content", documentKey: { in: pageIds } }],
  }, include: { asset: { include: { blob: true } } } });
  const referenceKeys = new Map<string, typeof references>();
  for (const reference of references) {
    const key = [reference.slot, reference.documentKey, reference.nodeKey, reference.assetId].join(":"), values = referenceKeys.get(key) ?? [];
    values.push(reference); referenceKeys.set(key, values);
  }
  const preparedAssets = new Map<string, PreparedAsset>();
  let decodedPixels = 0, convertedBytes = 0;
  const result: PreparedDocument[] = [];
  for (const document of documents) {
    const evidenceImages: ConsentEvidenceImageV2[] = [], pdfImages: RichPdfDocument["images"] = [];
    for (const image of richDocumentImages(document.bodyRich)) {
      const key = [document.slot, document.key, image.nodeId, image.assetId].join(":"), matches = referenceKeys.get(key) ?? [];
      if (matches.length !== 1) fail(409, "AUTHOR_ASSET_REFERENCES", "영수증 이미지 연결 상태가 변경되었습니다. 폼을 다시 게시해주세요.");
      const row = matches[0].asset;
      if (row.purpose !== document.purpose || row.status !== "ready" || row.blob.status !== "ready" || row.blob.scanStatus !== "clean"
        || row.blob.mime !== "image/jpeg" && row.blob.mime !== "image/png")
        fail(409, "AUTHOR_ASSET_NOT_READY", "검사를 통과한 게시 버전 이미지만 영수증에 포함할 수 있습니다.");
      let prepared = preparedAssets.get(row.id);
      if (!prepared) {
        let source: Buffer;
        try { source = await privateFiles.read(row.blob.storageKey); }
        catch { return fail(500, "RECEIPT_INTEGRITY_ERROR", "영수증 이미지 원본을 읽지 못했습니다."); }
        prepared = await prepareAsset(source, { size: row.blob.size, sha256: row.blob.sha256 });
        preparedAssets.set(row.id, prepared);
      }
      decodedPixels += prepared.sourceWidth * prepared.sourceHeight;
      convertedBytes += prepared.renderBytes;
      if (decodedPixels > RECEIPT_V2_LIMITS.decodedPixels || convertedBytes > RECEIPT_V2_LIMITS.convertedBytes)
        fail(422, "PDF_IMAGE_TOO_LARGE", "영수증 이미지의 전체 해상도나 변환 용량 제한을 초과했습니다.");
      evidenceImages.push({
        assetId: row.id, nodeId: image.nodeId, slot: document.slot, documentKey: document.key, purpose: document.purpose,
        mime: row.blob.mime as "image/jpeg" | "image/png", sourceBytes: prepared.sourceBytes, sourceSha256: prepared.sourceSha256,
        sourceWidth: prepared.sourceWidth, sourceHeight: prepared.sourceHeight, renderBytes: prepared.renderBytes,
        renderSha256: prepared.renderSha256, renderWidth: prepared.renderWidth, renderHeight: prepared.renderHeight,
        alt: image.alt, ...(image.alignment ? { alignment: image.alignment } : {}),
        ...(image.width ? { width: structuredClone(image.width) } : {}), caption: inlineText(image.caption),
      });
      pdfImages.push({ nodeId: image.nodeId, bytes: prepared.bytes, width: prepared.renderWidth, height: prepared.renderHeight });
    }
    result.push({ evidence: { kind: document.kind, key: document.key, title: document.title, body: document.body,
      bodyRich: document.bodyRich, images: evidenceImages }, pdf: { label: document.title, document: document.bodyRich, images: pdfImages } });
  }
  return result;
}

async function evidenceForV2(tx: Transaction, version: ConsentVersion, submissionId: string, receiptId: string, grantedAt: Date,
  generalConsent: boolean, keys: string[], policyDays: number, visit: FormVisit | null, preflight = false) {
  const pageIds = visit?.pageIds ?? (preflight ? version.sections.map(section => section.pageKey) : []);
  const prepared = await prepareEvidenceDocuments(tx, version, pageIds);
  const evidence: ConsentEvidenceV2 = {
    schemaVersion: 2, ...commonEvidence(version, submissionId, receiptId, grantedAt, generalConsent, keys, policyDays),
    presentation: {
      pagePathVersion: visit ? 1 : 0, visitedPageIds: pageIds,
      terminationKind: visit?.terminal === "submit" ? "submit" : version.consentRequired ? "consent" : "submit",
      documents: prepared.map(item => item.evidence),
    },
  };
  return { evidence, richDocuments: prepared.map(item => item.pdf) };
}

function displayText(display: ConsentDisplaySnapshot | null): string[] {
  if (!display) return [];
  const lines = [display.name, display.startText, display.processorText, display.policyText,
    "필수 항목 안내: " + display.requiredText, "선택 항목 안내: " + display.optionalText];
  if (display.policy?.kind === "external") lines.push("개인정보 처리방침: " + display.policy.url);
  if (display.policy?.kind === "document") lines.push("개인정보 처리방침 v" + display.policy.number,
    display.policy.renderedText, "처리방침 본문 해시: " + display.policy.contentHash);
  return lines;
}

function consentLines(evidence: ConsentEvidence) {
  const lines = ["개인정보 동의 영수증", evidence.formTitle, "폼 버전: " + evidence.formVersion,
    "동의 일시 (UTC): " + evidence.grantedAt, "영수증 ID: " + evidence.receiptId, "응답 ID: " + evidence.submissionId,
    "기본 수집·이용 동의: " + (evidence.generalConsent ? "동의함" : "동의하지 않음"),
    "처리 목적: " + evidence.purpose, "보유 기간: " + evidence.retentionDays + "일", ...displayText(evidence.bundle.display)];
  if (evidence.bundle.collectedItems) lines.push("", "문항에서 수집하는 개인정보",
    ...(evidence.bundle.collectedItems.length
      ? evidence.bundle.collectedItems.map(item => `${({
        PERSONAL_INFORMATION: "일반 개인정보", SENSITIVE: "민감정보", IDENTIFICATION: "고유식별정보", RESIDENT: "주민등록번호",
      } as const)[item.type]} · ${item.name}`)
      : ["개인정보로 분류해 확인한 수집 항목이 없습니다."]));
  for (const document of evidence.bundle.documents) lines.push("", (document.required ? "필수" : "선택") + " 문서 동의: 동의함",
    (document.kind === "collection" ? "수집·이용" : "제3자 제공") + " · " + document.title + " v" + document.number,
    ...displayText(document.display), document.renderedText, "문서 본문 해시: " + document.contentHash);
  if (evidence.schemaVersion === 2) lines.push("", `제시 경로: ${evidence.presentation.visitedPageIds.join(" → ") || "단일 페이지"}`,
    `종료 단계: ${evidence.presentation.terminationKind}`, ...evidence.presentation.documents.flatMap(document =>
      document.images.map(image => `이미지 ${image.assetId}: 원본 ${image.sourceSha256} · PDF 변환 ${image.renderSha256}`)));
  lines.push("", "이 파일은 제출 당시 동의 기록입니다. 이후 철회 여부는 응답 상세의 처리 이력에서 확인할 수 있습니다.");
  return lines;
}

export function renderConsentEvidence(evidence: ConsentEvidence) {
  const lines = consentLines(evidence);
  if (evidence.schemaVersion === 1) lines.splice(6, 0, evidence.formBody);
  else for (const document of evidence.presentation.documents) lines.push("", document.title, document.body);
  return lines.filter(line => line !== undefined).join("\n");
}

async function evidencePdf(evidence: ConsentEvidence, richDocuments?: RichPdfDocument[]) {
  const contentHash = sha256(canonicalDocument(evidence));
  const source = { title: evidence.formTitle + " 동의 영수증", author: evidence.bundle.display?.name ?? "Catchsecu",
    text: evidence.schemaVersion === 1 ? renderConsentEvidence(evidence) : consentLines(evidence).join("\n"),
    contentHash, version: evidence.formVersion, publishedAt: new Date(evidence.grantedAt), label: "동의 영수증 · 폼 버전" };
  const file = evidence.schemaVersion === 2
    ? await renderPdfV2({ ...source, richDocuments: richDocuments ?? [] }) : await renderPdf(source);
  return { ...file, contentHash };
}

export async function preflightConsentReceipt(tx: Transaction, version: ConsentVersion, policyDays: number) {
  if (version.receiptEvidenceVersion === 0) return;
  const submissionId = "00000000-0000-4000-8000-000000000001", receiptId = "00000000-0000-4000-8000-000000000002";
  const grantedAt = new Date("2026-01-01T00:00:00.000Z"), keys = version.documentBindings.map(binding => binding.id);
  if (version.receiptEvidenceVersion === 1)
    await evidencePdf(evidenceForV1(version, submissionId, receiptId, grantedAt, true, keys, policyDays));
  else if (version.receiptEvidenceVersion === 2) {
    const prepared = await evidenceForV2(tx, version, submissionId, receiptId, grantedAt, true, keys, policyDays, null, true);
    await evidencePdf(prepared.evidence, prepared.richDocuments);
  } else fail(500, "RECEIPT_INTEGRITY_ERROR", "지원하지 않는 동의 증거 버전입니다.");
}

export async function createConsentReceipt(tx: Transaction, version: ConsentVersion, submissionId: string, generalConsent: boolean,
  keys: string[], policyDays: number, visit: FormVisit | null = null) {
  if (!generalConsent && !keys.length) return;
  const id = randomUUID(), grantedAt = new Date();
  let evidence: ConsentEvidence | null = null, richDocuments: RichPdfDocument[] | undefined;
  if (version.receiptEvidenceVersion === 1)
    evidence = evidenceForV1(version, submissionId, id, grantedAt, generalConsent, keys, policyDays);
  else if (version.receiptEvidenceVersion === 2) {
    const prepared = await evidenceForV2(tx, version, submissionId, id, grantedAt, generalConsent, keys, policyDays, visit);
    evidence = prepared.evidence; richDocuments = prepared.richDocuments;
  } else if (version.receiptEvidenceVersion !== 0)
    fail(500, "RECEIPT_INTEGRITY_ERROR", "지원하지 않는 동의 증거 버전입니다.");
  const file = evidence ? await evidencePdf(evidence, richDocuments) : null;
  const receipt = await tx.consentReceipt.create({ data: {
    id, tenantId: version.tenantId, submissionId, purpose: version.consentPurpose,
    retentionDays: version.retentionDays ?? policyDays, grantedAt,
    documentHash: file?.contentHash ?? tokenHash(JSON.stringify({ versionId: version.id, purpose: version.consentPurpose, days: version.retentionDays ?? policyDays })),
    evidenceVersion: evidence?.schemaVersion ?? 0, evidenceCipher: evidence ? encrypt(evidence) : null,
    pdfCipher: file ? encrypt(Buffer.from(file.bytes).toString("base64")) : null, pdfHash: file?.pdfHash,
  } });
  await tx.consentEvent.create({ data: { tenantId: version.tenantId, receiptId: receipt.id, type: "granted", reason: "public-form" } });
}

function validV2(evidence: ConsentEvidenceV2) {
  return evidence.presentation && [0, 1].includes(evidence.presentation.pagePathVersion)
    && Array.isArray(evidence.presentation.visitedPageIds) && Array.isArray(evidence.presentation.documents)
    && evidence.presentation.documents.every(document => document.bodyRich?.schemaVersion === 1 && Array.isArray(document.images)
      && document.images.every(image => /^[a-f0-9]{64}$/.test(image.sourceSha256) && /^[a-f0-9]{64}$/.test(image.renderSha256)));
}

export function readConsentEvidence(receipt: ConsentReceipt) {
  if (![1, 2].includes(receipt.evidenceVersion) || !receipt.evidenceCipher) return null;
  const evidence = decrypt<ConsentEvidence>(receipt.evidenceCipher);
  if (evidence.schemaVersion !== receipt.evidenceVersion || evidence.receiptId !== receipt.id || evidence.submissionId !== receipt.submissionId
    || evidence.grantedAt !== receipt.grantedAt.toISOString() || evidence.schemaVersion === 2 && !validV2(evidence)
    || evidence.bundle.collectedItems !== undefined && !consentItemsSchema.safeParse(evidence.bundle.collectedItems).success
    || sha256(canonicalDocument(evidence)) !== receipt.documentHash)
    fail(500, "RECEIPT_INTEGRITY_ERROR", "동의 증거의 무결성을 확인할 수 없습니다.");
  return evidence;
}

export async function privateConsentReceiptPdf(ctx: Context, submissionId: string, receiptId: string, requestId: string) {
  return db.$transaction(async tx => {
    const submission = await lockSubmission(tx, ctx, submissionId, "submission.read");
    requireSubmissionContent(submission);
    const receipt = await tx.consentReceipt.findFirst({ where: { id: receiptId, submissionId, tenantId: ctx.tenantId } });
    if (!receipt) fail(404, "NOT_FOUND", "동의 영수증을 찾을 수 없습니다.");
    const evidence = readConsentEvidence(receipt);
    if (!evidence || !receipt.pdfCipher || !receipt.pdfHash) fail(404, "RECEIPT_PDF_UNAVAILABLE", "이전에 수집한 기록에는 동의 영수증 PDF가 없습니다.");
    const bytes = Buffer.from(decrypt<string>(receipt.pdfCipher), "base64");
    if (sha256(bytes) !== receipt.pdfHash) fail(500, "RECEIPT_INTEGRITY_ERROR", "동의 영수증 파일의 무결성을 확인할 수 없습니다.");
    requireSubmissionContent(submission);
    await audit(tx, ctx, requestId, "consent_receipt.pdf_downloaded", "submission", submissionId, ["receipt"], submission.formVersion.form.serviceId);
    return { bytes, pdfHash: receipt.pdfHash, contentHash: receipt.documentHash, filename: evidence.formTitle + "-동의-" + receipt.id + ".pdf" };
  });
}
