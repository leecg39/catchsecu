import { randomUUID } from "node:crypto";
import type { ConsentReceipt } from "@/generated/prisma/client";
import type { ConsentDisplaySnapshot, ConsentEvidence } from "@/contracts/form-documents";
import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { consentBundle, type ConsentVersion } from "./form-documents";
import { canonicalDocument } from "./documents";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { fail } from "./http";
import { renderPdf, sha256 } from "./pdf-renderer";
import { lockSubmission, requireSubmissionContent } from "./submission-access";
import { audit } from "./audit";

export function validateDocumentConsents(version: ConsentVersion, keys: string[] = []) {
  if (new Set(keys).size !== keys.length || keys.some(key => !version.documentBindings.some(binding => binding.id === key)))
    fail(422, "INVALID_DOCUMENT_CONSENT", "현재 폼에 표시된 동의 항목만 선택해주세요.");
  if (version.documentBindings.some(binding => binding.required && !keys.includes(binding.id)))
    fail(422, "DOCUMENT_CONSENT_REQUIRED", "필수 문서에 대한 동의가 필요합니다.");
}
function evidenceFor(version: ConsentVersion, submissionId: string, receiptId: string, grantedAt: Date, generalConsent: boolean, keys: string[]): ConsentEvidence {
  const bundle = consentBundle(version);
  return { schemaVersion: 1, receiptId, submissionId, grantedAt: grantedAt.toISOString(), formTitle: version.title,
    formVersion: version.number, formBody: version.body, purpose: version.consentPurpose, retentionDays: version.retentionDays,
    generalConsent, bundle: { display: bundle.display, documents: bundle.documents.filter(document => keys.includes(document.key)) } };
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
export function renderConsentEvidence(evidence: ConsentEvidence) {
  const lines = ["개인정보 동의 영수증", evidence.formTitle, "폼 버전: " + evidence.formVersion,
    "동의 일시 (UTC): " + evidence.grantedAt, "영수증 ID: " + evidence.receiptId, "응답 ID: " + evidence.submissionId,
    evidence.formBody, "기본 수집·이용 동의: " + (evidence.generalConsent ? "동의함" : "동의하지 않음"),
    "처리 목적: " + evidence.purpose, "보유 기간: " + evidence.retentionDays + "일", ...displayText(evidence.bundle.display)];
  for (const document of evidence.bundle.documents) lines.push("", (document.required ? "필수" : "선택") + " 문서 동의: 동의함",
    (document.kind === "collection" ? "수집·이용" : "제3자 제공") + " · " + document.title + " v" + document.number,
    ...displayText(document.display), document.renderedText, "문서 본문 해시: " + document.contentHash);
  lines.push("", "이 파일은 제출 당시 동의 기록입니다. 이후 철회 여부는 응답 상세의 처리 이력에서 확인할 수 있습니다.");
  return lines.filter(line => line !== undefined).join("\n");
}
async function evidencePdf(evidence: ConsentEvidence) {
  const contentHash = sha256(canonicalDocument(evidence));
  const file = await renderPdf({ title: evidence.formTitle + " 동의 영수증", author: evidence.bundle.display?.name ?? "Catchsecu",
    text: renderConsentEvidence(evidence), contentHash, version: evidence.formVersion, publishedAt: new Date(evidence.grantedAt), label: "동의 영수증 · 폼 버전" });
  return { ...file, contentHash };
}
export async function preflightConsentReceipt(version: ConsentVersion) {
  if (version.receiptEvidenceVersion !== 1) return;
  // Include all optional documents too, so every allowed submission fits the renderer before publishing.
  await evidencePdf(evidenceFor(version, "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
    new Date("2026-01-01T00:00:00.000Z"), true, version.documentBindings.map(binding => binding.id)));
}
export async function createConsentReceipt(tx: Transaction, version: ConsentVersion, submissionId: string, generalConsent: boolean, keys: string[]) {
  if (!generalConsent && !keys.length) return;
  const id = randomUUID(), grantedAt = new Date();
  const evidence = version.receiptEvidenceVersion === 1 ? evidenceFor(version, submissionId, id, grantedAt, generalConsent, keys) : null;
  const file = evidence ? await evidencePdf(evidence) : null;
  const receipt = await tx.consentReceipt.create({ data: {
    id, tenantId: version.tenantId, submissionId, purpose: version.consentPurpose, retentionDays: version.retentionDays, grantedAt,
    documentHash: file?.contentHash ?? tokenHash(JSON.stringify({ versionId: version.id, purpose: version.consentPurpose, days: version.retentionDays })),
    evidenceVersion: evidence ? 1 : 0, evidenceCipher: evidence ? encrypt(evidence) : null,
    pdfCipher: file ? encrypt(Buffer.from(file.bytes).toString("base64")) : null, pdfHash: file?.pdfHash,
  } });
  await tx.consentEvent.create({ data: { tenantId: version.tenantId, receiptId: receipt.id, type: "granted", reason: "public-form" } });
}
export function readConsentEvidence(receipt: ConsentReceipt) {
  if (receipt.evidenceVersion !== 1 || !receipt.evidenceCipher) return null;
  const evidence = decrypt<ConsentEvidence>(receipt.evidenceCipher);
  if (evidence.schemaVersion !== 1 || evidence.receiptId !== receipt.id || evidence.submissionId !== receipt.submissionId ||
    evidence.grantedAt !== receipt.grantedAt.toISOString() || sha256(canonicalDocument(evidence)) !== receipt.documentHash)
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
