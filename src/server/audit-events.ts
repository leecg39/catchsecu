import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { type Context, serviceScope } from "./context";
import { fail } from "./http";
import { safeCsvCell } from "./import-csv";

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

const actionPrefixes: Record<AuditEventQuery["kind"], readonly string[]> = {
  all: [], service: ["service.", "company."],
  info: ["submission.", "file.", "destruction.", "import."],
  marketing: ["marketing."], customer: ["subject.", "submission."],
  member: ["member.", "invitation.", "expert.", "access_request.", "company.ownership_"],
  authority: ["member.", "invitation.", "expert.", "access_request.", "policy."],
  external: ["share."], access: ["session.", "auth."],
  mail: ["campaign.", "email.", "message.", "sender."],
};

const companyAuditRoles = new Set(["owner", "admin", "security", "auditor"]);
const safeResourceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auditSelect = { id: true, action: true, resource: true, resourceId: true,
  serviceId: true, createdAt: true, actor: { select: { name: true } } } as const;
type AuditRow = Prisma.AuditEventGetPayload<{ select: typeof auditSelect }>;
export const maxAuditExportRows = 5000;

async function auditWhere(ctx: Context, input: AuditEventQuery) {
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
    const service = await db.service.findFirst({ where: { id: input.serviceId, tenantId: ctx.tenantId }, select: { id: true } });
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

async function safeRows(ctx: Context, rows: AuditRow[], companyWide: boolean, scope: AuditEventQuery["scope"]) {
  const services = rows.length ? await db.service.findMany({ where: { tenantId: ctx.tenantId,
    id: { in: rows.flatMap(row => row.serviceId ? [row.serviceId] : []) } }, select: { id: true, name: true } }) : [];
  const names = new Map(services.map(item => [item.id, item.name]));
  const showActor = companyWide || scope === "mine";
  return rows.map(row => ({ id: row.id, createdAt: row.createdAt, action: row.action,
    resource: row.resource, resourceId: companyWide && row.resourceId && safeResourceId.test(row.resourceId) ? row.resourceId : null,
    serviceId: row.serviceId, serviceName: row.serviceId ? names.get(row.serviceId) ?? "조회할 수 없는 서비스" : null,
    actorName: showActor ? row.actor?.name ?? "처리자 정보 없음" : null }));
}

export async function listAuditEvents(ctx: Context, input: AuditEventQuery) {
  const { where, companyWide } = await auditWhere(ctx, input);
  const [rows, total] = await db.$transaction([
    db.auditEvent.findMany({ where, select: auditSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    db.auditEvent.count({ where }),
  ]);
  return { items: await safeRows(ctx, rows, companyWide, input.scope), total, page: input.page, pageSize: input.pageSize };
}

export async function exportAuditEvents(ctx: Context, input: AuditEventQuery, requestId: string) {
  const { where, companyWide } = await auditWhere(ctx, input);
  const rows = await db.auditEvent.findMany({ where, select: auditSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: maxAuditExportRows + 1 });
  if (rows.length > maxAuditExportRows)
    fail(413, "AUDIT_EXPORT_LIMIT", "내보낼 기록이 5,000건을 넘습니다. 기간이나 서비스를 좁혀주세요.");
  const safe = await safeRows(ctx, rows, companyWide, input.scope);
  const csvRows = [["이벤트 ID", "처리일시", "서비스명", "처리자명", "처리내용", "처리대상", "대상 ID"],
    ...safe.map(item => [item.id, item.createdAt.toISOString(), item.serviceName ?? "회사 공통",
      item.actorName ?? "비공개", item.action, item.resource, item.resourceId ?? ""])];
  const csv = "\uFEFF" + csvRows.map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
  await db.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id,
    serviceId: input.serviceId, requestId, action: "audit.exported", resource: "auditEvent",
    detail: { scope: input.scope, kind: input.kind, rowCount: safe.length,
      hasSearch: !!input.search, hasActorFilter: !!input.actorId,
      hasFrom: !!input.from, hasTo: !!input.to } } });
  return csv;
}
