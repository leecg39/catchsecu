import { Prisma } from "@/generated/prisma/client";
import type { Transaction } from "./db";

type EventResource = { id: string; resource: string; resourceId: string | null; serviceId: string | null };
export type AuditResource = { formName: string | null; submissionId: string | null };
export const hiddenAuditResource: AuditResource = { formName: null, submissionId: null };

/** Correlated with the already-authorized AuditEvent alias `a`. Only IDs are projected, never raw detail.
 * Explicit event context wins. Context-free asset events resolve only an unambiguous same-service form. */
export const authorAssetAuditFormId = Prisma.sql`(CASE
  WHEN a.detail ? 'formId' THEN a.detail->>'formId'
  WHEN a.detail->>'parentKind'='form' THEN a.detail->>'parentId'
  WHEN a.detail->>'parentKind'='version' THEN (SELECT v."formId" FROM "FormVersion" v WHERE v.id=a.detail->>'parentId' AND v."tenantId"=a."tenantId")
  WHEN a.detail->>'parentKind'='submission' THEN (SELECT v."formId" FROM "Submission" s JOIN "FormVersion" v ON v.id=s."formVersionId" AND v."tenantId"=s."tenantId"
    WHERE s.id=a.detail->>'parentId' AND s."tenantId"=a."tenantId")
  WHEN a.detail->>'parentKind'='approval' THEN (SELECT r."formId" FROM "ApprovalRequest" r WHERE r.id=a.detail->>'parentId' AND r."tenantId"=a."tenantId")
  WHEN a.detail ? 'publicationId' THEN (SELECT v."formId" FROM "Publication" p JOIN "FormVersion" v ON v.id=p."formVersionId" AND v."tenantId"=p."tenantId"
    WHERE p.id=a.detail->>'publicationId' AND p."tenantId"=a."tenantId")
  WHEN a.detail ? 'parentKind' THEN NULL
  ELSE (SELECT CASE WHEN count(DISTINCT f.id)=1 THEN min(f.id) END FROM "Form" f WHERE f."tenantId"=a."tenantId" AND f."serviceId"=a."serviceId" AND f.id IN (
    SELECT v."formId" FROM "AuthorAssetReference" r JOIN "FormVersion" v ON v.id=r."formVersionId" AND v."tenantId"=r."tenantId"
      WHERE r."assetId"=a."resourceId" AND r."tenantId"=a."tenantId" AND r."serviceId"=a."serviceId"
    UNION SELECT p."formId" FROM "AuthorAssetReference" r JOIN "ApprovalRequest" p ON p.id=r."approvalId" AND p."tenantId"=r."tenantId"
      WHERE r."assetId"=a."resourceId" AND r."tenantId"=a."tenantId" AND r."serviceId"=a."serviceId"
    UNION SELECT h.detail->>'formId' FROM "AuditEvent" h WHERE h.resource='author-asset' AND h."resourceId"=a."resourceId"
      AND h."tenantId"=a."tenantId" AND h."serviceId"=a."serviceId" AND h.action IN ('author_asset.attached','author_asset.detached')
  )) END)`;

/** Caller controls the event rows through auditWhere; still bind the asset and resolved form to their tenant/service. */
export const authorAssetAuditBinding = Prisma.sql`EXISTS (SELECT 1 FROM "AuthorAsset" aa WHERE aa.id=a."resourceId"
  AND aa."tenantId"=a."tenantId" AND aa."serviceId"=a."serviceId")`;


/** Resolve only identifiers already authorized by the audit query. Never decrypt answers or notes. */
export async function auditResources(tx: Transaction, tenantId: string, rows: EventResource[], companyWide: boolean) {
  const result = new Map<string, AuditResource>();
  if (!companyWide || !rows.length) return result;
  const ids = (resource: string) => [...new Set(rows.filter(row => row.resource === resource && row.resourceId)
    .map(row => row.resourceId!))];
  const formSelect = { id: true, serviceId: true, title: true } as const;
  const forms = await tx.form.findMany({ where: { tenantId, id: { in: ids("form") } }, select: formSelect });
  const submissions = await tx.submission.findMany({ where: { tenantId, id: { in: ids("submission") } },
    select: { id: true, formVersion: { select: { form: { select: formSelect } } } } });
  const files = await tx.fileObject.findMany({ where: { tenantId, id: { in: ids("file") } },
    select: { id: true, serviceId: true, submissionId: true, formVersionId: true } });
  const exports = await tx.exportJob.findMany({ where: { tenantId, id: { in: ids("export") } },
    select: { id: true, form: { select: formSelect } } });
  const versions = files.length ? await tx.formVersion.findMany({
    where: { tenantId, id: { in: files.flatMap(file => file.formVersionId ? [file.formVersionId] : []) } },
    select: { id: true, form: { select: formSelect } },
  }) : [];
  const linked = new Map<string, { serviceId: string; formName: string; submissionId: string | null }>();
  for (const form of forms) linked.set("form:" + form.id, { serviceId: form.serviceId, formName: form.title, submissionId: null });
  for (const row of submissions) linked.set("submission:" + row.id, { serviceId: row.formVersion.form.serviceId,
    formName: row.formVersion.form.title, submissionId: row.id });
  const versionMap = new Map(versions.map(version => [version.id, version.form]));
  for (const file of files) {
    const form = versionMap.get(file.formVersionId ?? "");
    if (form && form.serviceId === file.serviceId) linked.set("file:" + file.id,
      { serviceId: file.serviceId, formName: form.title, submissionId: file.submissionId });
  }
  for (const row of exports) linked.set("export:" + row.id, { serviceId: row.form.serviceId, formName: row.form.title, submissionId: null });
  for (const row of rows) {
    const resource = linked.get(row.resource + ":" + row.resourceId);
    // A malformed legacy reference must not borrow another service's context.
    if (resource && resource.serviceId === row.serviceId)
      result.set(row.id, { formName: resource.formName, submissionId: resource.submissionId });
  }
  const assetEvents = rows.filter(row => row.resource === "author-asset" && row.resourceId && row.serviceId);
  if (assetEvents.length) {
    const resolved = await tx.$queryRaw<{ id: string; serviceId: string; formName: string; submissionId: string | null }[]>(Prisma.sql`
      SELECT a.id,a."serviceId",f.title AS "formName",
        CASE WHEN a.detail->>'parentKind'='submission' THEN s.id ELSE NULL END AS "submissionId"
      FROM "AuditEvent" a JOIN "Form" f ON f.id=${authorAssetAuditFormId} AND f."tenantId"=a."tenantId" AND f."serviceId"=a."serviceId"
      LEFT JOIN "Submission" s ON s.id=a.detail->>'parentId' AND s."tenantId"=a."tenantId" AND a.detail->>'parentKind'='submission'
        AND EXISTS (SELECT 1 FROM "FormVersion" sv WHERE sv.id=s."formVersionId" AND sv."tenantId"=s."tenantId" AND sv."formId"=f.id)
      WHERE a."tenantId"=${tenantId} AND a.id=ANY(${assetEvents.map(row => row.id)}::text[]) AND a.resource='author-asset' AND ${authorAssetAuditBinding}`);
    const authorized = new Map(assetEvents.map(row => [row.id, row.serviceId]));
    for (const row of resolved) if (authorized.get(row.id) === row.serviceId)
      result.set(row.id, { formName: row.formName, submissionId: row.submissionId });
  }
  return result;
}
