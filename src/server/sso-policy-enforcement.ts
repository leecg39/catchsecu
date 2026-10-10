import type { SsoProvider } from "@/generated/prisma/client";
import { ssoLoginMode, type SsoLoginMode } from "@/contracts/sso-login-policy";
import { db, type Transaction } from "./db";
import { fail } from "./http";
import { ssoIdentityProvider } from "./sso-identity";
import { currentSsoSessionProof } from "./sso-session-proof";

// Policy writers take Company FOR UPDATE, including when there is no policy row.
// Business transactions must already hold Company FOR SHARE or FOR UPDATE.
// Subscription expiry never relaxes a saved authentication restriction.
export async function ssoPolicy(tx: Transaction, tenantId: string) {
  const row = await tx.ssoLoginPolicy.findUnique({ where: { tenantId } });
  return { mode: ssoLoginMode.parse(row?.mode ?? "NONE"), version: row?.version ?? 0 };
}
function deny(mode: SsoLoginMode): never {
  fail(403, mode === "GOOGLE" ? "GOOGLE_OAUTH_POLICY" : "MS_OAUTH_POLICY",
    `이 회사는 ${mode === "GOOGLE" ? "Google" : "Microsoft"} 로그인만 허용합니다. 해당 회사의 SSO 계정으로 다시 인증해주세요.`);
}
export async function ssoSessionState(tenantId: string, userId: string, sessionId?: string, tx: Transaction = db) {
  const policy = await ssoPolicy(tx, tenantId);
  if (policy.mode === "NONE") return { ...policy, required: false };
  const proof = sessionId ? await currentSsoSessionProof(tx, sessionId, userId) : null;
  return { ...policy, required: !proof || proof.tenantId !== tenantId || proof.identityProvider !== policy.mode };
}
export async function assertSsoSession(tx: Transaction, tenantId: string, userId: string, sessionId: string) {
  const state = await ssoSessionState(tenantId, userId, sessionId, tx);
  if (state.required) deny(state.mode);
  return state;
}
export function providerMatchesPolicy(provider: SsoProvider, mode: SsoLoginMode) {
  return mode === "NONE" || ssoIdentityProvider(provider) === mode;
}
// Call only alongside the current provider/state/signature checks, never instead of them.
export async function assertSsoProviderPolicy(tx: Transaction, provider: SsoProvider) {
  const policy = await ssoPolicy(tx, provider.tenantId);
  if (!providerMatchesPolicy(provider, policy.mode)) deny(policy.mode);
}
