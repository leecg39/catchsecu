import type { Prisma } from "@/generated/prisma/client";
import type { Transaction } from "./db";
import { submissionStatusLabels } from "@/contracts/submissions";
import { submissionDataAvailable } from "@/contracts/destruction";
import { matrixTypes, rowSchema, type AnswerValue } from "@/contracts/questions";
import { decrypt, tokenHash } from "./crypto";
import { fileInfo } from "./file-access";
import { safeCsvCell } from "./import-csv";
import { fail } from "./http";

export type ExportColumn = { questionId: string; rowId?: string; type: string; header: string };
export type ExportLayout = { columns: ExportColumn[]; numbers: Record<string, number> };
export const exportRowInclude = { answers: { orderBy: { id: "asc" as const } }, files: { where: { status: "attached", scanStatus: "clean" }, orderBy: { id: "asc" as const } } };
export type ExportRow = Prisma.SubmissionGetPayload<{ include: typeof exportRowInclude }>;
export const exportBaseColumns = ["응답 ID", "게시 버전", "제출일시 (UTC)", "보유 기한 (UTC)", "상태", "보존 조치", "원문 열람 상태"];
export function csvLine(cells: string[]) { return cells.map(safeCsvCell).join(",") + "\r\n"; }
export async function exportLayout(tx: Transaction, tenantId: string, formId: string, versionIds: string[]): Promise<ExportLayout> {
  const versions = [];
  for (let offset = 0; offset < versionIds.length; offset += 1000) versions.push(...await tx.formVersion.findMany({ where: { tenantId, formId, id: { in: versionIds.slice(offset, offset + 1000) } },
    select: { id: true, number: true, questions: { orderBy: { order: "asc" }, select: { id: true, label: true, type: true, matrixRows: true } } }, orderBy: { number: "asc" } }));
  versions.sort((a, b) => a.number - b.number);
  const columns: ExportColumn[] = [];
  for (const version of versions) for (const [index, question] of version.questions.entries()) {
    const header = "[v" + version.number + " · 질문 " + (index + 1) + "] " + question.label;
    if (matrixTypes.includes(question.type)) for (const [rowIndex, row] of rowSchema.array().parse(question.matrixRows).entries())
      columns.push({ questionId: question.id, rowId: row.id, type: question.type, header: header + " · 행 " + (rowIndex + 1) + ": " + row.label });
    else columns.push({ questionId: question.id, type: question.type, header });
    if (columns.length + exportBaseColumns.length > 1000) fail(413, "SUBMISSION_EXPORT_COLUMNS", "질문과 행이 너무 많습니다. 게시 버전별 제출 기간을 좁혀주세요.");
  }
  return { columns, numbers: Object.fromEntries(versions.map(v => [v.id, v.number])) };
}
export function renderExportRow(row: ExportRow, layout: ExportLayout, readFiles: boolean, now: Date) {
  const available = submissionDataAvailable(row, now);
  const values = available ? new Map(row.answers.map(a => [a.questionId, decrypt<AnswerValue>(a.valueCipher)])) : new Map<string, AnswerValue>();
  const files = available && readFiles ? new Map(row.files.map(f => [f.id, fileInfo(f).name])) : new Map<string, string>();
  return csvLine([row.id, String(layout.numbers[row.formVersionId]), row.submittedAt.toISOString(), row.retentionUntil.toISOString(),
    submissionStatusLabels[row.status] ?? row.status, row.legalHold ? "보존 중" : "", available ? "열람 가능" : row.status === "destroyed" ? "파기됨" : row.status === "destroying" ? "파기 처리 중" : "보유 기한 종료",
    ...layout.columns.map(c => {
      if (!available) return "";
      let value = values.get(c.questionId);
      if (c.type === "파일 업로드") return typeof value === "string" && value ? files.get(value) ?? "첨부파일" : "";
      if (c.rowId) value = value && typeof value === "object" && !Array.isArray(value) ? value[c.rowId] : undefined;
      return Array.isArray(value) ? JSON.stringify(value) : typeof value === "string" ? value : "";
    })]);
}
export function exportSourceHash(row: ExportRow, now: Date) {
  return tokenHash(JSON.stringify({ id: row.id, version: row.version, status: row.status, formVersionId: row.formVersionId,
    submittedAt: row.submittedAt, retentionUntil: row.retentionUntil, retentionVersion: row.retentionVersion, legalHold: row.legalHold,
    available: submissionDataAvailable(row, now), answers: row.answers.map(a => [a.id, a.valueCipher]),
    files: row.files.map(f => [f.id, f.version, f.status, f.scanStatus, f.sha256, f.nameCipher]) }));
}
