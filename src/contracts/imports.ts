import { subjectRole } from "./subjects";
import { z } from "zod";
import { fileInput } from "./domains";
import type { PurposeInput, RecipientInput } from "./processing-catalog";

export const importCreate = fileInput.extend({ serviceId: z.uuid(), title: z.string().trim().min(1).max(200),
  mime: z.literal("text/csv"), encoding: z.enum(["utf-8", "euc-kr"]),
}).strict();
export const importAction = z.object({ version: z.number().int().positive() }).strict();
const column = z.number().int().min(0).max(99);
export const dateSource = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("column"), column }).strict(),
  z.object({ mode: z.literal("fixed"), value: z.string().trim().min(1).max(40) }).strict(),
]);
export const importMapping = z.object({
  purposeId: z.uuid(), fields: z.array(z.object({ name: z.string().trim().min(1).max(200),
    column: column.nullable(), subjectRole: subjectRole.optional(), type: z.enum(["text", "email", "phone", "number", "date"]),
  }).strict()).min(1).max(100),
  collectedAt: dateSource, retentionUntil: dateSource.nullable(), consentColumn: column.nullable(),
  evidenceColumn: column.nullable(), sourceStatement: z.string().trim().min(1).max(3000),
  source: z.enum(["internal", "third_party"]), sourceRecipientId: z.uuid().nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.source === "third_party") !== !!v.sourceRecipientId)
    ctx.addIssue({ code: "custom", path: ["sourceRecipientId"], message: "원자료 제공자를 확인해주세요." });
});
export const importPatch = z.object({ version: z.number().int().positive(), mapping: importMapping }).strict();
export type ImportMapping = z.infer<typeof importMapping>;
export type ImportCreate = z.infer<typeof importCreate>;
export type ImportSnapshot = { purpose: PurposeInput & { id: string; version: number }; recipient: (RecipientInput & { id: string; version: number }) | null };
export type ImportPayload = { raw: string[]; values: string[]; collectedAt: string; retentionUntil: string; consent: boolean; evidence: string };
export type ImportRowError = { field: string; code: string; message: string };
export const importStatusLabels: Record<string, string> = { uploading: "파일 업로드", draft: "설정 중", validated: "검증 완료",
  committing: "반영 중", retry: "재시도 대기", failed: "처리 중단", completed: "반영 완료", partialFailed: "일부 반영", cancelled: "취소됨", expired: "임시 자료 만료", archived: "보관됨" };
export type ImportJobRecord = { id: string; title: string; serviceId: string; fileId: string; status: string; version: number;
  totalRows: number; validRows: number; invalidRows: number; skippedRows: number; importedRows: number;
  headers: string[]; mapping: ImportMapping | null; expiresAt: string; createdAt: string; lastError: string | null;
  formId: string | null; fileStatus: string; fileName: string; encoding: string;
  permissions: { canEdit: boolean; canInspect: boolean; canValidate: boolean; canCommit: boolean; canRetry: boolean; canClean: boolean }; };
export type ImportPreview = { items: { rowNo: number; lineNo: number; status: string; values: string[] | null; errors: ImportRowError[] }[]; total: number; page: number; pageSize: number };
export type ImportOptions = { purposes: ImportSnapshot["purpose"][]; recipients: NonNullable<ImportSnapshot["recipient"]>[] };
