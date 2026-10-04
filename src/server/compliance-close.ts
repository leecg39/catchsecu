import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { complianceCloseInput, type AnalyticsDashboard, type ComplianceCloseRecord } from "@/contracts/analytics";
import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { fail } from "./http";
import { audit } from "./audit";
import { dashboardAnalyticsInTransaction } from "./analytics";
import { safeCsvCell } from "./import-csv";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { complianceEvidenceSchema, complianceEvidenceChecks, evidenceStatusLabels } from "@/contracts/compliance-evidence";
import { collectComplianceEvidence, complianceEvidenceHash } from "./compliance-evidence";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
const count = z.number().int().nonnegative().safe();
const snapshotSchema = z.object({
  verdict: z.literal("not_assessed"), month: complianceCloseInput.shape.month, serviceId: z.uuid().nullable(),
  period: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  totals: z.object({ services: count, forms: count, consentDocuments: count, policyDocuments: count,
    retainedSubmissions: count, periodSubmissions: count, periodDestructions: count }),
  services: z.array(z.object({ id: z.uuid(), name: z.string(), retainedSubmissions: count, periodSubmissions: count })),
  evidence: complianceEvidenceSchema.optional(),
});
type Snapshot = z.infer<typeof snapshotSchema>;
type CloseRow = { id: string; month: string; serviceKey: string; createdAt: Date; snapshot: unknown };

function monthRange(month: string, asOf: Date) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) fail(422, "INVALID_MONTH", "마감 월은 YYYY-MM 형식이어야 합니다.");
  const year = Number(match[1]), mon = Number(match[2]);
  const from = new Date(Date.UTC(year, mon - 1, 1) - KOREA_OFFSET_MS);
  const next = new Date(Date.UTC(year, mon, 1) - KOREA_OFFSET_MS);
  if (from > asOf) fail(422, "FUTURE_MONTH", "아직 시작하지 않은 월은 마감할 수 없습니다.");
  return { from, to: next > asOf ? asOf : next };
}
export function complianceSnapshot(row: CloseRow): Snapshot {
  const parsed = snapshotSchema.safeParse(row.snapshot);
  if (!parsed.success) fail(409, "CLOSE_INVALID", "마감 기록의 판정 근거를 확인할 수 없습니다.");
  const snapshot = parsed.data, ids = new Set(snapshot.services.map(service => service.id));
  if (snapshot.month !== row.month || (snapshot.serviceId ?? "") !== row.serviceKey ||
    ids.size !== snapshot.services.length || snapshot.totals.services !== ids.size ||
    (row.serviceKey && (ids.size !== 1 || !ids.has(row.serviceKey))))
    fail(409, "CLOSE_INVALID", "마감 기록의 조회 범위가 일치하지 않습니다.");
  const evidence = snapshot.evidence;
  if (evidence) {
    const f = evidence.facts;
    if (evidence.hash !== complianceEvidenceHash(evidence) ||
      JSON.stringify(evidence.serviceIds) !== JSON.stringify([...ids].sort()) || f.services !== ids.size ||
      f.purposeServices > f.services || f.policyServices > f.services ||
      f.activePurposes < f.purposeServices || f.livePolicyPublications < f.policyServices ||
      f.overdueSubmissions + f.heldSubmissions > f.unpurgedSubmissions ||
      (snapshot.serviceId && f.companyMfa !== null) ||
      (f.companyMfa && f.companyMfa.enrolled > f.companyMfa.members) ||
      new Date(evidence.checkedAt) > row.createdAt)
      fail(409, "CLOSE_INVALID", "마감 점검 근거의 무결성 또는 범위가 일치하지 않습니다.");
  }
  return snapshot;
}
function record(row: CloseRow, snapshot: Snapshot): ComplianceCloseRecord {
  return { id: row.id, month: row.month, serviceId: snapshot.serviceId, createdAt: row.createdAt.toISOString(),
    verdict: "not_assessed", period: snapshot.period, totals: snapshot.totals,
    ...(snapshot.evidence ? { evidence: snapshot.evidence } : {}) };
}
export async function authorizeComplianceClose(tx: Transaction, ctx: Context, serviceKey: string) {
  const actor = await lockServiceActor(tx, ctx, "service.read");
  // A shared company-wide key must never contain only one member's granted subset.
  if (!serviceKey) {
    if (actor.member.accessKind !== "direct" || !["owner", "admin"].includes(actor.member.role))
      fail(403, "COMPANY_CLOSE_FORBIDDEN", "회사 전체 마감은 소유자와 관리자만 이용할 수 있습니다. 서비스를 선택해주세요.");
  } else if (!await tx.service.findFirst({ where: { AND: [actor.scope, { id: serviceKey, status: "active" }] }, select: { id: true } })) {
    fail(404, "SERVICE_NOT_FOUND", "조회 가능한 서비스를 찾을 수 없습니다.");
  }
  return actor;
}
const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 };
export async function readComplianceClose(ctx: Context, input: z.infer<typeof complianceCloseInput>, requestId: string = randomUUID()) {
  return db.$transaction(async tx => {
    const serviceKey = input.serviceId ?? "", actor = await authorizeComplianceClose(tx, ctx, serviceKey);
    const row = await tx.complianceClose.findUnique({ where: { tenantId_serviceKey_month: { tenantId: ctx.tenantId, serviceKey, month: input.month } } });
    const close = row ? record(row, complianceSnapshot(row)) : null;
    await audit(tx, ctx, requestId, "compliance.viewed", "complianceClose", row?.id, [], input.serviceId);
    assertFileDeadlines(actor.deadlines);
    return { close };
  }, options);
}
export async function closeComplianceMonth(ctx: Context, input: z.infer<typeof complianceCloseInput>, requestId: string) {
  const serviceKey = input.serviceId ?? "";
  // A concurrent creator can win after our repeatable-read snapshot. Retry the
  // entire authorized operation, never return the winner outside its own checks.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const actor = await authorizeComplianceClose(tx, ctx, serviceKey);
        const existing = await tx.complianceClose.findUnique({ where: { tenantId_serviceKey_month: { tenantId: ctx.tenantId, serviceKey, month: input.month } } });
        if (existing) {
          const close = record(existing, complianceSnapshot(existing));
          await audit(tx, ctx, requestId, "compliance.viewed", "complianceClose", existing.id, [], input.serviceId);
          assertFileDeadlines(actor.deadlines);
          return { created: false, close };
        }
        const [{ asOf }] = await tx.$queryRaw<{ asOf: Date }[]>`SELECT statement_timestamp() AS "asOf"`;
        const { from, to } = monthRange(input.month, asOf);
        const dashboard: AnalyticsDashboard = await dashboardAnalyticsInTransaction(tx, ctx,
          { serviceId: input.serviceId, from: from.toISOString(), to: to.toISOString() }, requestId, actor.scope);
        const snapshot: Snapshot = { verdict: "not_assessed", month: input.month, serviceId: input.serviceId ?? null,
          period: dashboard.period, totals: dashboard.totals,
          services: dashboard.services.map(service => ({ id: service.id, name: service.name,
            retainedSubmissions: service.retainedSubmissions, periodSubmissions: service.periodSubmissions })),
          evidence: await collectComplianceEvidence(tx, ctx.tenantId, dashboard.services.map(service => service.id), new Date(dashboard.asOf), !serviceKey) };
        const row = await tx.complianceClose.create({ data: { tenantId: ctx.tenantId, serviceKey, month: input.month, snapshot, createdBy: ctx.user.id, createdAt: new Date(dashboard.asOf) } });
        await audit(tx, ctx, requestId, "compliance.closed", "complianceClose", row.id, ["month"], input.serviceId);
        assertFileDeadlines(actor.deadlines);
        return { created: true, close: record(row, snapshot) };
      }, options);
    } catch (error) {
      const retry = error instanceof Prisma.PrismaClientKnownRequestError &&
        (["P2002", "P2034"].includes(error.code) || (error.code === "P2010" && error.meta?.code === "40001"));
      if (!retry) throw error;
      if (attempt === 2) fail(409, "CLOSE_RETRY", "다른 작업과 마감이 겹쳤습니다. 다시 시도해주세요.");
    }
  }
  throw new Error("Unreachable close retry");
}
export async function complianceCloseCsv(ctx: Context, id: string, requestId: string = randomUUID()) {
  return db.$transaction(async tx => {
    const row = await tx.complianceClose.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "마감 기록을 찾을 수 없습니다.");
    const actor = await authorizeComplianceClose(tx, ctx, row.serviceKey), snapshot = complianceSnapshot(row);
    const csv = renderComplianceCsv(snapshot);
    await audit(tx, ctx, requestId, "compliance.exported", "complianceClose", row.id, [], row.serviceKey || undefined);
    assertFileDeadlines(actor.deadlines);
    return csv;
  }, options);
}

export function renderComplianceCsv(snapshot: Snapshot) {
    const lines = [["월", "판정", "서비스", "보유 응답", "기간 접수", "기간 파기"],
      [snapshot.month, "미판정", snapshot.serviceId ? "선택 서비스" : "전체", String(snapshot.totals.retainedSubmissions), String(snapshot.totals.periodSubmissions), String(snapshot.totals.periodDestructions)],
      ...snapshot.services.map(service => [snapshot.month, "미판정", service.name, String(service.retainedSubmissions), String(service.periodSubmissions), ""])];
    if (snapshot.evidence) {
      lines.push([], ["점검 시각", snapshot.evidence.checkedAt], ["근거 해시", snapshot.evidence.hash],
        ["주의", "점검은 마감 저장 당시의 데이터이며 과거 월말 복원이 아닙니다. 조건 확인은 법적 준수 판정이 아닙니다."],
        ["항목 ID", "분류", "점검 항목", "상태", "저장된 근거", "원천"]);
      for (const check of complianceEvidenceChecks(snapshot.evidence))
        lines.push([check.id, check.category, check.title, evidenceStatusLabels[check.status], check.detail, check.source]);
    }
    if (lines.length > 5000) fail(413, "EXPORT_TOO_LARGE", "마감 내보내기는 5,000행을 넘을 수 없습니다.");
    return "\uFEFF" + lines.map(line => line.map(cell => safeCsvCell(cell)).join(",")).join("\r\n") + "\r\n";
}
