import type { z } from "zod";
import type { formContentSchema } from "./domains";

export type FormContent = z.infer<typeof formContentSchema>;
export type Question = FormContent["questions"][number];
export type FormRecord = {
  id: string; serviceId: string; serviceName: string; ownerName: string;
  sourceType?: "form" | "import";
  title: string; status: "draft" | "pendingApproval" | "published" | "paused" | "archived";
  version: number; createdAt: string; updatedAt: string; content: FormContent;
  consentBundle?: import("./form-documents").FormConsentBundle | null;
  draftNumber: number; hasDraft: boolean; published: boolean; favorite: boolean;
  publication: null | { id: string; responseCount: number; maxResponses: number; expiresAt: string | null; token?: string };
};
export type SubmissionRecord = {
  id: string; version: number; formVersionId: string; status: string; created: string;
  retentionUntil: string; legalHold: boolean; contentAvailable: boolean; values: Record<string, string | string[]>;
  attachments: import("./files").FileInfo[];
  questions: { id: string; label: string; type: string }[];
};
export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
export const formStatus: Record<FormRecord["status"], string> = {
  draft: "초안", pendingApproval: "승인 대기", published: "공개 중", paused: "일시 중지", archived: "보관",
};

export type TemplateRecord = { id: string; serviceId: string | null; serviceName: string | null; scope: "company" | "public"; title: string; category: string; content: FormContent; version: number; createdAt: string; updatedAt: string };
