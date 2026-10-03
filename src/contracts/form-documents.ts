import { z } from "zod";
import type { DocumentInput } from "./documents";
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
export type FormConsentBundle = { display: ConsentDisplaySnapshot | null; documents: ConsentDocumentSnapshot[] };
export type FormDocumentOption = { documentVersionId: string; documentId: string; title: string; type: DocumentInput["type"]; number: number;
  contentHash: string; renderedText: string; maximumRetentionDays: number | null };
export type ConsentEvidence = { schemaVersion: 1; receiptId: string; submissionId: string; grantedAt: string; formTitle: string; formVersion: number;
  formBody: string; purpose: string; retentionDays: number; generalConsent: boolean; bundle: FormConsentBundle };
