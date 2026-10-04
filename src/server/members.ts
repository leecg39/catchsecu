import { z } from "zod";
import { db, type Transaction } from "./db";
import { type Context } from "./context";
import { Role } from "@/generated/prisma/client";
import { roleCan, roleCapabilities } from "./permissions";
import { fail } from "./http";
import { audit } from "./audit";
import { enqueueMail } from "./jobs";
import { tokenHash, opaqueToken } from "./crypto";
import { env } from "./env";
import { assertQuota } from "./entitlements";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { idempotent } from "./idempotency";
import { lockAccountActor } from "./account-actor";

export const assignableRole = z.enum(["admin", "editor", "viewer", "privacy", "sender", "billing", "security", "auditor"]);
const servicesInput = z.array(z.uuid()).max(100).refine(value => new Set(value).size === value.length, "서비스가 중복되었습니다.");
export const inviteInput = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), role: assignableRole, serviceIds: servicesInput.min(1) }).strict();
export const memberInput = z.object({ version: z.number().int().positive(), role: assignableRole.optional(), serviceIds: servicesInput.optional(), status: z.enum(["active", "suspended"]).optional() })
  .strict().refine(input => input.role !== undefined || input.serviceIds !== undefined || input.status !== undefined, "변경할 역할·서비스 범위·상태가 필요합니다.");
const memberInclude = { user: { select: { id: true, name: true, email: true, department: true } }, grants: { include: { service: { select: { name: true, status: true } } } } };
function memberDto(row: Awaited<ReturnType<typeof findMember>>) {
  return { id: row.id, version: row.version, role: row.role, status: row.status, accessKind: row.accessKind,
    createdAt: row.createdAt, user: row.user,
    grants: row.grants.map(grant => ({ serviceId: grant.serviceId, serviceName: grant.service.name, serviceStatus: grant.service.status, capabilities: grant.capabilities })) };
}
async function findMember(tenantId: string, id: string, tx: Transaction = db) {
  const row = await tx.membership.findFirst({ where: { id, tenantId }, include: memberInclude });
  if (!row) fail(404, "NOT_FOUND", "구성원을 찾을 수 없습니다.");
  return row;
}
async function manager(tx: Transaction, ctx: Context, write = true) {
  if (write) await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${ctx.tenantId} FOR UPDATE`;
  const actor = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, userId: ctx.user.id, status: "active",
    tenant: { status: "active" }, user: { status: "active", emailVerified: true } } });
  if (!actor || !roleCan(actor.role, "member.manage")) fail(403, "FORBIDDEN", "구성원 관리 권한이 없습니다.");
  return lockServiceActor(tx, ctx, "member.manage");
}
function mayAssign(actorRole: Role, targetRole: Role) {
  if (targetRole === "owner" || (actorRole !== "owner" && !roleCapabilities(targetRole).every(capability => roleCan(actorRole, capability))))
    fail(403, "ROLE_ESCALATION", "현재 권한으로 이 역할을 부여하거나 변경할 수 없습니다.");
}
async function validateServices(tx: Transaction, tenantId: string, serviceIds: string[], preservedArchivedIds: string[] = []) {
  const count = await tx.service.count({ where: { id: { in: serviceIds }, tenantId,
    OR: [{ status: "active" }, { status: "archived", id: { in: preservedArchivedIds } }] } });
  if (count !== serviceIds.length) fail(404, "SERVICE_NOT_FOUND", "선택한 서비스를 찾을 수 없습니다.");
}
async function replaceGrants(tx: Transaction, tenantId: string, memberId: string, serviceIds: string[], role: Role) {
  await tx.serviceGrant.deleteMany({ where: { tenantId, memberId } });
  if (serviceIds.length) await tx.serviceGrant.createMany({ data: serviceIds.map(serviceId => ({
    tenantId, memberId, serviceId, capabilities: [...roleCapabilities(role)],
  })) });
}
export async function listMembers(ctx: Context, query: { page: number; pageSize: number; search: string; status?: string }) {
  const where = { tenantId: ctx.tenantId, status: query.status === "all" ? undefined : query.status ?? "active",
    user: { OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { email: { contains: query.search, mode: "insensitive" as const } }] } };
  return db.$transaction(async tx => {
    const actor = await manager(tx, ctx, false);
    const total = await tx.membership.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const items = await tx.membership.findMany({ where, include: memberInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    assertFileDeadlines(actor.deadlines);
    return { items: items.map(memberDto), total, page, pageSize: query.pageSize };
  });
}
export async function getMember(ctx: Context, id: string) {
  return db.$transaction(async tx => {
    const actor = await manager(tx, ctx, false);
    const result = memberDto(await findMember(ctx.tenantId, id, tx));
    assertFileDeadlines(actor.deadlines);
    return result;
  });
}
export async function updateMember(ctx: Context, id: string, input: z.infer<typeof memberInput>, requestId: string) {
  return db.$transaction(async tx => {
    const { member: actor, deadlines } = await manager(tx, ctx), member = await findMember(ctx.tenantId, id, tx);
    if (member.accessKind === "expert") fail(409, "EXPERT_MANAGED", "전문가 배정은 운영자 배정 화면에서 변경해주세요.");
    if (member.id === actor.id) fail(409, "SELF_PERMISSION_CHANGE", "자신의 권한은 이 화면에서 변경할 수 없습니다.");
    mayAssign(actor.role, member.role);
    if (member.status === "revoked") fail(409, "MEMBER_REMOVED", "제외된 구성원은 다시 초대해주세요.");
    const role = input.role ?? member.role;
    mayAssign(actor.role, role);
    const serviceIds = input.serviceIds ?? member.grants.map(grant => grant.serviceId);
    if (input.serviceIds) await validateServices(tx, ctx.tenantId, serviceIds, member.grants.map(grant => grant.serviceId));
    if (input.status === "active" && member.status !== "active") await assertQuota(tx, ctx.tenantId, "members", true);
    const changed = await tx.membership.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version },
      data: { role, status: input.status, version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "구성원 정보가 변경되었습니다. 다시 불러와주세요.");
    if (input.serviceIds || input.role) await replaceGrants(tx, ctx.tenantId, id, serviceIds, role);
    if ((input.serviceIds || input.role) && !["owner", "admin"].includes(role))
      await tx.session.updateMany({ where: { userId: member.userId, activeCompanyId: ctx.tenantId, activeServiceId: { notIn: serviceIds } },
        data: { activeServiceId: null } });
    if (input.status === "suspended") await tx.session.deleteMany({ where: { userId: member.userId, OR: [{ activeCompanyId: ctx.tenantId }, { activeCompanyId: null }] } });
    await audit(tx, ctx, requestId, "member.updated", "membership", id, Object.keys(input).filter(key => key !== "version"));
    const result = memberDto(await findMember(ctx.tenantId, id, tx));
    assertFileDeadlines(deadlines);
    return result;
  });
}
export async function removeMember(ctx: Context, id: string, version: number, requestId: string) {
  await db.$transaction(async tx => {
    const { member: actor, deadlines } = await manager(tx, ctx), member = await findMember(ctx.tenantId, id, tx);
    if (member.accessKind === "expert") fail(409, "EXPERT_MANAGED", "전문가 배정은 운영자 배정 화면에서 회수해주세요.");
    if (member.id === actor.id) fail(409, "SELF_PERMISSION_CHANGE", "자신을 제외할 수 없습니다.");
    mayAssign(actor.role, member.role);
    const changed = await tx.membership.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: { not: "revoked" } },
      data: { status: "revoked", version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "구성원 정보가 변경되었거나 이미 제외되었습니다.");
    await tx.serviceGrant.deleteMany({ where: { tenantId: ctx.tenantId, memberId: id } });
    await tx.session.deleteMany({ where: { userId: member.userId, OR: [{ activeCompanyId: ctx.tenantId }, { activeCompanyId: null }] } });
    await audit(tx, ctx, requestId, "member.removed", "membership", id, ["status", "grants"]);
    assertFileDeadlines(deadlines);
  });
}
export async function transferOwnership(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const { member: actor, deadlines } = await manager(tx, ctx);
    if (actor.role !== "owner") fail(403, "OWNER_REQUIRED", "회사 소유자만 소유권을 이전할 수 있습니다.");
    const target = await findMember(ctx.tenantId, id, tx);
    if (target.accessKind === "expert") fail(409, "EXPERT_MANAGED", "전문가에게 회사 소유권을 이전할 수 없습니다.");
    if (target.id === actor.id || target.status !== "active") fail(409, "INVALID_OWNER_TARGET", "다른 활성 구성원을 선택해주세요.");
    if (target.version !== version || target.role === "owner") fail(409, "VERSION_CONFLICT", "소유권 또는 구성원 정보가 변경되었습니다.");
    await tx.membership.update({ where: { id }, data: { role: "owner", version: { increment: 1 } } });
    await tx.membership.update({ where: { id: actor.id }, data: { role: "admin", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "company.ownership_transferred", "membership", id, ["role"]);
    const result = memberDto(await findMember(ctx.tenantId, id, tx));
    assertFileDeadlines(deadlines);
    return result;
  });
}

type Actor = Awaited<ReturnType<typeof import("./context").requireActor>>;
const invitationSelect = { id: true, tenantId: true, email: true, role: true, serviceIds: true, expiresAt: true, status: true, version: true, createdAt: true } as const;
function invitationDto(row: { id: string; email: string; role: Role; serviceIds: string[]; expiresAt: Date; status: string; version: number; createdAt: Date }) {
  return { id: row.id, email: row.email, role: row.role, serviceIds: row.serviceIds, expiresAt: row.expiresAt,
    status: row.status === "pending" && row.expiresAt <= new Date() ? "expired" : row.status, version: row.version, createdAt: row.createdAt };
}
export async function listInvitations(ctx: Context, query: { page: number; pageSize: number; search: string; status?: string }) {
  const now = new Date();
  const where = { tenantId: ctx.tenantId, email: { contains: query.search, mode: "insensitive" as const },
    ...(query.status === "expired" ? { OR: [{ status: "expired" }, { status: "pending", expiresAt: { lte: now } }] }
      : query.status && query.status !== "all" ? { status: query.status, ...(query.status === "pending" ? { expiresAt: { gt: now } } : {}) } : {}) };
  return db.$transaction(async tx => {
    const actor = await manager(tx, ctx, false);
    const total = await tx.invitation.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const items = await tx.invitation.findMany({ where, select: invitationSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    assertFileDeadlines(actor.deadlines);
    return { items: items.map(invitationDto), total, page, pageSize: query.pageSize };
  });
}
async function invitationMail(tx: Transaction, invitation: { id: string; tenantId: string; email: string; version: number }, token: string) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: invitation.tenantId }, select: { name: true } });
  const link = new URL("/oauth2/invite/signup", env.BETTER_AUTH_URL); link.searchParams.set("token", token);
  await enqueueMail({ to: invitation.email, subject: company.name.slice(0, 160) + " 구성원 초대",
    text: company.name + "에 초대되었습니다. 이 이메일 주소로 가입·로그인한 후 아래 링크에서 수락해주세요.\n\n" + link.href + "\n\n초대 링크는 7일간 유효합니다." },
    "invitation:" + invitation.id + ":" + invitation.version, tx, invitation.tenantId);
}
export async function createInvitation(ctx: Context, input: z.infer<typeof inviteInput>, requestId: string, tx: Transaction) {
  const { member: actor, deadlines } = await manager(tx, ctx);
  mayAssign(actor.role, input.role);
  await validateServices(tx, ctx.tenantId, input.serviceIds);
  if (await tx.membership.findFirst({ where: { tenantId: ctx.tenantId, status: { in: ["active", "suspended"] }, user: { email: input.email } } }))
    fail(409, "MEMBER_EXISTS", "이미 회사에 소속된 계정입니다.");
  await tx.invitation.updateMany({ where: { tenantId: ctx.tenantId, email: input.email, status: "pending", expiresAt: { lte: new Date() } },
    data: { status: "expired", version: { increment: 1 } } });
  await assertQuota(tx, ctx.tenantId, "members", true);
  const token = opaqueToken();
  const invitation = await tx.invitation.create({ data: { tenantId: ctx.tenantId, ...input, invitedBy: actor.id,
    tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 7 * 86400000) } });
  await invitationMail(tx, invitation, token);
  await audit(tx, ctx, requestId, "invitation.created", "invitation", invitation.id, ["email", "role", "serviceIds"]);
  assertFileDeadlines(deadlines);
  return invitationDto(invitation);
}
export async function createInvitationRequest(ctx: Context, input: z.infer<typeof inviteInput>, key: string | null, requestId: string) {
  let current: Awaited<ReturnType<typeof manager>> | undefined;
  return idempotent("invitation:create:" + ctx.member.id, key, input, async tx => {
    current = await manager(tx, ctx);
    return { status: 201, body: await createInvitation(ctx, input, requestId, tx) };
  }, async tx => {
    current = await manager(tx, ctx);
    mayAssign(current.member.role, input.role);
    await validateServices(tx, ctx.tenantId, input.serviceIds);
  }, async (tx, cached) => {
    const row = await tx.invitation.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId } });
    if (!row || row.status !== "pending" || row.expiresAt <= new Date())
      fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었거나 이미 처리되었습니다. 최신 초대 이력을 확인해주세요.");
    return invitationDto(row);
  }, async () => { if (current) assertFileDeadlines(current.deadlines); });
}
export async function changeInvitation(ctx: Context, id: string, version: number, action: "resend" | "revoke", requestId: string) {
  return db.$transaction(async tx => {
    const { member: actor, deadlines } = await manager(tx, ctx);
    const invitation = await tx.invitation.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!invitation) fail(404, "NOT_FOUND", "초대를 찾을 수 없습니다.");
    mayAssign(actor.role, invitation.role);
    if (!["pending", "expired"].includes(invitation.status)) fail(409, "INVITATION_CLOSED", "이미 수락되었거나 취소된 초대입니다.");
    if (invitation.version !== version) fail(409, "VERSION_CONFLICT", "초대 정보가 변경되었습니다. 다시 불러와주세요.");
    if (action === "resend") {
      await validateServices(tx, ctx.tenantId, invitation.serviceIds);
      if (await tx.membership.findFirst({ where: { tenantId: ctx.tenantId, status: { in: ["active", "suspended"] }, user: { email: invitation.email } } }))
        fail(409, "MEMBER_EXISTS", "이미 회사에 소속된 계정입니다.");
      await assertQuota(tx, ctx.tenantId, "members", true, invitation.id);
    }
    const token = opaqueToken();
    const updated = await tx.invitation.update({ where: { id }, data: { version: { increment: 1 },
      ...(action === "revoke" ? { status: "revoked" } : { status: "pending", invitedBy: actor.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 7 * 86400000) }) } });
    await tx.job.updateMany({ where: { dedupeKey: "mail:invitation:" + id + ":" + version, status: { in: ["queued", "retry"] } }, data: { status: "cancelled" } });
    if (action === "resend") await invitationMail(tx, updated, token);
    await audit(tx, ctx, requestId, "invitation." + (action === "resend" ? "resent" : "revoked"), "invitation", id, ["status"]);
    assertFileDeadlines(deadlines);
    return invitationDto(updated);
  });
}
export const invitationToken = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
async function checkedInvitation(actor: Actor, token: string, tx: Transaction = db) {
  const invitation = await tx.invitation.findUnique({ where: { tokenHash: tokenHash(token) }, include: { tenant: { select: { name: true, status: true } } } });
  if (!invitation || invitation.email !== actor.user.email.toLowerCase()) fail(404, "INVITATION_NOT_FOUND", "이 계정으로 수락할 수 있는 초대가 없습니다.");
  if (invitation.status !== "pending" || invitation.expiresAt <= new Date() || invitation.tenant.status !== "active")
    fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었거나 이미 처리되었습니다. 담당자에게 다시 초대를 요청해주세요.");
  return invitation;
}
export async function previewInvitation(actor: Actor, token: string) {
  return db.$transaction(async tx => {
    const found = await checkedInvitation(actor, token, tx);
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${found.tenantId} FOR SHARE`;
    const current = await lockAccountActor(tx, actor);
    const row = await checkedInvitation({ ...actor, user: current.user }, token, tx);
    assertFileDeadlines(current.deadlines);
    return { id: row.id, companyName: row.tenant.name, role: row.role, email: row.email, expiresAt: row.expiresAt };
  });
}
export async function acceptInvitation(actor: Actor, token: string, requestId: string, tx: Transaction) {
  const found = await checkedInvitation(actor, token, tx);
  await tx.$queryRawUnsafe('SELECT id FROM "Company" WHERE id=$1 FOR UPDATE', found.tenantId);
  // Re-read after the company lock: resend/revoke/another acceptance may have won.
  const row = await checkedInvitation(actor, token, tx);
  const current = await lockAccountActor(tx, actor);
  if (current.user.email.toLowerCase() !== row.email) fail(404, "INVITATION_NOT_FOUND", "이 계정으로 수락할 수 있는 초대가 없습니다.");
  const inviter = await tx.membership.findFirst({ where: { id: row.invitedBy, tenantId: row.tenantId, status: "active" } });
  if (!inviter || !roleCan(inviter.role, "member.manage")) fail(409, "INVITER_UNAVAILABLE", "초대한 담당자의 권한이 변경되었습니다. 다시 초대를 요청해주세요.");
  mayAssign(inviter.role, row.role);
  await validateServices(tx, row.tenantId, row.serviceIds);
  const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: row.tenantId, userId: actor.user.id } } });
  if (existing && existing.status !== "revoked") fail(409, "MEMBER_EXISTS", "이미 회사에 소속된 계정입니다.");
  await assertQuota(tx, row.tenantId, "members", true, row.id);
  const member = existing
    ? await tx.membership.update({ where: { id: existing.id }, data: { role: row.role, status: "active",
      accessKind: "direct", expertAssignmentId: null, version: { increment: 1 } } })
    : await tx.membership.create({ data: { tenantId: row.tenantId, userId: actor.user.id, role: row.role } });
  if (existing?.expertAssignmentId) await tx.expertAssignment.updateMany({ where: { id: existing.expertAssignmentId, status: "active" },
    data: { status: "revoked", revokedAt: new Date(), version: { increment: 1 } } });
  await replaceGrants(tx, row.tenantId, member.id, row.serviceIds, row.role);
  await tx.invitation.update({ where: { id: row.id }, data: { status: "accepted", acceptedBy: actor.user.id, version: { increment: 1 } } });
  await tx.session.update({ where: { id: actor.session.id }, data: { activeCompanyId: row.tenantId, activeServiceId: row.serviceIds[0] } });
  await audit(tx, { tenantId: row.tenantId, user: actor.user }, requestId, "invitation.accepted", "invitation", row.id, ["status", "membership"]);
  assertFileDeadlines(current.deadlines);
  assertInvitationDeadline(row.expiresAt);
  return { companyId: row.tenantId, companyName: row.tenant.name, memberId: member.id };
}

function assertInvitationDeadline(expiresAt: Date) {
  if (expiresAt <= new Date()) fail(410, "INVITATION_UNAVAILABLE", "초대가 만료되었습니다. 담당자에게 다시 초대를 요청해주세요.");
}
export async function acceptInvitationRequest(actor: Actor, token: string, key: string | null, requestId: string) {
  let deadlines: Awaited<ReturnType<typeof lockAccountActor>>["deadlines"] | undefined;
  let invitationDeadline: Date | undefined;
  return idempotent("invitation:accept:" + actor.user.id, key, { token }, async tx => {
    const result = await acceptInvitation(actor, token, requestId, tx);
    deadlines = (await lockAccountActor(tx, actor)).deadlines;
    invitationDeadline = (await tx.invitation.findUniqueOrThrow({ where: { tokenHash: tokenHash(token) } })).expiresAt;
    return { status: 200, body: result };
  }, undefined, async (tx, cached) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${cached.companyId} FOR SHARE`;
    const current = await lockAccountActor(tx, actor);
    deadlines = current.deadlines;
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${cached.memberId} AND "tenantId"=${cached.companyId} FOR SHARE`;
    const invitation = await tx.invitation.findUnique({ where: { tokenHash: tokenHash(token) }, include: { tenant: true } });
    const member = await tx.membership.findFirst({ where: { id: cached.memberId, tenantId: cached.companyId,
      userId: current.user.id, status: "active", accessKind: "direct" } });
    if (!invitation || invitation.tenantId !== cached.companyId || invitation.status !== "accepted" ||
      invitation.acceptedBy !== current.user.id || invitation.email !== current.user.email.toLowerCase() ||
      invitation.tenant.status !== "active" || !member)
      fail(410, "INVITATION_UNAVAILABLE", "초대 수락 상태가 변경되었습니다. 현재 회사와 구성원 상태를 확인해주세요.");
    return { companyId: invitation.tenantId, companyName: invitation.tenant.name, memberId: member.id };
  }, async () => {
    if (deadlines) assertFileDeadlines(deadlines);
    if (invitationDeadline) assertInvitationDeadline(invitationDeadline);
  });
}
