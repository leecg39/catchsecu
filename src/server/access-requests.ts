import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import { type Context } from "./context";
import { roleCan, roleCapabilities } from "./permissions";
import { fail } from "./http";
import { audit } from "./audit";

export const accessRequestInput = z.object({ serviceId: z.uuid(), reason: z.string().trim().max(500).default("") }).strict();
export const accessDecisionInput = z.object({ version: z.number().int().positive(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).default("") }).strict();
const include = { requester: { select: { user: { select: { name: true, email: true } }, role: true, status: true } },
  service: { select: { name: true, status: true } }, reviewer: { select: { user: { select: { name: true } } } } } as const;
type Row = Prisma.AccessRequestGetPayload<{ include: typeof include }>;
function dto(row: Row) {
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service.name, serviceStatus: row.service.status,
    requesterId: row.requesterId, requesterName: row.requester.user.name, requesterEmail: row.requester.user.email,
    requesterRole: row.requester.role, requesterStatus: row.requester.status, reason: row.reason,
    status: row.status, version: row.version, decisionNote: row.decisionNote,
    reviewerName: row.reviewer?.user.name ?? null, createdAt: row.createdAt, resolvedAt: row.resolvedAt };
}
async function lockCompany(tx: Transaction, tenantId: string) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${tenantId} FOR UPDATE`;
}
async function activeMember(tx: Transaction, ctx: Context) {
  const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId,
    status: "active", tenant: { status: "active" } } });
  if (!member) fail(403, "MEMBERSHIP_UNAVAILABLE", "회사 구성원 상태를 확인해주세요.");
  return member;
}
export async function listAccessRequests(ctx: Context, input: { scope: "mine" | "review"; status: "all" | "pending" | "approved" | "rejected" | "cancelled"; page: number; pageSize: number }) {
  if (input.scope === "review" && !roleCan(ctx.member.role, "member.manage")) fail(403, "FORBIDDEN", "요청 검토 권한이 없습니다.");
  const where = { tenantId: ctx.tenantId, ...(input.scope === "mine" ? { requesterId: ctx.member.id } : {}),
    ...(input.status === "all" ? {} : { status: input.status }) };
  const [items, total] = await db.$transaction([
    db.accessRequest.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    db.accessRequest.count({ where }),
  ]);
  const pendingServiceIds = input.scope === "mine"
    ? (await db.accessRequest.findMany({ where: { tenantId: ctx.tenantId, requesterId: ctx.member.id, status: "pending" },
      select: { serviceId: true } })).map(item => item.serviceId) : [];
  const availableServices = input.scope === "mine" && ctx.member.accessKind !== "expert" && !["owner", "admin"].includes(ctx.member.role)
    ? await db.service.findMany({ where: { tenantId: ctx.tenantId, status: "active",
      id: { notIn: [...ctx.member.grants.map(grant => grant.serviceId), ...pendingServiceIds] } },
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] })
    : [];
  return { items: items.map(dto), total, page: input.page, pageSize: input.pageSize, availableServices, pendingCount: pendingServiceIds.length };
}
export async function createAccessRequest(ctx: Context, input: z.infer<typeof accessRequestInput>, requestId: string) {
  return db.$transaction(async tx => {
    await lockCompany(tx, ctx.tenantId);
    const member = await activeMember(tx, ctx);
    if (member.accessKind === "expert") fail(403, "EXPERT_SCOPE", "전문가 서비스 범위는 배정 담당자만 변경할 수 있습니다.");
    if (["owner", "admin"].includes(member.role)) fail(409, "ALREADY_GRANTED", "관리자는 모든 서비스에 접근할 수 있습니다.");
    const service = await tx.service.findFirst({ where: { id: input.serviceId, tenantId: ctx.tenantId, status: "active" } });
    if (!service) fail(404, "SERVICE_NOT_FOUND", "요청할 서비스를 찾을 수 없습니다.");
    if (await tx.serviceGrant.findFirst({ where: { tenantId: ctx.tenantId, memberId: member.id, serviceId: service.id } }))
      fail(409, "ALREADY_GRANTED", "이미 부여된 서비스 권한입니다.");
    const pending = await tx.accessRequest.findFirst({ where: { tenantId: ctx.tenantId, requesterId: member.id, serviceId: service.id, status: "pending" }, include });
    if (pending) return { status: 200, body: dto(pending) };
    const created = await tx.accessRequest.create({ data: { tenantId: ctx.tenantId, requesterId: member.id,
      serviceId: service.id, reason: input.reason }, include });
    await audit(tx, ctx, requestId, "access_request.created", "access_request", created.id, ["serviceId", "reason"], service.id);
    return { status: 201, body: dto(created) };
  });
}
export async function decideAccessRequest(ctx: Context, id: string, input: z.infer<typeof accessDecisionInput>, requestId: string) {
  return db.$transaction(async tx => {
    await lockCompany(tx, ctx.tenantId);
    const reviewer = await activeMember(tx, ctx);
    if (!roleCan(reviewer.role, "member.manage")) fail(403, "FORBIDDEN", "요청 검토 권한이 없습니다.");
    const found = await tx.accessRequest.findFirst({ where: { id, tenantId: ctx.tenantId }, include });
    if (!found) fail(404, "NOT_FOUND", "권한 요청을 찾을 수 없습니다.");
    if (found.version !== input.version || found.status !== "pending") fail(409, "VERSION_CONFLICT", "요청 상태가 변경되었습니다. 새로고침해주세요.");
    if (found.requesterId === reviewer.id) fail(403, "SELF_APPROVAL", "자신의 권한 요청은 승인할 수 없습니다.");
    if (input.decision === "approve") {
      const requester = await tx.membership.findFirst({ where: { id: found.requesterId, tenantId: ctx.tenantId, status: "active" } });
      if (!requester) fail(409, "REQUESTER_UNAVAILABLE", "요청한 구성원이 더 이상 활성 상태가 아닙니다.");
      if (requester.accessKind === "expert") fail(409, "EXPERT_MANAGED", "전문가 권한은 배정 담당자만 변경할 수 있습니다.");
      if (found.service.status !== "active") fail(409, "SERVICE_UNAVAILABLE", "서비스가 더 이상 활성 상태가 아닙니다.");
      if (reviewer.role !== "owner" && !roleCapabilities(requester.role).every(capability => roleCan(reviewer.role, capability)))
        fail(403, "ROLE_ESCALATION", "현재 권한으로 이 구성원의 권한을 변경할 수 없습니다.");
      if (!["owner", "admin"].includes(requester.role) && !(await tx.serviceGrant.findFirst({ where: { tenantId: ctx.tenantId, memberId: requester.id, serviceId: found.serviceId } }))) {
        await tx.serviceGrant.create({ data: { tenantId: ctx.tenantId, memberId: requester.id, serviceId: found.serviceId,
          capabilities: [...roleCapabilities(requester.role)] } });
        await tx.membership.update({ where: { id: requester.id }, data: { version: { increment: 1 } } });
      }
    }
    const changed = await tx.accessRequest.update({ where: { id }, data: { status: input.decision === "approve" ? "approved" : "rejected",
      version: { increment: 1 }, reviewerId: reviewer.id, decisionNote: input.note, resolvedAt: new Date() }, include });
    await audit(tx, ctx, requestId, "access_request." + changed.status, "access_request", id, ["status", "decisionNote"], changed.serviceId);
    return dto(changed);
  });
}
export async function cancelAccessRequest(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    await lockCompany(tx, ctx.tenantId);
    const member = await activeMember(tx, ctx);
    const found = await tx.accessRequest.findFirst({ where: { id, tenantId: ctx.tenantId, requesterId: member.id } });
    if (!found) fail(404, "NOT_FOUND", "권한 요청을 찾을 수 없습니다.");
    if (found.status !== "pending" || found.version !== version) fail(409, "VERSION_CONFLICT", "요청 상태가 변경되었습니다. 새로고침해주세요.");
    await tx.accessRequest.update({ where: { id }, data: { status: "cancelled", version: { increment: 1 }, resolvedAt: new Date() } });
    await audit(tx, ctx, requestId, "access_request.cancelled", "access_request", id, ["status"], found.serviceId);
  });
}
