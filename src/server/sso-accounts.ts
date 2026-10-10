import type { Session } from "@/generated/prisma/client";
import type { Context } from "./context";
import { activeMembershipWhere } from "./context";
import { db, type Transaction } from "./db";
import { lockServiceActor, lockSsoRecoveryActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { audit } from "./audit";
import { fail } from "./http";
import { ssoPolicy, providerMatchesPolicy } from "./sso-policy-enforcement";

const freshMs = 5 * 60 * 1000;
export function assertFreshSsoSession(session: Pick<Session, "createdAt">) {
  if (session.createdAt.getTime() + freshMs <= Date.now())
    fail(401, "SSO_REAUTH_REQUIRED", "계정 연결을 변경하려면 다시 로그인한 뒤 5분 안에 시도해주세요.");
}
async function actor(tx: Transaction, ctx: Context, recovery = false) {
  const current = recovery ? await lockSsoRecoveryActor(tx, ctx) : await lockServiceActor(tx, ctx, "service.read");
  if (current.member.accessKind !== "direct") fail(403, "FORBIDDEN", "직접 소속된 회사의 계정만 연결할 수 있습니다.");
  return current;
}
export async function hasSsoFallback(tx: Transaction, userId: string, excluding: string[], tenantId?: string) {
  if (tenantId) {
    const policy = await ssoPolicy(tx, tenantId);
    if (policy.mode !== "NONE") {
      const accounts = await tx.account.findMany({ where: { userId, id: { notIn: excluding },
        ssoProvider: { tenantId, enabled: true, preflightOk: true } }, include: { ssoProvider: true } });
      return accounts.some(account => account.ssoProvider && providerMatchesPolicy(account.ssoProvider, policy.mode));
    }
  }
  if (await tx.account.findFirst({ where: { userId, id: { notIn: excluding }, providerId: "credential", password: { not: "" } } })) return true;
  const memberships = await tx.membership.findMany({ where: { ...activeMembershipWhere(userId), accessKind: "direct" }, select: { tenantId: true } });
  const candidates = await tx.account.findMany({ where: { userId, id: { notIn: excluding },
    ssoProvider: { tenantId: { in: memberships.map(row => row.tenantId) }, enabled: true, preflightOk: true } }, include: { ssoProvider: true } });
  for (const candidate of candidates) {
    const provider = candidate.ssoProvider;
    if (provider && providerMatchesPolicy(provider, (await ssoPolicy(tx, provider.tenantId)).mode)) return true;
  }
  return false;
}
export async function listOwnSsoAccounts(ctx: Context) {
  return db.$transaction(async tx => {
    const current = await actor(tx, ctx, true);
    const policy = await ssoPolicy(tx, ctx.tenantId);
    const providers = await tx.ssoProvider.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    const rows = await tx.account.findMany({ where: { userId: ctx.user.id, ssoProviderId: { in: providers.map(p => p.id) } }, orderBy: { id: "asc" },
      select: { id: true, ssoProviderId: true, createdAt: true, updatedAt: true } });
    const items = [];
    for (const row of rows) items.push({ id: row.id, providerId: row.ssoProviderId!, createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(), canUnlink: policy.mode === "NONE" && await hasSsoFallback(tx, ctx.user.id, [row.id], ctx.tenantId) });
    const session = await tx.session.findUniqueOrThrow({ where: { id: ctx.session.id } });
    assertFileDeadlines(current.deadlines);
    return { companyName: current.member.tenant.name, reauthenticate: session.createdAt.getTime() + freshMs <= Date.now(), loginPolicy: policy.mode,
      providers: providers.map(p => ({ id: p.id, name: p.name, protocol: p.protocol,
        available: p.enabled && p.preflightOk && providerMatchesPolicy(p, policy.mode) })), items };
  });
}
export async function unlinkOwnSsoAccount(ctx: Context, id: string, updatedAt: string, requestId: string) {
  return db.$transaction(async tx => {
    // Same order as credential/account closure: password guard, companies, user, sessions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"password:" + ctx.user.id}, 0))`;
    await tx.$queryRaw`SELECT c.id FROM "Company" c JOIN "Membership" m ON m."tenantId"=c.id
      WHERE m."userId"=${ctx.user.id} ORDER BY c.id FOR UPDATE OF c`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR UPDATE`;
    const current = await actor(tx, ctx);
    const session = await tx.session.findUniqueOrThrow({ where: { id: ctx.session.id } });
    assertFreshSsoSession(session);
    const providers = await tx.ssoProvider.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true } });
    const account = await tx.account.findFirst({ where: { id, userId: ctx.user.id, ssoProviderId: { in: providers.map(p => p.id) } } });
    if (!account) fail(404, "NOT_FOUND", "연결 계정을 찾을 수 없습니다.");
    if (account.updatedAt.toISOString() !== updatedAt) fail(409, "VERSION_CONFLICT", "연결 정보가 변경되었습니다. 다시 불러와주세요.");
    if ((await ssoPolicy(tx, ctx.tenantId)).mode !== "NONE")
      fail(409, "SSO_POLICY_UNLINK_FORBIDDEN", "회사가 SSO 로그인을 제한하고 있어 연결을 해제할 수 없습니다.");
    if (!await hasSsoFallback(tx, ctx.user.id, [account.id])) fail(409, "SSO_LAST_LOGIN_METHOD", "마지막 로그인 수단은 해제할 수 없습니다. 다른 로그인 수단을 먼저 등록해주세요.");
    await tx.account.delete({ where: { id: account.id } });
    const sessions = await tx.session.findMany({ where: { userId: ctx.user.id }, select: { id: true, activeCompanyId: true } });
    await tx.session.deleteMany({ where: { userId: ctx.user.id } });
    // Session deletion also cascades pending account-link states. Factor/reset proofs use the user ID as value.
    await tx.verification.deleteMany({ where: { value: ctx.user.id } });
    for (const row of sessions) await audit(tx, { tenantId: row.activeCompanyId, user: ctx.user }, requestId, "session.ended", "session", row.id);
    await audit(tx, ctx, requestId, "sso.account_unlinked", "account", account.id, ["account", "sessions", "verification"]);
    assertFileDeadlines(current.deadlines);
    assertFreshSsoSession(session);
    return { unlinked: true, signedOut: true };
  }, { timeout: 15000 });
}
