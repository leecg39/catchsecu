import { z } from "zod";
import { catalogItem } from "./processing-catalog";

export const documentTypes = { consent: "개인정보 수집·이용 동의서", privacy_policy: "개인정보 처리방침", overseas_transfer: "개인정보 국외이전 동의서" } as const;
export const documentType = z.enum(["consent", "privacy_policy", "overseas_transfer"]);
export const documentStates = { draft: "초안", published: "게시 중", private: "비공개", archived: "보관" } as const;
export const nameModes = { service_company: "서비스명(회사명)", company_service: "회사명(서비스명)", service: "서비스명만 표시", company: "회사명만 표시" } as const;
const text = z.string().trim();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T00:00:00Z"); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "올바른 시행일을 입력해주세요.");
const uniqueIds = z.array(z.uuid()).max(100).refine(value => new Set(value).size === value.length, "연결 항목이 중복되었습니다.");
export const documentInput = z.object({ serviceId: z.uuid(), type: documentType, title: text.min(1).max(200),
  body: text.max(20000), refusalNotice: text.max(3000), rightsContact: text.max(2000), effectiveDate: date,
  purposeIds: uniqueIds, recipientIds: uniqueIds,
}).strict();
export const documentPatch = documentInput.extend({ version: z.number().int().positive() });
export const documentAction = z.object({ version: z.number().int().positive() }).strict();
export const documentPublish = documentAction.extend({ expiresAt: z.iso.datetime({ offset: true }).nullable() });
export const clauseInput = z.object({ serviceId: z.uuid(), type: documentType, title: text.min(1).max(200), body: text.min(1).max(20000) }).strict();
export const clausePatch = clauseInput.extend({ version: z.number().int().positive() });
export const clauseApply = documentAction.extend({ templateId: z.uuid(), templateVersion: z.number().int().positive() });
export const displayInput = z.object({ version: z.number().int().nonnegative(), nameMode: z.enum(["service_company", "company_service", "service", "company"]),
  startText: text.max(200), processorText: text.max(200), policyText: text.max(200), requiredText: text.max(200), optionalText: text.max(200),
  policyMode: z.enum(["none", "external", "document"]), externalUrl: text.max(2000), publicationId: z.uuid().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.policyMode === "external") {
    let valid = false;
    try { const url = new URL(value.externalUrl); valid = url.protocol === "https:" && !url.username && !url.password && !!url.hostname && !/[\u0000-\u0020\u007f]/.test(value.externalUrl); } catch {}
    if (!valid) ctx.addIssue({ code: "custom", path: ["externalUrl"], message: "사용자 정보가 없는 HTTPS 주소를 입력해주세요." });
  } else if (value.externalUrl) ctx.addIssue({ code: "custom", path: ["externalUrl"], message: "외부 링크를 선택한 경우에만 주소를 저장할 수 있습니다." });
  if ((value.policyMode === "document") !== !!value.publicationId)
    ctx.addIssue({ code: "custom", path: ["publicationId"], message: "내부 처리방침의 게시 버전을 선택해주세요." });
});
export type DocumentInput = z.infer<typeof documentInput>;
export type ClauseInput = z.infer<typeof clauseInput>;
export type DisplayInput = z.infer<typeof displayInput>;
export type DisplayKind = "collection" | "third_party";
export type DisplayRecord = DisplayInput & { serviceId: string; kind: DisplayKind; policyUrl: string | null; companyName: string; serviceName: string };
export const emptyDisplay = (): DisplayInput => ({ version: 0, nameMode: "service_company", startText: "", processorText: "", policyText: "", requiredText: "", optionalText: "", policyMode: "none", externalUrl: "", publicationId: null });
export type DocumentRecord = DocumentInput & { id: string; version: number; draftRevision: number; status: keyof typeof documentStates;
  serviceName: string; createdAt: string; updatedAt: string; latestNumber: number; hasUnpublishedChanges: boolean };
export type ClauseRecord = ClauseInput & { id: string; version: number; status: "active" | "archived"; createdAt: string; updatedAt: string };
export type PublicPurpose = { name: string; purpose: string; lawfulBasis: string; basisReference: string; items: z.infer<typeof catalogItem>[]; retentionMode: string; retentionDays: number | null; retentionReason: string };
export type PublicRecipient = { name: string; kind: string; countryCode: string; purpose: string; items: string[]; retentionMode: string; retentionDays: number | null; retentionReason: string; contact: string; transferMethod: string; transferTiming: string; refusalNotice: string };
export type DocumentSnapshot = { schemaVersion: 1; type: DocumentInput["type"]; title: string; body: string; refusalNotice: string; rightsContact: string; effectiveDate: string;
  companyName: string; serviceName: string; purposes: PublicPurpose[]; recipients: PublicRecipient[] };
export type PublicationRecord = { id: string; status: "active" | "revoked" | "expired"; createdAt: string; expiresAt: string | null; revokedAt: string | null; url?: string; displayCount: number };
export type DocumentVersionRecord = { id: string; number: number; draftRevision: number; createdAt: string; snapshot: DocumentSnapshot; renderedText: string; contentHash: string; publications: PublicationRecord[] };
export type DocumentPreview = { snapshot: DocumentSnapshot; renderedText: string; contentHash: string; publishErrors: string[] };
export type DocumentOptions = { purposes: { id: string; name: string; status: string; version: number }[]; recipients: { id: string; name: string; kind: string; countryCode: string; status: string; version: number }[];
  templates: ClauseRecord[]; policies: { publicationId: string; title: string; number: number; expiresAt: string | null }[] };
