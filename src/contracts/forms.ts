import type { z } from "zod";
import type { formContentSchema } from "./domains";
import type { Answers, MatrixRows } from "./questions";

export type FormContent = z.infer<typeof formContentSchema>;
export type Question = FormContent["questions"][number];
export type FormActions = { preview: boolean; responses: boolean; edit: boolean; copy: boolean; registerTemplate: boolean;
  publish: boolean; share: boolean; pause: boolean; resume: boolean; archive: boolean; checkDeletion: boolean };
export type FormListPermissions = { canCreate: boolean; canImport: boolean; canViewImports: boolean };
export type FormRecord = {
  id: string; serviceId: string; serviceName: string; ownerName: string;
  sourceType?: "form" | "import";
  title: string; status: "draft" | "pendingApproval" | "published" | "paused" | "archived";
  version: number; createdAt: string; updatedAt: string; content: FormContent;
  consentBundle?: import("./form-documents").FormConsentBundle | null;
  draftNumber: number; hasDraft: boolean; published: boolean; favorite: boolean;
  publication: null | { id: string; responseCount: number; maxResponses: number; expiresAt: string | null; token?: string };
  actions?: FormActions;
};
export type SubmissionRecord = {
  id: string; version: number; formVersionId: string; status: string; created: string;
  retentionUntil: string; legalHold: boolean; contentAvailable: boolean; values: Answers;
  attachments: import("./files").FileInfo[];
  questions: { id: string; label: string; type: string; rows?: MatrixRows }[];
};
export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
export type FormPage = Paged<FormRecord> & { permissions: FormListPermissions };
export type FormDeletionState = {
  id: string; version: number; status: FormRecord["status"]; canPurge: boolean; canReadResponses: boolean;
  reasons: { code: string; message: string }[];
  references: { publications: number; approvals: number; submissions: number; shares: number; imports: number; files: number };
};
export const formStatus: Record<FormRecord["status"], string> = {
  draft: "초안", pendingApproval: "승인 대기", published: "공개 중", paused: "일시 중지", archived: "보관",
};

export type TemplateActions = { preview: boolean; use: boolean; edit: boolean; remove: boolean };
export type TemplatePermissions = { canCreate: boolean; targets: { id: string; name: string }[] };
export type TemplateRecord = { id: string; serviceId: string | null; serviceName: string | null; scope: "company" | "public"; title: string; category: string; content: FormContent; version: number; createdAt: string; updatedAt: string; actions?: TemplateActions };
export type TemplatePage = Paged<TemplateRecord> & { permissions: TemplatePermissions };
