import { Prisma } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { auditAccess } from "./audit";
import { authorAssetAuditFormId, authorAssetAuditBinding } from "./audit-resources";
import { assertFileDeadlines } from "./file-access";
import { safeCsvCell } from "./import-csv";
import { actionPrefixes, accessDetail, auditActor, auditWhere, auditSelect, auditTransaction,
  maxAuditExportRows, safeRows, type AuditEventQuery } from "./audit-events";

async function formWhere(tx: Transaction, ctx: Context, formId: string, input: AuditEventQuery, assignedServices?: string[]) {
  if (input.scope !== "company") fail(422, "FORM_AUDIT_SCOPE", "캐치폼 로그는 회사 감사 권한으로 조회해주세요.");
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${formId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const form = await tx.form.findFirst({ where: { id: formId, tenantId: ctx.tenantId }, select: { serviceId: true } });
  if (!form) fail(404, "FORM_NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  if (assignedServices && !assignedServices.includes(form.serviceId)) fail(404, "SERVICE_NOT_FOUND", "조회 가능한 캐치폼을 찾을 수 없습니다.");
  if (input.serviceId && input.serviceId !== form.serviceId) fail(404, "SERVICE_NOT_FOUND", "캐치폼의 서비스를 확인해주세요.");
  const { companyWide } = await auditWhere(tx, ctx, { ...input, serviceId: form.serviceId });
  // Correlated EXISTS keeps all source IDs inside PostgreSQL; paging/export never loads a whole form into memory.
  // Submission versions and file version bindings remain after content destruction.
  const conditions = [Prisma.sql`a."tenantId"=${ctx.tenantId}`, Prisma.sql`a."serviceId"=${form.serviceId}`,
    Prisma.sql`(
      (a.resource='form' AND a."resourceId"=${formId}) OR
      (a.resource='submission' AND EXISTS (SELECT 1 FROM "Submission" s JOIN "FormVersion" v
        ON v.id=s."formVersionId" AND v."tenantId"=s."tenantId"
        WHERE s.id=a."resourceId" AND s."tenantId"=a."tenantId" AND v."formId"=${formId})) OR
      (a.resource='file' AND EXISTS (SELECT 1 FROM "FileObject" f JOIN "FormVersion" v
        ON v.id=f."formVersionId" AND v."tenantId"=f."tenantId"
        WHERE f.id=a."resourceId" AND f."tenantId"=a."tenantId" AND v."formId"=${formId})) OR
      (a.resource='author-asset' AND ${authorAssetAuditBinding} AND ${authorAssetAuditFormId}=${formId}) OR
      (a.resource='export' AND EXISTS (SELECT 1 FROM "ExportJob" e
        WHERE e.id=a."resourceId" AND e."tenantId"=a."tenantId" AND e."formId"=${formId}))
    )`];
  if (input.actorId) conditions.push(Prisma.sql`a."actorId"=${input.actorId}`);
  if (input.from) conditions.push(Prisma.sql`a."createdAt">=${new Date(input.from)}`);
  if (input.to) conditions.push(Prisma.sql`a."createdAt"<${new Date(input.to)}`);
  const prefixes = actionPrefixes[input.kind];
  if (prefixes.length) conditions.push(Prisma.sql`(${Prisma.join(prefixes.map(prefix => Prisma.sql`starts_with(a.action,${prefix})`), " OR ")})`);
  if (input.search) {
    const field = input.searchField === "actor" ? Prisma.sql`u.name` : input.searchField === "resource" ? Prisma.sql`a.resource` : Prisma.sql`a.action`;
    conditions.push(Prisma.sql`strpos(lower(${field}),lower(${input.search}))>0`);
  }
  return { where: Prisma.join(conditions, " AND "), companyWide, serviceId: form.serviceId };
}

export async function formAuditEvents(ctx: Context, formId: string, input: AuditEventQuery, requestId: string, csv = false) {
  return db.$transaction(async tx => {
    const { current, deadlines, serviceScope } = await auditActor(tx, ctx, input);
    const { where, companyWide, serviceId } = await formWhere(tx, current, formId, input,
      current.member.accessKind === "expert" ? serviceScope.id?.in ?? [] : undefined);
    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM "AuditEvent" a LEFT JOIN "User" u ON u.id=a."actorId" WHERE ${where}`);
    const total = Number(count.total), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    if (csv && total > maxAuditExportRows) fail(413, "AUDIT_EXPORT_LIMIT", "내보낼 기록이 5,000건을 넘습니다. 기간을 좁혀주세요.");
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT a.id FROM "AuditEvent" a LEFT JOIN "User" u ON u.id=a."actorId" WHERE ${where}
      ORDER BY a."createdAt" DESC,a.id DESC LIMIT ${csv ? maxAuditExportRows : input.pageSize} OFFSET ${csv ? 0 : (page - 1) * input.pageSize}`);
    const rows = await tx.auditEvent.findMany({ where: { tenantId: current.tenantId, id: { in: ids.map(row => row.id) } }, select: auditSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const items = await safeRows(tx, current, rows, companyWide, input.scope);
    await auditAccess(tx, current, requestId, csv ? "audit.exported" : "audit.viewed", accessDetail(input, rows.length), serviceId);
    assertFileDeadlines(deadlines);
    if (!csv) return { items, total, page, pageSize: input.pageSize };
    return "\uFEFF" + [["이벤트 ID", "처리일시", "서비스명", "처리자명", "처리내용", "처리대상", "대상 ID", "캐치폼·개인정보 업로드명", "응답 ID"],
      ...items.map(row => [row.id, row.createdAt.toISOString(), row.serviceName ?? "", row.actorName ?? "비공개", row.action, row.resource, row.resourceId ?? "", row.formName ?? "", row.submissionId ?? ""])]
      .map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
  }, auditTransaction);
}
