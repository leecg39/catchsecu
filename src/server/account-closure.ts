import { z } from "zod";
import { db } from "./db";
import { auth } from "./auth";
import { encrypt } from "./crypto";
import { fail } from "./http";
import { lockAccountActor } from "./account-actor";
import { assertFileDeadlines } from "./file-access";
import { accountClosureInput } from "@/contracts/account-closure";
type Actor = Awaited<ReturnType<typeof import("./context").requireActor>>;

export async function accountClosureStatus(actor: Actor) {
  return db.$transaction(async tx => {
    const current = await lockAccountActor(tx, actor);
    const memberships = await tx.membership.findMany({ where: { userId: current.user.id, role: "owner", status: "active", tenant: { status: { not: "closed" } } },
      select: { tenant: { select: { id: true, name: true } } }, orderBy: { tenantId: "asc" } });
    const credential = await tx.account.findFirst({ where: { userId: current.user.id, providerId: "credential" }, select: { password: true } });
    const admins = current.user.platformAdmin ? await tx.user.count({ where: { id: { not: current.user.id }, platformAdmin: true, status: "active" } }) : 1;
    assertFileDeadlines(current.deadlines);
    return { version: current.user.version, email: current.user.email, hasPassword: !!credential?.password,
      platformAdminHandoffRequired: !admins, ownedCompanies: memberships.map(member => member.tenant) };
  });
}

export async function closeAccount(actor: Actor, input: z.infer<typeof accountClosureInput>, requestId: string) {
  const context = await auth.$context;
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"password:" + actor.user.id}, 0))`;
    await tx.$queryRaw`SELECT c.id FROM "Company" c JOIN "Membership" m ON m."tenantId" = c.id
      WHERE m."userId" = ${actor.user.id} ORDER BY c.id FOR UPDATE OF c`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-admin-closure', 0))`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.user.id} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.user.id } });
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${actor.session.id} AND "userId"=${user.id} FOR UPDATE`;
    const session = await tx.session.findFirst({ where: { id: actor.session.id, userId: user.id, expiresAt: { gt: new Date() } } });
    if (!session || user.status !== "active" || !user.emailVerified) fail(401, "ACCOUNT_UNAVAILABLE", "다시 로그인해주세요.");
    if (user.version !== input.version) fail(409, "VERSION_CONFLICT", "계정 정보가 변경되었습니다. 다시 불러와주세요.");
    if (input.confirmation !== user.email) fail(422, "ACCOUNT_CONFIRMATION", "로그인 이메일을 정확하게 입력해주세요.");
    if (await tx.membership.count({ where: { userId: user.id, role: "owner", status: "active", tenant: { status: { not: "closed" } } } }))
      fail(409, "OWNERSHIP_TRANSFER_REQUIRED", "모든 소유 회사의 소유권을 다른 활성 구성원에게 이전해주세요.");
    if (user.platformAdmin && !await tx.user.count({ where: { id: { not: user.id }, platformAdmin: true, status: "active" } }))
      fail(409, "PLATFORM_ADMIN_HANDOFF_REQUIRED", "다른 활성 플랫폼 운영자에게 운영 권한을 인계해주세요.");
    const credential = await tx.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
    if (!credential?.password) fail(409, "PASSWORD_CREDENTIAL_REQUIRED", "계정 폐쇄에는 비밀번호 인증 수단이 필요합니다.");
    if (!await context.password.verify({ hash: credential.password, password: input.password }))
      fail(401, "PASSWORD_REQUIRED", "현재 비밀번호를 확인해주세요.");
    const memberships = await tx.membership.findMany({ where: { userId: user.id }, select: { id: true, tenantId: true } });
    await tx.serviceGrant.deleteMany({ where: { member: { userId: user.id } } });
    await tx.membership.updateMany({ where: { userId: user.id, status: { not: "revoked" } }, data: { status: "revoked", version: { increment: 1 } } });
    await tx.expertAssignment.updateMany({ where: { expertUserId: user.id, status: "active" }, data: { status: "revoked", revokedAt: new Date(), version: { increment: 1 } } });
    const invitations = await tx.invitation.findMany({ where: { status: "pending", OR: [{ email: user.email }, { invitedBy: { in: memberships.map(member => member.id) } }] }, select: { id: true, version: true } });
    await tx.invitation.updateMany({ where: { id: { in: invitations.map(row => row.id) } }, data: { status: "revoked", version: { increment: 1 } } });
    if (invitations.length) await tx.job.updateMany({ where: { dedupeKey: { in: invitations.map(row => "mail:invitation:" + row.id + ":" + row.version) }, status: { in: ["queued", "retry"] } }, data: { status: "cancelled", payloadCipher: encrypt({ cancelled: true }) } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.passwordHistory.deleteMany({ where: { userId: user.id } });
    await tx.passwordDeferral.deleteMany({ where: { userId: user.id } });
    await tx.verification.deleteMany({ where: { value: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { status: "closed", platformAdmin: false, twoFactorEnabled: false, version: { increment: 1 } } });
    const now = new Date();
    const closure = await tx.accountClosure.create({ data: { userId: user.id, requestedAt: now, completedAt: now, reasonCipher: input.reason ? encrypt(input.reason) : null } });
    for (const tenantId of [null, ...memberships.map(member => member.tenantId)]) await tx.auditEvent.create({ data: {
      tenantId, actorId: user.id, action: "account.closed", resource: "user", resourceId: user.id, requestId,
      detail: { changedFields: ["status", "memberships", "sessions", "credentials"], closureId: closure.id },
    } });
    assertFileDeadlines({ session: session.expiresAt, expert: null, password: null });
    return { id: closure.id, status: "closed", completedAt: closure.completedAt };
  }, { isolationLevel: "Serializable", timeout: 30000 });
}
