import { randomBytes, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { z } from "zod";
import type { Transaction } from "./db";
import { authMutationScope } from "./auth-mutation-scope";
import { authAudit, lockAuthUser } from "./auth-mutations";
import { encrypt, decrypt } from "./crypto";
import { fail } from "./http";
import { env } from "./env";
import { assertCompanyIp } from "./ip-enforcement";
import { trustedClientIp } from "./client-ip";

// Standard Better Auth proofs handle codes, attempts, expiry and one-time use.
// The additional encrypted proof pins the SSO authorization until verification.
const bindingSchema = z.object({
  userId: z.string(), tenantId: z.string(), providerId: z.string(), providerVersion: z.number().int(),
  accountId: z.string(), memberId: z.string(), memberVersion: z.number().int(), passwordChangedAt: z.string().nullable(),
  originalSessionId: z.string().nullable(),
});
type Binding = z.infer<typeof bindingSchema>;
export type SsoMfaAuthorization = { bindingId: string; userId: string; tenantId: string; deadline: Date };
type AuthContext = { internalAdapter: {
  findVerificationValue(identifier: string): Promise<{ id: string; value: string; expiresAt: Date } | null>;
} };

function cookieValue(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.BETTER_AUTH_URL.startsWith("https:") ? "; Secure" : ""}`;
}

export async function issueSsoMfa(tx: Transaction, binding: Binding) {
  const { auth } = await import("./auth");
  const context = await auth.$context;
  const identifier = "2fa-sso-" + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 600000);
  await authMutationScope.run({ client: tx, requestId: randomUUID(), path: "/api/v1/auth/sso/callback",
    actorId: binding.userId, tenantId: binding.tenantId, lockedUsers: new Set(), changed: false, failed: false,
    proofDeadline: expiresAt, createdResetProofs: new Set() }, async () => {
    await context.internalAdapter.createVerificationValue({ identifier, value: binding.userId, expiresAt });
    await context.internalAdapter.createVerificationValue({ identifier: "2fa-attempts-" + identifier, value: "0", expiresAt });
    await context.internalAdapter.createVerificationValue({ identifier: "sso-binding-" + identifier, value: encrypt(binding), expiresAt });
    await authAudit(tx, binding.userId, binding.tenantId, "auth.factor_challenged", "user", binding.userId);
  });
  return { redirect: "/login-otp?returnTo=" + encodeURIComponent(binding.originalSessionId ? "/link/oauth2/verified" : "/dashboard"),
    cookie: cookieValue(context.createAuthCookie("two_factor").name,
      identifier + "." + await makeSignature(identifier, env.BETTER_AUTH_SECRET), 600),
    clearSessionCookie: cookieValue(context.authCookies.sessionToken.name, "", 0) };
}

export async function bindSsoMfa(identifier: string, context: AuthContext, headers: Headers, hasSession: boolean) {
  if (!identifier.startsWith("2fa-sso-")) return;
  const scope = authMutationScope.getStore();
  if (!scope || hasSession) fail(401, "SSO_MFA_SESSION_CONFLICT", "SSO 인증을 다시 시작해주세요.");
  const proof = await context.internalAdapter.findVerificationValue("sso-binding-" + identifier);
  if (!proof || proof.expiresAt <= new Date()) fail(401, "SSO_MFA_EXPIRED", "SSO 인증이 만료되었습니다. 다시 시작해주세요.");
  let binding: Binding;
  try { binding = bindingSchema.parse(decrypt(proof.value)); }
  catch { fail(401, "SSO_MFA_INVALID", "SSO 인증 정보를 확인할 수 없습니다."); }
  const tx = scope.client;
  const user = await lockAuthUser(tx, binding.userId, true);
  if (!user?.twoFactorEnabled || (user.passwordChangedAt?.toISOString() ?? null) !== binding.passwordChangedAt)
    fail(401, "SSO_MFA_ACCOUNT_CHANGED", "계정 보안 설정이 변경되었습니다. 다시 로그인해주세요.");
  await tx.$queryRaw`SELECT id FROM "SsoProvider" WHERE id=${binding.providerId} FOR SHARE`;
  const provider = await tx.ssoProvider.findUnique({ where: { id: binding.providerId }, include: { tenant: true } });
  if (!provider || provider.tenantId !== binding.tenantId || provider.tenant.status !== "active"
    || !provider.enabled || !provider.preflightOk || provider.version !== binding.providerVersion)
    fail(409, "SSO_CONFIGURATION_CHANGED", "SSO 설정이 변경되었습니다. 다시 로그인해주세요.");
  await assertCompanyIp(binding.tenantId, trustedClientIp(headers), tx);
  const member = await tx.membership.findFirst({ where: { id: binding.memberId, tenantId: binding.tenantId,
    userId: binding.userId, status: "active", accessKind: "direct", version: binding.memberVersion } });
  const account = await tx.account.findFirst({ where: { id: binding.accountId, userId: binding.userId, providerId: "sso:" + binding.providerId } });
  if (!member || !account) fail(403, "SSO_ACCESS_REVOKED", "SSO 연결 또는 회사 권한이 변경되었습니다.");
  let deadline = proof.expiresAt;
  if (binding.originalSessionId) {
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${binding.originalSessionId} FOR SHARE`;
    const session = await tx.session.findUnique({ where: { id: binding.originalSessionId } });
    const policy = await tx.securityPolicy.findUnique({ where: { tenantId: binding.tenantId } });
    if (!session || session.userId !== user.id || session.activeCompanyId !== binding.tenantId)
      fail(401, "SSO_LINK_SESSION_EXPIRED", "계정을 연결한 세션이 종료되었습니다.");
    deadline = new Date(Math.min(deadline.getTime(), session.expiresAt.getTime(),
      policy ? session.updatedAt.getTime() + policy.sessionMinutes * 60000 : Infinity));
  }
  if (deadline <= new Date()) fail(401, "SSO_MFA_EXPIRED", "SSO 인증이 만료되었습니다.");
  scope.actorId = binding.userId; scope.tenantId = binding.tenantId;
  scope.proofDeadline = !scope.proofDeadline || deadline < scope.proofDeadline ? deadline : scope.proofDeadline;
  scope.ssoMfa = { bindingId: proof.id, userId: binding.userId, tenantId: binding.tenantId, deadline };
}
