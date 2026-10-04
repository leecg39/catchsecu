import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import { type requireActor } from "./context";
import { roleCapabilities } from "./permissions";
import { fail } from "./http";
import { audit } from "./audit";
import { assertQuota } from "./entitlements";
import { lockAccountActor } from "./account-actor";
import { assertFileDeadlines } from "./file-access";

type Actor = Awaited<ReturnType<typeof requireActor>>;
const serviceIds = z.array(z.uuid()).min(1).max(100).refine(values => new Set(values).size === values.length, "서비스가 중복되었습니다.");
const expiresAt = z.iso.datetime({ offset: true });
export const createExpertInput = z.object({ companyId: z.uuid(), expertEmail: z.email().trim().toLowerCase(), serviceIds, expiresAt }).strict();
export const updateExpertInput = z.object({ version: z.number().int().positive(), serviceIds: serviceIds.optional(), expiresAt: expiresAt.optional() })
  .strict().refine(input => !!input.serviceIds || !!input.expiresAt, "변경할 배정 범위나 만료일이 필요합니다.");
const include = { tenant: { select: { name: true, status: true } }, expertUser: { select: { name: true, email: true, status: true } },
  services: { include: { service: { select: { name: true, status: true } } } },
  membership: { select: { id: true, status: true } } } as const;
type Row = Prisma.ExpertAssignmentGetPayload<{ include: typeof include }>;
function dto(row: Row) {
  const activeServices = row.services.filter(item => item.service.status === "active");
  const effectiveStatus = row.status === "revoked" ? "revoked" : row.expiresAt <= new Date() ? "expired"
    : row.membership?.status === "active" && row.expertUser.status === "active" && row.tenant.status === "active" ? "active" : "unavailable";
  return { id: row.id, companyId: row.tenantId, companyName: row.tenant.name, expertUserId: row.expertUserId,
    expertName: row.expertUser.name, expertEmail: row.expertUser.email, status: effectiveStatus, version: row.version,
    expiresAt: row.expiresAt, createdAt: row.createdAt, revokedAt: row.revokedAt,
    services: row.services.map(item => ({ id: item.serviceId, name: item.service.name, status: item.service.status })),
    canSelect: effectiveStatus === "active" && activeServices.length > 0 };
}
function checkedExpiry(value: string) {
  const date = new Date(value), difference = date.getTime() - Date.now();
  if (difference < 60000 || difference > 366 * 86400000)
    fail(422, "INVALID_EXPIRY", "만료일은 현재부터 1분~1년 사이로 지정해주세요.");
  return date;
}
async function admin(tx: Transaction, actor: Actor) {
  const current = await lockAccountActor(tx, actor);
  if (!current.user.platformAdmin)
    fail(403, "PLATFORM_ADMIN_REQUIRED", "전문가 배정 관리 권한이 없습니다.");
  return current;
}
async function companyLock(tx: Transaction, companyId: string) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
  const company = await tx.company.findUnique({ where: { id: companyId } });
  if (!company || company.status !== "active") fail(404, "COMPANY_NOT_FOUND", "활성 회사를 찾을 수 없습니다.");
}
async function validateServices(tx: Transaction, companyId: string, ids: string[]) {
  if (await tx.service.count({ where: { id: { in: ids }, tenantId: companyId, status: "active" } }) !== ids.length)
    fail(404, "SERVICE_NOT_FOUND", "해당 회사의 활성 서비스만 배정할 수 있습니다.");
}
async function replaceScope(tx: Transaction, row: { id: string; tenantId: string }, memberId: string, ids: string[]) {
  await tx.expertAssignmentService.deleteMany({ where: { assignmentId: row.id, tenantId: row.tenantId } });
  await tx.serviceGrant.deleteMany({ where: { memberId, tenantId: row.tenantId } });
  await tx.expertAssignmentService.createMany({ data: ids.map(serviceId => ({ tenantId: row.tenantId, assignmentId: row.id, serviceId })) });
  await tx.serviceGrant.createMany({ data: ids.map(serviceId => ({ tenantId: row.tenantId, memberId, serviceId,
    capabilities: [...roleCapabilities("viewer")] })) });
}
export async function listExpertAssignments(actor: Actor, input: { scope: "mine" | "admin"; page: number; pageSize: number; search: string }) {
  return db.$transaction(async tx => {
    const current = input.scope === "admin" ? await admin(tx, actor) : await lockAccountActor(tx, actor);
    const where: Prisma.ExpertAssignmentWhereInput = input.scope === "mine" ? { expertUserId: current.user.id,
      tenant: { name: { contains: input.search, mode: "insensitive" } } }
      : { OR: [{ tenant: { name: { contains: input.search, mode: "insensitive" } } },
        { expertUser: { email: { contains: input.search, mode: "insensitive" } } }] };
    const total = await tx.expertAssignment.count({ where });
    const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const items = await tx.expertAssignment.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * input.pageSize, take: input.pageSize });
    assertFileDeadlines(current.deadlines);
    return { items: items.map(dto), total, page, pageSize: input.pageSize };
  });
}
export async function getExpertAssignment(actor: Actor, id: string) {
  return db.$transaction(async tx => {
    const current = await lockAccountActor(tx, actor);
    const row = await tx.expertAssignment.findUnique({ where: { id }, include });
    if (!row || (!current.user.platformAdmin && row.expertUserId !== current.user.id))
      fail(404, "NOT_FOUND", "전문가 배정을 찾을 수 없습니다.");
    assertFileDeadlines(current.deadlines);
    return dto(row);
  });
}
export async function expertOptions(actor: Actor, input: { companyId?: string; search: string }) {
  return db.$transaction(async tx => {
    const current = await admin(tx, actor);
    const companies = await tx.company.findMany({ where: { status: "active", name: { contains: input.search, mode: "insensitive" } },
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 100 });
    const services = input.companyId ? await tx.service.findMany({ where: { tenantId: input.companyId, status: "active", tenant: { status: "active" } },
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 100 }) : [];
    assertFileDeadlines(current.deadlines);
    return { companies, services };
  });
}
export async function createExpertAssignment(actor: Actor, input: z.infer<typeof createExpertInput>, requestId: string) {
  const expiry = checkedExpiry(input.expiresAt);
  return db.$transaction(async tx => {
    await companyLock(tx, input.companyId);
    const current = await admin(tx, actor);
    await validateServices(tx, input.companyId, input.serviceIds);
    const user = await tx.user.findUnique({ where: { email: input.expertEmail } });
    if (!user || user.status !== "active" || !user.emailVerified || user.platformAdmin || user.id === actor.user.id)
      fail(404, "EXPERT_NOT_FOUND", "활성·이메일 인증된 전문가 계정을 찾을 수 없습니다.");
    const existingMember = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: input.companyId, userId: user.id } } });
    if (existingMember?.accessKind === "direct") fail(409, "MEMBERSHIP_EXISTS", "이미 일반 구성원인 계정입니다. 구성원 권한을 사용해주세요.");
    const existing = await tx.expertAssignment.findUnique({ where: { tenantId_expertUserId: { tenantId: input.companyId, expertUserId: user.id } } });
    if (existing && existing.status === "active" && existing.expiresAt > new Date() && existingMember?.status === "active")
      fail(409, "ASSIGNMENT_EXISTS", "이미 활성 전문가 배정이 있습니다. 기존 배정을 수정해주세요.");
    if (existing && (!existingMember || existingMember.expertAssignmentId !== existing.id))
      fail(409, "ASSIGNMENT_INCONSISTENT", "전문가 구성원 연결을 확인해주세요.");
    if (!existingMember || existingMember.status !== "active") await assertQuota(tx, input.companyId, "members", true);
    const assignment = existing
      ? await tx.expertAssignment.update({ where: { id: existing.id }, data: { status: "active", revokedAt: null,
        expiresAt: expiry, assignedById: actor.user.id, version: { increment: 1 } } })
      : await tx.expertAssignment.create({ data: { tenantId: input.companyId, expertUserId: user.id,
        assignedById: actor.user.id, expiresAt: expiry } });
    const member = existingMember
      ? await tx.membership.update({ where: { id: existingMember.id }, data: { status: "active", role: "viewer",
        version: { increment: 1 } } })
      : await tx.membership.create({ data: { tenantId: input.companyId, userId: user.id, role: "viewer",
        accessKind: "expert", expertAssignmentId: assignment.id } });
    await replaceScope(tx, assignment, member.id, input.serviceIds);
    await audit(tx, { tenantId: input.companyId, user: actor.user }, requestId,
      existing ? "expert.reassigned" : "expert.assigned", "expert_assignment", assignment.id, ["expertUserId", "expiresAt", "services"]);
    const result = dto(await tx.expertAssignment.findUniqueOrThrow({ where: { id: assignment.id }, include }));
    assertFileDeadlines(current.deadlines);
    return { status: existing ? 200 : 201, body: result };
  }, { timeout: 15000 });
}
export async function updateExpertAssignment(actor: Actor, id: string, input: z.infer<typeof updateExpertInput>, requestId: string) {
  const expiry = input.expiresAt ? checkedExpiry(input.expiresAt) : undefined;
  const initial = await db.expertAssignment.findUnique({ where: { id }, select: { tenantId: true } });
  if (!initial) fail(404, "NOT_FOUND", "전문가 배정을 찾을 수 없습니다.");
  return db.$transaction(async tx => {
    await companyLock(tx, initial.tenantId);
    const current = await admin(tx, actor);
    const row = await tx.expertAssignment.findUnique({ where: { id }, include: { membership: true, services: true } });
    if (!row || row.status !== "active" || row.expiresAt <= new Date() || row.version !== input.version || !row.membership || row.membership.status !== "active")
      fail(409, "VERSION_CONFLICT", "배정 상태가 변경되었습니다. 다시 불러와주세요.");
    if (input.serviceIds) await validateServices(tx, row.tenantId, input.serviceIds);
    const saved = await tx.expertAssignment.update({ where: { id }, data: { expiresAt: expiry, version: { increment: 1 } } });
    if (input.serviceIds) {
      await replaceScope(tx, saved, row.membership.id, input.serviceIds);
      await tx.membership.update({ where: { id: row.membership.id }, data: { version: { increment: 1 } } });
    }
    await audit(tx, { tenantId: row.tenantId, user: actor.user }, requestId, "expert.updated", "expert_assignment", id,
      Object.keys(input).filter(key => key !== "version"));
    const result = dto(await tx.expertAssignment.findUniqueOrThrow({ where: { id }, include }));
    assertFileDeadlines(current.deadlines);
    return result;
  }, { timeout: 15000 });
}
export async function revokeExpertAssignment(actor: Actor, id: string, version: number, requestId: string) {
  const initial = await db.expertAssignment.findUnique({ where: { id }, select: { tenantId: true } });
  if (!initial) fail(404, "NOT_FOUND", "전문가 배정을 찾을 수 없습니다.");
  return db.$transaction(async tx => {
    await companyLock(tx, initial.tenantId);
    const current = await admin(tx, actor);
    const row = await tx.expertAssignment.findUnique({ where: { id }, include: { membership: true } });
    if (!row || row.status !== "active" || row.version !== version || !row.membership)
      fail(409, "VERSION_CONFLICT", "배정 상태가 변경되었습니다. 다시 불러와주세요.");
    await tx.expertAssignment.update({ where: { id }, data: { status: "revoked", revokedAt: new Date(), version: { increment: 1 } } });
    await tx.membership.update({ where: { id: row.membership.id }, data: { status: "revoked", version: { increment: 1 } } });
    await tx.serviceGrant.deleteMany({ where: { tenantId: row.tenantId, memberId: row.membership.id } });
    await tx.session.updateMany({ where: { userId: row.expertUserId, activeCompanyId: row.tenantId },
      data: { activeCompanyId: null, activeServiceId: null } });
    await audit(tx, { tenantId: row.tenantId, user: actor.user }, requestId, "expert.revoked", "expert_assignment", id, ["status"]);
    assertFileDeadlines(current.deadlines);
  }, { timeout: 15000 });
}
export async function expireExpertAssignments(now = new Date()) {
  const expired = await db.expertAssignment.findMany({ where: { status: "active", expiresAt: { lte: now },
    membership: { is: { status: "active", accessKind: "expert" } } },
    select: { id: true, tenantId: true }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: 100 });
  let changed = 0;
  for (const item of expired) {
    changed += await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${item.tenantId} FOR UPDATE`;
      const row = await tx.expertAssignment.findFirst({ where: { id: item.id, tenantId: item.tenantId,
        status: "active", expiresAt: { lte: now } }, include: { membership: true } });
      if (!row?.membership || row.membership.status !== "active" || row.membership.accessKind !== "expert") return 0;
      await tx.membership.update({ where: { id: row.membership.id }, data: { status: "revoked", version: { increment: 1 } } });
      await tx.serviceGrant.deleteMany({ where: { tenantId: row.tenantId, memberId: row.membership.id } });
      await tx.session.updateMany({ where: { userId: row.expertUserId, activeCompanyId: row.tenantId },
        data: { activeCompanyId: null, activeServiceId: null } });
      await tx.auditEvent.create({ data: { tenantId: row.tenantId, action: "expert.expired", resource: "expert_assignment",
        resourceId: row.id, requestId: randomUUID(), detail: { changedFields: ["membership.status", "grants"] } } });
      return 1;
    });
  }
  return changed;
}
