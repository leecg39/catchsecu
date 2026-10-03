import type { DocumentVersion } from "@/generated/prisma/client";
import type { DocumentSnapshot } from "@/contracts/documents";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { canonicalDocument, renderDocument, lockDocumentService, lockPublicDocument } from "./documents";
import { renderPdf, sha256 } from "./pdf-renderer";

async function storedPdf(tx: Transaction, version: DocumentVersion) {
  await tx.$queryRaw`SELECT id FROM "DocumentVersion" WHERE id=${version.id} FOR UPDATE`;
  const existing = await tx.documentPdf.findUnique({ where: { documentVersionId: version.id } });
  const snapshot = version.snapshot as unknown as DocumentSnapshot;
  if (sha256(canonicalDocument(snapshot)) !== version.contentHash || renderDocument(snapshot) !== version.renderedText)
    fail(409, "DOCUMENT_INTEGRITY", "게시 문서의 검증 정보가 일치하지 않습니다.");
  const result = existing ?? await tx.documentPdf.create({ data: {
    tenantId: version.tenantId, serviceId: version.serviceId, documentId: version.documentId, documentVersionId: version.id,
    contentHash: version.contentHash,
    ...await renderPdf({ title: snapshot.title, author: snapshot.companyName, text: version.renderedText,
      contentHash: version.contentHash, version: version.number, publishedAt: version.createdAt }),
  } });
  if (sha256(result.bytes) !== result.pdfHash || result.contentHash !== version.contentHash)
    fail(409, "PDF_INTEGRITY", "PDF 파일의 검증 정보가 일치하지 않습니다.");
  return { bytes: result.bytes, pdfHash: result.pdfHash, contentHash: result.contentHash, filename: `${snapshot.title}-v${version.number}.pdf` };
}
export async function privateDocumentPdf(ctx: Context, documentId: string, number: number, requestId: string) {
  return db.$transaction(async tx => {
    const document = await tx.document.findFirst({ where: { id: documentId, tenantId: ctx.tenantId }, select: { serviceId: true } });
    if (!document) fail(404, "NOT_FOUND", "문서를 찾을 수 없습니다.");
    await lockDocumentService(tx, ctx, document.serviceId, "document.read");
    const version = await tx.documentVersion.findFirst({ where: { documentId, number, tenantId: ctx.tenantId } });
    if (!version) fail(404, "NOT_FOUND", "게시 버전을 찾을 수 없습니다.");
    const file = await storedPdf(tx, version);
    await audit(tx, ctx, requestId, "document.pdf_downloaded", "documentVersion", version.id, [], version.serviceId);
    return file;
  }, { timeout: 30000 });
}
export async function publicDocumentPdf(token: string) {
  return db.$transaction(async tx => {
    const link = await lockPublicDocument(tx, token);
    const file = await storedPdf(tx, link.documentVersion);
    if (link.expiresAt && link.expiresAt <= new Date()) fail(410, "DOCUMENT_CLOSED", "공개가 종료되었거나 만료된 문서입니다.");
    return file;
  }, { timeout: 30000 });
}
