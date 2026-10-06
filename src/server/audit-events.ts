import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import { type Context, serviceScope } from "./context";
import { fail } from "./http";
import { lockAccountActor } from "./account-actor";
import { assertFileDeadlines } from "./file-access";
import type { requireActor } from "./context";
import { safeCsvCell } from "./import-csv";
import { lockServiceActor } from "./service-actor";
import { roleCapabilities } from "./permissions";
import { auditAccess } from "./audit";

export const auditEventQuery = z.object({
  scope: z.enum(["company", "mine"]).default("company"),
  kind: z.enum(["all", "service", "info", "marketing", "customer", "member", "authority", "external", "access", "mail"]).default("all"),
  serviceId: z.uuid().optional(), actorId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  search: z.string().trim().max(100).default(""),
  searchField: z.enum(["action", "resource", "actor"]).default("action"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(input => !input.from || !input.to || new Date(input.from).getTime() <= new Date(input.to).getTime(),
  { path: ["to"], message: "종료일시는 시작일시 이후여야 합니다." });
export type AuditEventQuery = z.infer<typeof auditEventQuery>;

export const actionPrefixes: Record<AuditEventQuery["kind"], readonly string[]> = {
  all: [], service: ["service.", "company."],
  info: ["submission.", "file.", "consent_receipt.", "destruction.", "import."],
  marketing: ["marketing."], customer: ["subject.", "submission."],
  member: ["member.", "invitation.", "expert.", "access_request.", "company.ownership_"],
  authority: ["member.", "invitation.", "expert.", "access_request.", "policy.", "mfa_policy.", "mfa_exception.", "ip_access.", "ip_rule."],
  external: ["share."], access: ["session.", "auth.", "context."],
  mail: ["campaign.", "email.", "message.", "sender."],
};

const companyAuditRoles = new Set(["owner", "admin", "security", "auditor"]);
const safeResourceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const auditSelect = { id: true, action: true, resource: true, resourceId: true,
  serviceId: true, createdAt: true, actor: { select: { name: true } } } as const;
type AuditRow = Prisma.AuditEventGetPayload<{ select: typeof auditSelect }>;
export const maxAuditExportRows = 5000;

function ownAuditWhere(userId: string, input: AuditEventQuery): Prisma.AuditEventWhereInput {
  if (input.scope !== "mine" || input.actorId || input.serviceId || input.searchField === "actor")
    fail(422, "OWN_ACTIVITY_FILTER", "본인 활동은 처리내용·처리대상과 기간으로 조회해주세요.");
  const prefixes = actionPrefixes[input.kind];
  return { actorId: userId,
    ...(prefixes.length ? { OR: prefixes.map(prefix => ({ action: { startsWith: prefix } })) } : {}),
    ...(input.search ? { [input.searchField]: { contains: input.search, mode: "insensitive" } } : {}),
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lt: new Date(input.to) } : {}) } } : {}),
  };
}
type AccountActor = Awaited<ReturnType<typeof requireActor>>;
export async function listOwnAuditEvents(actor: AccountActor, input: AuditEventQuery, requestId: string = randomUUID()) {
  return db.$transaction(async tx => {
    const current = await lockAccountActor(tx, actor);
    const where = ownAuditWhere(current.user.id, input);
    const total = await tx.auditEvent.count({ where });
    const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const rows = await tx.auditEvent.findMany({ where, select: { id: true, createdAt: true, action: true, resource: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * input.pageSize, take: input.pageSize });
    await auditAccess(tx, { tenantId: null, user: current.user }, requestId, "audit.viewed", accessDetail(input, rows.length));
    assertFileDeadlines(current.deadlines);
    return { items: rows.map(row => ({ ...row, resourceId: null, serviceId: null, serviceName: null, actorName: current.user.name })),
      total, page, pageSize: input.pageSize };
  }, auditTransaction);
}
export async function exportOwnAuditEvents(actor: AccountActor, input: AuditEventQuery, requestId: string) {
  return db.$transaction(async tx => {
    const current = await lockAccountActor(tx, actor);
    const rows = await tx.auditEvent.findMany({ where: ownAuditWhere(current.user.id, input), select: { id: true, createdAt: true, action: true, resource: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: maxAuditExportRows + 1 });
    if (rows.length > maxAuditExportRows) fail(413, "AUDIT_EXPORT_LIMIT", "내보낼 기록이 5,000건을 넘습니다. 기간을 좁혀주세요.");
    const csvRows = [["이벤트 ID", "처리일시", "처리자명", "처리내용", "처리대상"],
      ...rows.map(row => [row.id, row.createdAt.toISOString(), current.user.name, row.action, row.resource])];
    await auditAccess(tx, { tenantId: null, user: current.user }, requestId, "audit.exported", accessDetail(input, rows.length));
    const csv = "\uFEFF" + csvRows.map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
    assertFileDeadlines(current.deadlines);
    return csv;
  }, auditTransaction);
}

export const auditTransaction = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 };
export function accessDetail(input: AuditEventQuery, rowCount: number) {
  return { scope: input.scope, kind: input.kind, rowCount, hasSearch: !!input.search,
    hasActorFilter: !!input.actorId, hasFrom: !!input.from, hasTo: !!input.to };
}
export async function auditActor(tx: Transaction, ctx: Context, input: AuditEventQuery) {
  const actor = await lockServiceActor(tx, ctx, input.scope === "company" ? "audit.read" : "service.read");
  const current: Context = { ...ctx, member: actor.member, capabilities: roleCapabilities(actor.member.role) };
  return { current, deadlines: actor.deadlines, serviceScope: actor.scope };
}
export async function auditWhere(tx: Transaction, ctx: Context, input: AuditEventQuery) {
  const companyWide = companyAuditRoles.has(ctx.member.role);
  if (input.scope === "company" && !ctx.capabilities.includes("audit.read"))
    fail(403, "AUDIT_FORBIDDEN", "감사 기록 조회 권한이 없습니다.");
  if (input.actorId && (!companyWide || input.scope === "mine" && input.actorId !== ctx.user.id))
    fail(403, "ACTOR_FILTER_FORBIDDEN", "처리자 필터를 사용할 권한이 없습니다.");
  if (input.search && input.searchField === "actor" && !companyWide)
    fail(403, "ACTOR_SEARCH_FORBIDDEN", "처리자 검색 권한이 없습니다.");

  const scoped = companyWide ? null : serviceScope(ctx, input.scope === "mine" ? "service.read" : "audit.read");
  const serviceIds = scoped?.id?.in ?? (companyWide ? null : []);
  if (input.serviceId) {
    const service = await tx.service.findFirst({ where: { id: input.serviceId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!service || serviceIds && !serviceIds.includes(input.serviceId))
      fail(404, "SERVICE_NOT_FOUND", "현재 회사의 조회 가능한 서비스를 찾을 수 없습니다.");
  }
  const prefix = actionPrefixes[input.kind];
  const and: Prisma.AuditEventWhereInput[] = [];
  if (!input.serviceId && serviceIds) and.push(input.scope === "mine"
    ? { OR: [{ serviceId: { in: serviceIds } }, { serviceId: null }] }
    : { serviceId: { in: serviceIds } });
  if (prefix.length) and.push({ OR: prefix.map(value => ({ action: { startsWith: value } })) });
  if (input.search) and.push(input.searchField === "actor"
    ? { actor: { name: { contains: input.search, mode: "insensitive" } } }
    : { [input.searchField]: { contains: input.search, mode: "insensitive" } });
  const where: Prisma.AuditEventWhereInput = {
    tenantId: ctx.tenantId,
    ...(input.scope === "mine" ? { actorId: ctx.user.id } : input.actorId ? { actorId: input.actorId } : {}),
    ...(input.serviceId ? { serviceId: input.serviceId } : {}),
    ...(and.length ? { AND: and } : {}),
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: new Date(input.from) } : {}),
      ...(input.to ? { lt: new Date(input.to) } : {}) } } : {}),
  };
  return { where, companyWide };
}

export async function safeRows(tx: Transaction, ctx: Context, rows: AuditRow[], companyWide: boolean, scope: AuditEventQuery["scope"]) {
  const services = rows.length ? await tx.service.findMany({ where: { tenantId: ctx.tenantId,
    id: { in: rows.flatMap(row => row.serviceId ? [row.serviceId] : []) } }, select: { id: true, name: true } }) : [];
  const names = new Map(services.map(item => [item.id, item.name]));
  const showActor = companyWide || scope === "mine";
  return rows.map(row => ({ id: row.id, createdAt: row.createdAt, action: row.action,
    resource: row.resource, resourceId: companyWide && row.resourceId && safeResourceId.test(row.resourceId) ? row.resourceId : null,
    serviceId: row.serviceId, serviceName: row.serviceId ? names.get(row.serviceId) ?? "조회할 수 없는 서비스" : null,
    actorName: showActor ? row.actor?.name ?? "처리자 정보 없음" : null }));
}

export async function listAuditEvents(ctx: Context, input: AuditEventQuery, requestId: string = randomUUID()) {
  return db.$transaction(async tx => {
    const { current, deadlines } = await auditActor(tx, ctx, input);
    const { where, companyWide } = await auditWhere(tx, current, input);
    const total = await tx.auditEvent.count({ where });
    const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const rows = await tx.auditEvent.findMany({ where, select: auditSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * input.pageSize, take: input.pageSize });
    const items = await safeRows(tx, current, rows, companyWide, input.scope);
    await auditAccess(tx, current, requestId, "audit.viewed", accessDetail(input, rows.length), input.serviceId);
    assertFileDeadlines(deadlines);
    return { items, total, page, pageSize: input.pageSize };
  }, auditTransaction);
}

export async function exportAuditEvents(ctx: Context, input: AuditEventQuery, requestId: string) {
  return db.$transaction(async tx => {
    const { current, deadlines } = await auditActor(tx, ctx, input);
    const { where, companyWide } = await auditWhere(tx, current, input);
    const rows = await tx.auditEvent.findMany({ where, select: auditSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: maxAuditExportRows + 1 });
    if (rows.length > maxAuditExportRows)
      fail(413, "AUDIT_EXPORT_LIMIT", "내보낼 기록이 5,000건을 넘습니다. 기간이나 서비스를 좁혀주세요.");
    const safe = await safeRows(tx, current, rows, companyWide, input.scope);
    const csvRows = [["이벤트 ID", "처리일시", "서비스명", "처리자명", "처리내용", "처리대상", "대상 ID"],
      ...safe.map(item => [item.id, item.createdAt.toISOString(), item.serviceName ?? "회사 공통",
        item.actorName ?? "비공개", item.action, item.resource, item.resourceId ?? ""])];
    const csv = "\uFEFF" + csvRows.map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
    await auditAccess(tx, current, requestId, "audit.exported", accessDetail(input, safe.length), input.serviceId);
    assertFileDeadlines(deadlines);
    return csv;
  }, auditTransaction);
}
