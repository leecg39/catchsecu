import type { SubmissionFilters } from "@/contracts/submissions";
import type { Context } from "./context";
import { db } from "./db";
import { canReadFiles } from "./file-access";
import { fail } from "./http";
import { lockResponseForm, lockResponseRows, responseWhere } from "./submission-query";
import { csvLine, exportBaseColumns, exportLayout, exportRowInclude, renderExportRow } from "./export-renderer";

export const submissionExportLimits = { rows: 5000, columns: 1000, bytes: 20 * 1024 * 1024 } as const;
export async function exportSubmissions(ctx: Context, formId: string, input: SubmissionFilters, requestId: string) {
  return db.$transaction(async tx => {
    const form = await lockResponseForm(tx, ctx, formId), where = responseWhere(ctx, formId, input);
    const selected = await tx.submission.findMany({ where, select: { id: true }, orderBy: [{ submittedAt: "desc" }, { id: "asc" }], take: submissionExportLimits.rows + 1 });
    if (selected.length > submissionExportLimits.rows) fail(413, "SUBMISSION_EXPORT_ROWS", "내보낼 응답이 5,000건을 넘습니다. 기간 또는 상태를 좁혀주세요.");
    await lockResponseRows(tx, ctx.tenantId, selected.map(r => r.id));
    const ids = await tx.submission.findMany({ where: { ...where, id: { in: selected.map(r => r.id) } }, select: { id: true, formVersionId: true }, orderBy: [{ submittedAt: "desc" }, { id: "asc" }] });
    const layout = await exportLayout(tx, ctx.tenantId, formId, [...new Set(ids.map(r => r.formVersionId))]);
    const readFiles = await canReadFiles(tx, ctx, form.serviceId), chunks = ["\uFEFF"], now = new Date(); let byteLength = 3;
    function append(line: string) {
      byteLength += Buffer.byteLength(line);
      if (byteLength > submissionExportLimits.bytes) fail(413, "SUBMISSION_EXPORT_BYTES", "CSV 크기가 20MB를 넘습니다. 기간 또는 상태를 좁혀주세요.");
      chunks.push(line);
    }
    append(csvLine([...exportBaseColumns, ...layout.columns.map(c => c.header)]));
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100), stored = await tx.submission.findMany({ where: { tenantId: ctx.tenantId, id: { in: batch.map(r => r.id) } }, include: exportRowInclude });
      const rows = new Map(stored.map(r => [r.id, r]));
      for (const { id } of batch) append(renderExportRow(rows.get(id)!, layout, readFiles, now));
    }
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, serviceId: form.serviceId, action: "submission.exported", resource: "form", resourceId: formId, requestId,
      detail: { rowCount: ids.length, columnCount: layout.columns.length + exportBaseColumns.length, byteLength, status: input.status, hasSearch: !!input.search, hasFrom: !!input.from, hasTo: !!input.to } } });
    return { csv: chunks.join(""), rowCount: ids.length };
  }, { timeout: 30000 });
}
