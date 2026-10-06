import type { Context } from "./context";
import { activeMembershipWhere } from "./context";
import type { Transaction } from "./db";
import { audit } from "./audit";
import { fail } from "./http";
import { hasSsoFallback } from "./sso-accounts";

/** Caller holds the company/provider lock in a SERIALIZABLE transaction. */
export async function assertProviderCanStop(tx: Transaction, ctx: Context, providerId: string) {
  const accounts = await tx.account.findMany({ where: { ssoProviderId: providerId },
    select: { id: true, userId: true }, orderBy: { id: "asc" } });
  const userIds = [...new Set(accounts.map(account => account.userId))].sort();
  for (const userId of userIds) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const active = await tx.membership.findFirst({ where: { ...activeMembershipWhere(userId, ctx.tenantId), accessKind: "direct",
      user: { status: "active", emailVerified: true } } });
    if (active && !await hasSsoFallback(tx, userId, accounts.filter(a => a.userId === userId).map(a => a.id)))
      fail(409, "SSO_PROVIDER_LAST_LOGIN", "이 SSO만으로 로그인하는 활성 구성원이 있습니다. 다른 로그인 수단을 준비한 뒤 SSO 사용을 중지하거나 인증 정보를 변경해주세요.");
  }
  return { accounts, userIds };
}

export async function removeProviderAccounts(tx: Transaction, ctx: Context, providerId: string, requestId: string) {
  const { accounts, userIds } = await assertProviderCanStop(tx, ctx, providerId);
  const sessions = await tx.session.findMany({ where: { userId: { in: userIds } }, select: { id: true, userId: true, activeCompanyId: true } });
  await tx.account.deleteMany({ where: { id: { in: accounts.map(a => a.id) } } });
  await tx.session.deleteMany({ where: { userId: { in: userIds } } });
  await tx.verification.deleteMany({ where: { value: { in: userIds } } });
  // Do this explicitly as well as the provider FK, so the count/effect is part of this operation.
  await tx.ssoState.deleteMany({ where: { providerId, tenantId: ctx.tenantId } });
  for (const session of sessions) await audit(tx, { tenantId: session.activeCompanyId, user: ctx.user }, requestId,
    "session.ended", "session", session.id);
  for (const account of accounts) await audit(tx, ctx, requestId, "sso.account_removed_with_provider", "account", account.id, ["account", "sessions", "verification"]);
  return { removedAccounts: accounts.length, endedSessions: sessions.length, signedOut: userIds.includes(ctx.user.id) };
}
