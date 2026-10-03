import { z } from "zod";
import type { FileInfo } from "./files";
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const questionIds = z.array(z.uuid()).min(1, "공유할 항목을 선택해주세요.").max(100)
  .refine(values => new Set(values).size === values.length, "공유 항목이 중복되었습니다.");
const expiry = z.iso.datetime({ offset: true });
export const shareCreateInput = z.object({ formId: z.uuid(), formVersionId: z.uuid(), email, questionIds, expiresAt: expiry }).strict();
export const shareUpdateInput = z.object({ version: z.number().int().positive(), email, questionIds, expiresAt: expiry }).strict();
export const shareVersionInput = z.object({ version: z.number().int().positive() }).strict();
export const challengeInput = z.object({ formCode: z.uuid(), invitationCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/), email, consent: z.literal(true) }).strict();
export const challengeIdInput = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const verificationInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type ShareInput = z.infer<typeof shareCreateInput>;
export type ShareUpdate = z.infer<typeof shareUpdateInput>;
export type SharedQuestion = { id: string; label: string; type: string };
export type ShareRecord = {
  id: string; formId: string; formVersionId: string; formTitle: string; formNumber: number; email: string;
  questionIds: string[]; questions: SharedQuestion[]; expiresAt: string; status: "active" | "expired" | "revoked";
  version: number; createdAt: string;
};
export type ShareOptions = { formCode: string; versions: { id: string; number: number; title: string; questions: SharedQuestion[] }[] };
export type ViewerInfo = { formTitle: string; formNumber: number; questions: SharedQuestion[]; expiresAt: string; grantExpiresAt: string };
export type SharedSubmission = { id: string; submittedAt: string; values: Record<string, string | string[]>; attachments: FileInfo[] };
export type SharedPage = { items: SharedSubmission[]; total: number; page: number; pageSize: number; viewer: ViewerInfo };
export type ShareEvent = { id: string; action: string; createdAt: string; detail: { changedFields?: string[]; submissionId?: string; fileId?: string } };
