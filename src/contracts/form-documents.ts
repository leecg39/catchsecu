import { z } from "zod";
import type { DocumentInput } from "./documents";
import type { RichDocumentV1, RichImage, RichWidth } from "./rich-content";
import type { ConsentItem } from "./consent-items";
export const formDocumentSelection = z.object({ documentVersionId: z.uuid(), required: z.boolean(), kind: z.enum(["collection", "third_party"]) }).strict();
export const formDocumentSelections = z.array(formDocumentSelection).max(10).refine(value => new Set(value.map(item => item.documentVersionId)).size === value.length, "같은 문서 버전은 한 번만 선택해주세요.");
export type DocumentSelection = z.infer<typeof formDocumentSelection>;
export type ConsentDisplaySnapshot = {
  schemaVersion: 1; kind: DocumentSelection["kind"]; version: number; name: string;
  startText: string; processorText: string; policyText: string; requiredText: string; optionalText: string;
  policy: null | { kind: "external"; url: string } | { kind: "document"; title: string; number: number; renderedText: string; contentHash: string };
};
export type ConsentDocumentSnapshot = { key: string; required: boolean; kind: DocumentSelection["kind"]; title: string; type: DocumentInput["type"];
  number: number; contentHash: string; renderedText: string; display: ConsentDisplaySnapshot };
export type FormConsentBundle = { display: ConsentDisplaySnapshot | null; documents: ConsentDocumentSnapshot[]; collectedItems?: ConsentItem[] };
export type FormDocumentOption = { documentVersionId: string; documentId: string; title: string; type: DocumentInput["type"]; number: number;
  contentHash: string; renderedText: string; maximumRetentionDays: number | null };
type ConsentEvidenceCommon = { receiptId: string; submissionId: string; grantedAt: string; formTitle: string; formVersion: number;
  formBody: string; purpose: string; retentionDays: number; generalConsent: boolean; bundle: FormConsentBundle };
export type ConsentEvidenceV1 = ConsentEvidenceCommon & { schemaVersion: 1 };
export type ConsentEvidenceImageV2 = {
  assetId: string; nodeId: string; slot: "form_content" | "page_content"; documentKey: string;
  purpose: "FORM_CONTENT_IMAGE" | "PAGE_CONTENT_IMAGE"; mime: "image/jpeg" | "image/png";
  sourceBytes: number; sourceSha256: string; sourceWidth: number; sourceHeight: number;
  renderBytes: number; renderSha256: string; renderWidth: number; renderHeight: number;
  alt: string; alignment?: RichImage["alignment"]; width?: RichWidth; caption: string;
};
export type ConsentEvidenceDocumentV2 = {
  kind: "root" | "page"; key: string; title: string; body: string; bodyRich: RichDocumentV1;
  images: ConsentEvidenceImageV2[];
};
export type ConsentEvidenceV2 = ConsentEvidenceCommon & {
  schemaVersion: 2;
  presentation: {
    pagePathVersion: 0 | 1;
    visitedPageIds: string[];
    terminationKind: "consent" | "submit";
    documents: ConsentEvidenceDocumentV2[];
  };
};
export type ConsentEvidence = ConsentEvidenceV1 | ConsentEvidenceV2;
