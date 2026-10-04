import { Prisma } from "@/generated/prisma/client";
import { complianceCloseInput, type AnalyticsDashboard, type ComplianceCloseRecord } from "@/contracts/analytics";
import type { z } from "zod";
import type { Context } from "./context";
import { db } from "./db";
import { fail } from "./http";
import { audit } from "./audit";
import { dashboardAnalytics } from "./analytics";
import { safeCsvCell } from "./import-csv";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
type Snapshot = { verdict: "not_assessed"; month: string; serviceId: string | null; period: { from: string; to: string }; totals: AnalyticsDashboard["totals"]; services: { id: string; name: string; retainedSubmissions: number; periodSubmissions: number }[] };

function monthRange(month: string, asOf: Date) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) fail(422, "INVALID_MONTH", "마감 월은 YYYY-MM 형식이어야 합니다.");
  const year = Number(match[1]), mon = Number(match[2]);
  const from = new Date(Date.UTC(year, mon - 1, 1) - KOREA_OFFSET_MS);
  const next = new Date(Date.UTC(year, mon, 1) - KOREA_OFFSET_MS);
  if (from > asOf) fail(422, "FUTURE_MONTH", "아직 시작하지 않은 월은 마감할 수 없습니다.");
  return { from, to: next > asOf ? asOf : next };
}
function record(row: { id: string; month: string; createdAt: Date; snapshot: unknown }): ComplianceCloseRecord {
  const snapshot = row.snapshot as Snapshot;
  return { id: row.id, month: row.month, serviceId: snapshot.serviceId, createdAt: row.createdAt.toISOString(),
    verdict: "not_assessed", period: snapshot.period, totals: snapshot.totals };
}
export async function readComplianceClose(ctx: Context, input: z.infer<typeof complianceCloseInput>) {
  const row = await db.complianceClose.findUnique({ where: { tenantId_serviceKey_month: { tenantId: ctx.tenantId, serviceKey: input.serviceId ?? "", month: input.month } } });
  return { close: row && row.snapshot && (row.snapshot as Snapshot).verdict === "not_assessed" ? record(row) : null };
}
export async function closeComplianceMonth(ctx: Context, input: z.infer<typeof complianceCloseInput>, requestId: string) {
  const serviceKey = input.serviceId ?? "";
  const existing = await db.complianceClose.findUnique({ where: { tenantId_serviceKey_month: { tenantId: ctx.tenantId, serviceKey, month: input.month } } });
  if (existing) return { created: false, close: record(existing) };
  const [{ asOf }] = await db.$queryRaw<{ asOf: Date }[]>`SELECT statement_timestamp() AS "asOf"`;
  const { from, to } = monthRange(input.month, asOf);
  const dashboard = await dashboardAnalytics(ctx, { serviceId: input.serviceId, from: from.toISOString(), to: to.toISOString() }, requestId);
  const snapshot: Snapshot = { verdict: "not_assessed", month: input.month, serviceId: input.serviceId ?? null, period: dashboard.period, totals: dashboard.totals,
    services: dashboard.services.map(service => ({ id: service.id, name: service.name, retainedSubmissions: service.retainedSubmissions, periodSubmissions: service.periodSubmissions })) };
  try {
    const row = await db.complianceClose.create({ data: { tenantId: ctx.tenantId, serviceKey, month: input.month, snapshot, createdBy: ctx.user.id } });
    await db.$transaction(tx => audit(tx, ctx, requestId, "compliance.closed", "complianceClose", row.id, ["month"], input.serviceId));
    return { created: true, close: record(row) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await db.complianceClose.findUniqueOrThrow({ where: { tenantId_serviceKey_month: { tenantId: ctx.tenantId, serviceKey, month: input.month } } });
      return { created: false, close: record(row) };
    }
    throw error;
  }
}
export async function complianceCloseCsv(ctx: Context, id: string) {
  const row = await db.complianceClose.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "마감 기록을 찾을 수 없습니다.");
  const snapshot = row.snapshot as Snapshot;
  if (snapshot.verdict !== "not_assessed") fail(409, "CLOSE_INVALID", "마감 기록의 판정 근거를 확인할 수 없습니다.");
  const lines = [["월", "판정", "서비스", "보유 응답", "기간 접수", "기간 파기"],
    [snapshot.month, "미판정", snapshot.serviceId ? "선택 서비스" : "전체", String(snapshot.totals.retainedSubmissions), String(snapshot.totals.periodSubmissions), String(snapshot.totals.periodDestructions)],
    ...snapshot.services.map(service => [snapshot.month, "미판정", service.name, String(service.retainedSubmissions), String(service.periodSubmissions), ""])];
  if (lines.length > 5000) fail(413, "EXPORT_TOO_LARGE", "마감 내보내기는 5,000행을 넘을 수 없습니다.");
  return "\uFEFF" + lines.map(line => line.map(cell => safeCsvCell(cell)).join(",")).join("\r\n") + "\r\n";
}
