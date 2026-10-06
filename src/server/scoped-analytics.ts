import { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";
import type { analyticsQuery } from "@/contracts/analytics";
import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { fail } from "./http";
import { audit } from "./audit";
import { analyticsPeriod } from "./analytics-period";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { securityStatus } from "./mfa-policy";

type Scoped = { id: string; name: string };
async function scopedServices(tx: Transaction, ctx: Context, input: z.infer<typeof analyticsQuery>, capability: "submission.read" | "security.read") {
  const { scope, deadlines } = await lockServiceActor(tx, ctx, capability);
  const services = await tx.service.findMany({ where: { AND: [scope, { status: "active" }] },
    select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  if (input.serviceId && !services.some(service => service.id === input.serviceId))
    fail(404, "SERVICE_NOT_FOUND", "조회 가능한 서비스를 찾을 수 없습니다.");
  return { services: (input.serviceId ? services.filter(service => service.id === input.serviceId) : services) as Scoped[], deadlines };
}

export async function privacyAnalytics(ctx: Context, input: z.infer<typeof analyticsQuery>, requestId: string) {
  return db.$transaction(async tx => {
    const [{ asOf }] = await tx.$queryRaw<{ asOf: Date }[]>`SELECT statement_timestamp() AS "asOf"`;
    const { from, to } = analyticsPeriod(input, asOf);
    const { services, deadlines } = await scopedServices(tx, ctx, input, "submission.read");
    const ids = services.map(service => service.id);
    const empty = { asOf: asOf.toISOString(), period: { from: from.toISOString(), to: to.toISOString() },
      serviceId: input.serviceId ?? null, services: [] as unknown[] };
    if (!ids.length) { await audit(tx, ctx, requestId, "analytics.privacy_viewed", "analytics"); assertFileDeadlines(deadlines); return empty; }
    type Row = { serviceId: string; retained: bigint; period: bigint; holds: bigint };
    const submissions = await tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT f."serviceId",
        COUNT(*) FILTER (WHERE s.status NOT IN ('destroying','destroyed') AND (s."legalHold" OR s."retentionUntil" > ${asOf})) AS retained,
        COUNT(*) FILTER (WHERE s."submittedAt" >= ${from} AND s."submittedAt" < ${to}) AS period,
        COUNT(*) FILTER (WHERE s."legalHold") AS holds
      FROM "Submission" s JOIN "FormVersion" v ON v.id = s."formVersionId"
        JOIN "Form" f ON f.id = v."formId"
      WHERE s."tenantId" = ${ctx.tenantId} AND f."tenantId" = ${ctx.tenantId}
        AND f."serviceId" IN (${Prisma.join(ids)}) GROUP BY f."serviceId"`);
    const consents = await tx.$queryRaw<{ serviceId: string; granted: bigint; withdrawn: bigint }[]>(Prisma.sql`
      SELECT f."serviceId",
        COUNT(*) FILTER (WHERE r."grantedAt" >= ${from} AND r."grantedAt" < ${to}) AS granted,
        COUNT(*) FILTER (WHERE e.type = 'withdrawn' AND e."createdAt" >= ${from} AND e."createdAt" < ${to}) AS withdrawn
      FROM "ConsentReceipt" r JOIN "Submission" s ON s.id = r."submissionId" AND s."tenantId" = r."tenantId"
        JOIN "FormVersion" v ON v.id = s."formVersionId" JOIN "Form" f ON f.id = v."formId"
        LEFT JOIN "ConsentEvent" e ON e."receiptId" = r.id AND e."tenantId" = r."tenantId"
      WHERE r."tenantId" = ${ctx.tenantId} AND f."serviceId" IN (${Prisma.join(ids)}) GROUP BY f."serviceId"`);
    const destructions = await tx.destructionCertificate.groupBy({ by: ["serviceId"], where: {
      tenantId: ctx.tenantId, serviceId: { in: ids }, completedAt: { gte: from, lt: to } }, _count: { _all: true } });
    const withdrawals = await tx.$queryRaw<{ serviceId: string; completed: bigint }[]>(Prisma.sql`
      SELECT f."serviceId", COUNT(*) FILTER (WHERE w.status = 'completed' AND w."finishedAt" >= ${from} AND w."finishedAt" < ${to}) AS completed
      FROM "SubjectWithdrawal" w JOIN "Submission" s ON s.id = w."submissionId" AND s."tenantId" = w."tenantId"
        JOIN "FormVersion" v ON v.id = s."formVersionId" JOIN "Form" f ON f.id = v."formId"
      WHERE w."tenantId" = ${ctx.tenantId} AND f."serviceId" IN (${Prisma.join(ids)}) GROUP BY f."serviceId"`);
    const sub = new Map(submissions.map(row => [row.serviceId, row]));
    const con = new Map(consents.map(row => [row.serviceId, row]));
    const des = new Map(destructions.map(row => [row.serviceId, row._count._all]));
    const wit = new Map(withdrawals.map(row => [row.serviceId, row]));
    await audit(tx, ctx, requestId, "analytics.privacy_viewed", "analytics", undefined, [], input.serviceId);
    assertFileDeadlines(deadlines);
    return { ...empty, services: services.map(service => ({ id: service.id, name: service.name,
      retainedSubmissions: Number(sub.get(service.id)?.retained ?? 0),
      periodSubmissions: Number(sub.get(service.id)?.period ?? 0),
      legalHolds: Number(sub.get(service.id)?.holds ?? 0),
      periodConsents: Number(con.get(service.id)?.granted ?? 0),
      periodConsentWithdrawals: Number(con.get(service.id)?.withdrawn ?? 0),
      periodSubjectWithdrawals: Number(wit.get(service.id)?.completed ?? 0),
      periodDestructions: des.get(service.id) ?? 0 })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

export async function complianceOverview(ctx: Context, input: z.infer<typeof analyticsQuery>, requestId: string) {
  const hasPolicy = await db.securityPolicy.findUnique({ where: { tenantId: ctx.tenantId }, select: { tenantId: true } });
  const company = hasPolicy ? await securityStatus(ctx)
    : { tenantId: ctx.tenantId, checkedAt: new Date().toISOString(), checks: [], attention: 0, scope: "회사 보안 정책이 설정되지 않았습니다." };
  const servicesPart = await db.$transaction(async tx => {
    const { services, deadlines } = await scopedServices(tx, ctx, input, "security.read");
    const ids = services.map(service => service.id);
    type Row = { serviceId: string; publishedForms: bigint; publishedDocuments: bigint; senders: bigint };
    const stats = ids.length ? await tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT svc.id AS "serviceId",
        (SELECT COUNT(*) FROM "Form" f WHERE f."tenantId" = svc."tenantId" AND f."serviceId" = svc.id AND f.status = 'published') AS "publishedForms",
        (SELECT COUNT(*) FROM "Document" d WHERE d."tenantId" = svc."tenantId" AND d."serviceId" = svc.id AND d.status = 'published') AS "publishedDocuments",
        (SELECT COUNT(*) FROM "Sender" s WHERE s."tenantId" = svc."tenantId" AND s."serviceId" = svc.id AND s.status = 'enabled') AS senders
      FROM "Service" svc WHERE svc."tenantId" = ${ctx.tenantId} AND svc.id IN (${Prisma.join(ids)})`) : [];
    const integrations = ids.length ? await tx.verificationIntegration.findMany({
      where: { tenantId: ctx.tenantId, serviceId: { in: ids } }, select: { serviceId: true, status: true } }) : [];
    const rules = ids.length ? await tx.retentionRule.findMany({
      where: { tenantId: ctx.tenantId, serviceId: { in: ids }, status: "active" }, select: { serviceId: true } }) : [];
    const statMap = new Map(stats.map(row => [row.serviceId, row]));
    const enabled = new Set(integrations.filter(row => row.status === "enabled").map(row => row.serviceId));
    const ruled = new Set(rules.map(row => row.serviceId));
    await audit(tx, ctx, requestId, "analytics.compliance_viewed", "analytics", undefined, [], input.serviceId);
    assertFileDeadlines(deadlines);
    return services.map(service => ({ id: service.id, name: service.name,
      publishedForms: Number(statMap.get(service.id)?.publishedForms ?? 0),
      publishedDocuments: Number(statMap.get(service.id)?.publishedDocuments ?? 0),
      enabledSenders: Number(statMap.get(service.id)?.senders ?? 0),
      verificationEnabled: enabled.has(service.id), retentionRuleActive: ruled.has(service.id) }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  return { tenantId: ctx.tenantId, checkedAt: new Date().toISOString(), company, services: servicesPart };
}
