import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { type Context } from "./context";
import { roleCan, roleCapabilities } from "./permissions";
import { fail } from "./http";
import { audit } from "./audit";
import { lockServiceActor } from "./service-actor";
import { lockManagementActor } from "./service-management";
import { assertFileDeadlines } from "./file-access";

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
export async function listAccessRequests(ctx: Context, input: { scope: "mine" | "review"; status: "all" | "pending" | "approved" | "rejected" | "cancelled"; page: number; pageSize: number }) {
  return db.$transaction(async tx => {
    const { member, deadlines } = await lockServiceActor(tx, ctx, input.scope === "review" ? "member.manage" : "service.read");
    const where = { tenantId: ctx.tenantId, ...(input.scope === "mine" ? { requesterId: member.id } : {}),
      ...(input.status === "all" ? {} : { status: input.status }) };
    const total = await tx.accessRequest.count({ where });
    const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const items = await tx.accessRequest.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * input.pageSize, take: input.pageSize });
    const pendingServiceIds = input.scope === "mine"
      ? (await tx.accessRequest.findMany({ where: { tenantId: ctx.tenantId, requesterId: member.id, status: "pending" },
        select: { serviceId: true } })).map(item => item.serviceId) : [];
    const availableServices = input.scope === "mine" && member.accessKind !== "expert" && !["owner", "admin"].includes(member.role)
      ? await tx.service.findMany({ where: { tenantId: ctx.tenantId, status: "active",
        id: { notIn: [...member.grants.map(grant => grant.serviceId), ...pendingServiceIds] } },
        select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }) : [];
    assertFileDeadlines(deadlines);
    return { items: items.map(dto), total, page, pageSize: input.pageSize, availableServices, pendingCount: pendingServiceIds.length };
  });
}
export async function createAccessRequest(ctx: Context, input: z.infer<typeof accessRequestInput>, requestId: string) {
  return db.$transaction(async tx => {
    const { member, deadlines } = await lockManagementActor(tx, ctx, "service.read");
    if (member.accessKind === "expert") fail(403, "EXPERT_SCOPE", "전문가 서비스 범위는 배정 담당자만 변경할 수 있습니다.");
    if (["owner", "admin"].includes(member.role)) fail(409, "ALREADY_GRANTED", "관리자는 모든 서비스에 접근할 수 있습니다.");
    const service = await tx.service.findFirst({ where: { id: input.serviceId, tenantId: ctx.tenantId, status: "active" } });
    if (!service) fail(404, "SERVICE_NOT_FOUND", "요청할 서비스를 찾을 수 없습니다.");
    if (await tx.serviceGrant.findFirst({ where: { tenantId: ctx.tenantId, memberId: member.id, serviceId: service.id } }))
      fail(409, "ALREADY_GRANTED", "이미 부여된 서비스 권한입니다.");
    const pending = await tx.accessRequest.findFirst({ where: { tenantId: ctx.tenantId, requesterId: member.id, serviceId: service.id, status: "pending" }, include });
    if (pending) { assertFileDeadlines(deadlines); return { status: 200, body: dto(pending) }; }
    const created = await tx.accessRequest.create({ data: { tenantId: ctx.tenantId, requesterId: member.id,
      serviceId: service.id, reason: input.reason }, include });
    await audit(tx, ctx, requestId, "access_request.created", "access_request", created.id, ["serviceId", "reason"], service.id);
    assertFileDeadlines(deadlines);
    return { status: 201, body: dto(created) };
  });
}
export async function decideAccessRequest(ctx: Context, id: string, input: z.infer<typeof accessDecisionInput>, requestId: string) {
  return db.$transaction(async tx => {
    const { member: reviewer, deadlines } = await lockManagementActor(tx, ctx, "member.manage");
    const found = await tx.accessRequest.findFirst({ where: { id, tenantId: ctx.tenantId }, include });
    if (!found) fail(404, "NOT_FOUND", "권한 요청을 찾을 수 없습니다.");
    if (found.version !== input.version || found.status !== "pending") fail(409, "VERSION_CONFLICT", "요청 상태가 변경되었습니다. 새로고침해주세요.");
    if (found.requesterId === reviewer.id) fail(403, "SELF_APPROVAL", "자신의 권한 요청은 승인할 수 없습니다.");
    if (input.decision === "approve") {
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${found.requesterId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
      const initial = await tx.membership.findUniqueOrThrow({ where: { id: found.requesterId } });
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR SHARE`;
      const requester = await tx.membership.findFirst({ where: { id: found.requesterId, tenantId: ctx.tenantId, status: "active",
        user: { status: "active", emailVerified: true } } });
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
    assertFileDeadlines(deadlines);
    return dto(changed);
  });
}
export async function cancelAccessRequest(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const { member, deadlines } = await lockManagementActor(tx, ctx, "service.read");
    const found = await tx.accessRequest.findFirst({ where: { id, tenantId: ctx.tenantId, requesterId: member.id } });
    if (!found) fail(404, "NOT_FOUND", "권한 요청을 찾을 수 없습니다.");
    if (found.status !== "pending" || found.version !== version) fail(409, "VERSION_CONFLICT", "요청 상태가 변경되었습니다. 새로고침해주세요.");
    await tx.accessRequest.update({ where: { id }, data: { status: "cancelled", version: { increment: 1 }, resolvedAt: new Date() } });
    await audit(tx, ctx, requestId, "access_request.cancelled", "access_request", id, ["status"], found.serviceId);
    assertFileDeadlines(deadlines);
  });
}
