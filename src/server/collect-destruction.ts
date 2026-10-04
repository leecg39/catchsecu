import { Prisma } from "@/generated/prisma/client";
import type { CollectDestructionList, CollectDestructionQuery, CollectDestructionRow, CollectDestructionSource } from "@/contracts/analytics";
import { audit } from "./audit";
import { type Context } from "./context";
import { db, type Transaction } from "./db";
import { documentScope } from "./documents";
import { fail } from "./http";
import { safeCsvCell } from "./import-csv";

type MergedRow = {
  date: string; sourceId: string; sourceName: string; sourceKind: string;
  serviceId: string; serviceName: string;
  collectedTotal: number | bigint; collected: number | bigint; destroyed: number | bigint; remaining: number | bigint;
  rowCount: number | bigint; sumCollected: number | bigint; sumDestroyed: number | bigint; sumCollectedTotal: number | bigint;
};

const toInt = (value: number | bigint) => Number(value);
const escapeLike = (term: string) => term.replace(/[\\%_]/g, match => "\\" + match);

function searchFragment(input: CollectDestructionQuery) {
  if (!input.search) return Prisma.empty;
  const like = "%" + escapeLike(input.search) + "%";
  if (input.searchField === "source") return Prisma.sql`AND f.title ILIKE ${like} ESCAPE '\\'`;
  if (input.searchField === "service") return Prisma.sql`AND sv.name ILIKE ${like} ESCAPE '\\'`;
  return Prisma.sql`AND (f.title ILIKE ${like} ESCAPE '\\' OR sv.name ILIKE ${like} ESCAPE '\\')`;
}

async function sourceOptions(tx: Transaction, ctx: Context, serviceIds: string[]) {
  const rows = await tx.form.findMany({
    where: { tenantId: ctx.tenantId, status: { not: "deleted" },
      serviceId: { in: serviceIds }, service: { status: { not: "deleted" } } },
    select: { id: true, title: true, sourceType: true, serviceId: true, service: { select: { name: true } } },
    orderBy: [{ serviceId: "asc" }, { title: "asc" }, { id: "asc" }],
  });
  return rows.map<CollectDestructionSource>(row => ({
    id: row.id, name: row.title, kind: row.sourceType === "import" ? "import" : "form",
    serviceId: row.serviceId, serviceName: row.service.name,
  }));
}

async function dailyRows(tx: Transaction, ctx: Context, input: CollectDestructionQuery, serviceIds: string[], limit: number | null, offset: number) {
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  return tx.$queryRaw<MergedRow[]>(Prisma.sql`
    WITH sources AS (
      SELECT f.id, f.title, f."sourceType" AS kind, f."serviceId", sv.name AS "serviceName"
      FROM "Form" f JOIN "Service" sv ON sv."tenantId" = f."tenantId" AND sv.id = f."serviceId"
      WHERE f."tenantId" = ${ctx.tenantId} AND f.status <> 'deleted' AND sv.status <> 'deleted'
        AND f."serviceId" IN (${Prisma.join(serviceIds)})
        ${input.serviceId ? Prisma.sql`AND f."serviceId" = ${input.serviceId}` : Prisma.empty}
        ${input.sourceId ? Prisma.sql`AND f.id = ${input.sourceId}` : Prisma.empty}
        ${searchFragment(input)}
    ), collected AS (
      SELECT (s."submittedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS day, v."formId" AS "sourceId", COUNT(*)::int AS n
      FROM "Submission" s
      JOIN "FormVersion" v ON v."tenantId" = s."tenantId" AND v.id = s."formVersionId"
      JOIN sources src ON src.id = v."formId"
      WHERE s."tenantId" = ${ctx.tenantId}
        ${from ? Prisma.sql`AND s."submittedAt" >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND s."submittedAt" < ${to}` : Prisma.empty}
      GROUP BY 1, 2
    ), destroyed AS (
      SELECT (dc."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS day, v."formId" AS "sourceId", COUNT(*)::int AS n
      FROM "DestructionCertificate" dc
      JOIN "Submission" s ON s."tenantId" = dc."tenantId" AND s.id = dc."submissionId"
      JOIN "FormVersion" v ON v."tenantId" = s."tenantId" AND v.id = s."formVersionId"
      JOIN sources src ON src.id = v."formId"
      WHERE dc."tenantId" = ${ctx.tenantId}
        ${from ? Prisma.sql`AND dc."completedAt" >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND dc."completedAt" < ${to}` : Prisma.empty}
      GROUP BY 1, 2
    ), totals AS (
      SELECT v."formId" AS "sourceId", COUNT(*)::int AS n
      FROM "Submission" s
      JOIN "FormVersion" v ON v."tenantId" = s."tenantId" AND v.id = s."formVersionId"
      JOIN sources src ON src.id = v."formId"
      WHERE s."tenantId" = ${ctx.tenantId}
      GROUP BY 1
    ), merged AS (
      SELECT COALESCE(c.day, d.day) AS day, COALESCE(c."sourceId", d."sourceId") AS "sourceId",
        COALESCE(c.n, 0) AS collected, COALESCE(d.n, 0) AS destroyed
      FROM collected c FULL OUTER JOIN destroyed d ON d.day = c.day AND d."sourceId" = c."sourceId"
    )
    SELECT to_char(m.day, 'YYYY-MM-DD') AS date, m."sourceId", src.title AS "sourceName", src.kind AS "sourceKind",
      src."serviceId", src."serviceName", COALESCE(t.n, 0) AS "collectedTotal",
      m.collected, m.destroyed, m.collected - m.destroyed AS remaining,
      COUNT(*) OVER () AS "rowCount", SUM(m.collected) OVER () AS "sumCollected",
      SUM(m.destroyed) OVER () AS "sumDestroyed", (SELECT COALESCE(SUM(n), 0)::int FROM totals) AS "sumCollectedTotal"
    FROM merged m JOIN sources src ON src.id = m."sourceId" LEFT JOIN totals t ON t."sourceId" = m."sourceId"
    ORDER BY m.day DESC, src."serviceName" ASC, src.title ASC, m."sourceId" ASC
    ${limit === null ? Prisma.empty : Prisma.sql`LIMIT ${limit} OFFSET ${offset}`}`);
}

async function scopedServiceIds(tx: Transaction, ctx: Context) {
  const scope = await documentScope(tx, ctx, "service.read");
  const services = await tx.service.findMany({ where: { ...scope, status: { not: "deleted" } }, select: { id: true } });
  return services.map(service => service.id);
}

const dto = (row: MergedRow): CollectDestructionRow => ({
  date: row.date, serviceId: row.serviceId, serviceName: row.serviceName,
  sourceId: row.sourceId, sourceName: row.sourceName, sourceKind: row.sourceKind === "import" ? "import" : "form",
  collectedTotal: toInt(row.collectedTotal), collected: toInt(row.collected),
  destroyed: toInt(row.destroyed), remaining: toInt(row.remaining),
});

export async function collectDestructionDaily(ctx: Context, input: CollectDestructionQuery, requestId: string) {
  return db.$transaction(async tx => {
    const allIds = await scopedServiceIds(tx, ctx);
    const serviceIds = input.serviceId ? allIds.filter(id => id === input.serviceId) : allIds;
    const sources = await sourceOptions(tx, ctx, allIds);
    const merged = serviceIds.length
      ? await dailyRows(tx, ctx, input, serviceIds, input.pageSize, (input.page - 1) * input.pageSize)
      : [];
    const rows = merged.map(dto);
    const first = merged[0];
    await audit(tx, ctx, requestId, "analytics.collect_destruction_viewed", "analytics", undefined,
      ["serviceId", "sourceId", "from", "to", "search"].filter(key => Boolean((input as Record<string, unknown>)[key])),
      input.serviceId, { count: rows.length });
    const result: CollectDestructionList = {
      page: input.page, pageSize: input.pageSize,
      total: first ? toInt(first.rowCount) : 0,
      totals: {
        collectedTotal: first ? toInt(first.sumCollectedTotal) : 0,
        collected: first ? toInt(first.sumCollected) : 0,
        destroyed: first ? toInt(first.sumDestroyed) : 0,
        remaining: first ? toInt(first.sumCollected) - toInt(first.sumDestroyed) : 0,
      },
      sources, rows,
    };
    return result;
  }, { isolationLevel: "RepeatableRead" });
}

export async function collectDestructionCsv(ctx: Context, input: CollectDestructionQuery, requestId: string) {
  return db.$transaction(async tx => {
    const allIds = await scopedServiceIds(tx, ctx);
    const serviceIds = input.serviceId ? allIds.filter(id => id === input.serviceId) : allIds;
    const merged = serviceIds.length ? await dailyRows(tx, ctx, input, serviceIds, 5001, 0) : [];
    if (merged.length > 5000) fail(413, "EXPORT_TOO_LARGE", "내보내기 건수가 5,000건을 초과합니다. 기간이나 서비스를 좁혀주세요.");
    const rows = merged.map(dto);
    await audit(tx, ctx, requestId, "analytics.collect_destruction_exported", "analytics", undefined,
      ["serviceId", "sourceId", "from", "to", "search"].filter(key => Boolean((input as Record<string, unknown>)[key])),
      input.serviceId, { count: rows.length });
    const header = ["일자", "서비스 명", "캐치폼·개인정보 업로드 명", "수집한 개인정보", "당일 수집", "당일 파기", "당일 잔여(수집-파기)"];
    const csvRows = [header, ...rows.map(row => [row.date, row.serviceName, row.sourceName,
      String(row.collectedTotal), String(row.collected), String(row.destroyed), String(row.remaining)])];
    return "﻿" + csvRows.map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
  }, { isolationLevel: "RepeatableRead" });
}
