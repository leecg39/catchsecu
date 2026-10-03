import { Prisma } from "@/generated/prisma/client";
import type { AnalyticsDashboard, AnalyticsQuery } from "@/contracts/analytics";
import type { Context } from "./context";
import { db } from "./db";
import { fail } from "./http";
import { audit } from "./audit";
import { documentScope } from "./documents";
import { analyticsPeriod } from "./analytics-period";

type SubmissionCount = { serviceId: string; retained: bigint; period: bigint };
type TopForm = { id: string; title: string; serviceId: string; createdAt: Date; retained: bigint };

export async function dashboardAnalytics(ctx: Context, input: AnalyticsQuery, requestId: string): Promise<AnalyticsDashboard> {
  return db.$transaction(async tx => {
    const [{ asOf }] = await tx.$queryRaw<{ asOf: Date }[]>`SELECT statement_timestamp() AS "asOf"`;
    const { from, to } = analyticsPeriod(input, asOf);
    const scope = await documentScope(tx, ctx, "service.read");
    const visible = await tx.service.findMany({ where: { ...scope, status: "active" },
      select: { id: true, name: true, createdAt: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    if (input.serviceId && !visible.some(service => service.id === input.serviceId))
      fail(404, "SERVICE_NOT_FOUND", "조회 가능한 서비스를 찾을 수 없습니다.");
    const services = input.serviceId ? visible.filter(service => service.id === input.serviceId) : visible;
    const ids = services.map(service => service.id);
    const empty: AnalyticsDashboard = { asOf: asOf.toISOString(), period: { from: from.toISOString(), to: to.toISOString() },
      serviceId: input.serviceId ?? null,
      totals: { services: 0, forms: 0, consentDocuments: 0, policyDocuments: 0,
        retainedSubmissions: 0, periodSubmissions: 0, periodDestructions: 0 },
      services: [], topForms: [] };
    if (!ids.length) {
      await audit(tx, ctx, requestId, "analytics.dashboard_viewed", "analytics");
      return empty;
    }
    const formCounts = await tx.form.groupBy({ by: ["serviceId"], where: { tenantId: ctx.tenantId,
      serviceId: { in: ids }, sourceType: "form", status: { not: "deleted" } }, _count: { _all: true } });
    const documentCounts = await tx.document.groupBy({ by: ["serviceId", "type"], where: { tenantId: ctx.tenantId,
      serviceId: { in: ids }, status: { not: "archived" }, type: { in: ["consent", "privacy_policy"] } }, _count: { _all: true } });
    const submissions = await tx.$queryRaw<SubmissionCount[]>(Prisma.sql`
      SELECT f."serviceId", COUNT(*) FILTER (WHERE s.status NOT IN ('destroying', 'destroyed')
        AND (s."legalHold" OR s."retentionUntil" > ${asOf})) AS retained,
        COUNT(*) FILTER (WHERE s."submittedAt" >= ${from} AND s."submittedAt" < ${to}
          AND s.status NOT IN ('destroying', 'destroyed')
          AND (s."legalHold" OR s."retentionUntil" > ${asOf})) AS period
      FROM "Submission" s JOIN "FormVersion" v ON v.id = s."formVersionId"
        JOIN "Form" f ON f.id = v."formId"
      WHERE s."tenantId" = ${ctx.tenantId} AND f."tenantId" = ${ctx.tenantId}
        AND f."serviceId" IN (${Prisma.join(ids)})
      GROUP BY f."serviceId"`);
    const destructions = await tx.destructionCertificate.groupBy({ by: ["serviceId"], where: {
      tenantId: ctx.tenantId, serviceId: { in: ids }, completedAt: { gte: from, lt: to },
    }, _count: { _all: true } });
    const topRows = await tx.$queryRaw<TopForm[]>(Prisma.sql`
      SELECT f.id, f.title, f."serviceId", f."createdAt",
        COUNT(s.id) FILTER (WHERE s.status NOT IN ('destroying', 'destroyed')
          AND (s."legalHold" OR s."retentionUntil" > ${asOf})) AS retained
      FROM "Form" f LEFT JOIN "FormVersion" v ON v."formId" = f.id
        LEFT JOIN "Submission" s ON s."formVersionId" = v.id AND s."tenantId" = f."tenantId"
      WHERE f."tenantId" = ${ctx.tenantId} AND f."serviceId" IN (${Prisma.join(ids)})
        AND f."sourceType" = 'form' AND f.status <> 'deleted'
      GROUP BY f.id ORDER BY retained DESC, f."createdAt" DESC, f.id DESC LIMIT 5`);
    const formMap = new Map(formCounts.map(row => [row.serviceId, row._count._all]));
    const submissionMap = new Map(submissions.map(row => [row.serviceId, row]));
    const rows = services.map(service => ({ id: service.id, name: service.name,
      createdAt: service.createdAt.toISOString(), forms: formMap.get(service.id) ?? 0,
      retainedSubmissions: Number(submissionMap.get(service.id)?.retained ?? 0),
      periodSubmissions: Number(submissionMap.get(service.id)?.period ?? 0) }));
    const total = (field: "retainedSubmissions" | "periodSubmissions") => rows.reduce((sum, row) => sum + row[field], 0);
    await audit(tx, ctx, requestId, "analytics.dashboard_viewed", "analytics", undefined, [], input.serviceId);
    return { ...empty, totals: {
      services: services.length, forms: rows.reduce((sum, row) => sum + row.forms, 0),
      consentDocuments: documentCounts.filter(row => row.type === "consent").reduce((sum, row) => sum + row._count._all, 0),
      policyDocuments: documentCounts.filter(row => row.type === "privacy_policy").reduce((sum, row) => sum + row._count._all, 0),
      retainedSubmissions: total("retainedSubmissions"), periodSubmissions: total("periodSubmissions"),
      periodDestructions: destructions.reduce((sum, row) => sum + row._count._all, 0),
    }, services: rows.sort((a, b) => b.retainedSubmissions - a.retainedSubmissions || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    topForms: topRows.map(row => ({ id: row.id, title: row.title, serviceId: row.serviceId,
      serviceName: services.find(service => service.id === row.serviceId)?.name ?? "", createdAt: row.createdAt.toISOString(),
      retainedSubmissions: Number(row.retained) })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
