import type { SsoProvider, SsoSessionProof } from "@/generated/prisma/client";
import type { Transaction } from "./db";
import { fail } from "./http";
import { ssoIdentityProvider } from "./sso-identity";

export type SsoProofSource = Pick<SsoSessionProof, "userId" | "tenantId" | "providerId" | "accountId" | "identityProvider" | "authenticatedAt">;

/** Caller holds company/account locks and has verified the external proof.
 * Composite references bind the session, provider, account, user and tenant.
 */
export async function recordSsoSessionProof(tx: Transaction, sessionId: string, userId: string,
  provider: SsoProvider, accountId: string, authenticatedAt = new Date()) {
  if (!provider.enabled || !provider.preflightOk || !Number.isFinite(authenticatedAt.getTime()) || authenticatedAt > new Date())
    fail(401, "SSO_PROOF_INVALID", "SSO 인증 근거를 확인할 수 없습니다. 다시 로그인해주세요.");
  return tx.ssoSessionProof.create({ data: { sessionId, userId, tenantId: provider.tenantId, providerId: provider.id,
    accountId, identityProvider: ssoIdentityProvider(provider), authenticatedAt } });
}

/** Authentication provenance, not a membership/role/IP/session-expiry guard. */
export async function currentSsoSessionProof(tx: Transaction, sessionId: string, userId: string): Promise<SsoProofSource | null> {
  const proof = await tx.ssoSessionProof.findUnique({ where: { sessionId }, include: { provider: true } });
  if (!proof || proof.userId !== userId || !proof.provider.enabled || !proof.provider.preflightOk
    || proof.identityProvider !== ssoIdentityProvider(proof.provider) || proof.authenticatedAt > new Date()) return null;
  return { userId: proof.userId, tenantId: proof.tenantId, providerId: proof.providerId, accountId: proof.accountId,
    identityProvider: proof.identityProvider, authenticatedAt: proof.authenticatedAt };
}

/** MFA configuration rotates the session without manufacturing a fresh SSO login. */
export async function copySsoSessionProof(tx: Transaction, sessionId: string, userId: string, source: SsoProofSource) {
  if (userId !== source.userId) fail(401, "SSO_PROOF_INVALID", "SSO 인증 사용자가 일치하지 않습니다.");
  const provider = await tx.ssoProvider.findUnique({ where: { id: source.providerId } });
  if (!provider || provider.tenantId !== source.tenantId || source.identityProvider !== ssoIdentityProvider(provider))
    fail(401, "SSO_PROOF_INVALID", "SSO 인증 설정이 변경되었습니다. 다시 로그인해주세요.");
  return recordSsoSessionProof(tx, sessionId, userId, provider, source.accountId, source.authenticatedAt);
}
