import { z } from "zod";
import { db } from "./db";
import { tokenHash } from "./crypto";
import { lockSecurityEntitlements } from "./feature-entitlements";
import { deliverMail, type ClaimedJob, type Mail } from "./jobs";
import { ssoPolicy } from "./sso-policy-enforcement";
import { currentSsoSessionProof } from "./sso-session-proof";

// Delivery is not an authorization grant. Saving rechecks every actor/IP/MFA guard.
export async function deliverSsoPolicyMail(job: ClaimedJob, workerId: string, mail: Mail) {
  const id = job.dedupeKey.slice("mail:sso-policy:".length);
  if (!z.uuid().safeParse(id).success || !job.tenantId) return false;
  const tenantId = job.tenantId;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${job.tenantId} FOR SHARE`;
    const initial = await tx.ssoPolicyChallenge.findFirst({ where: { id, tenantId } });
    if (!initial) return false;
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE "tenantId"=${job.tenantId} AND "userId"=${initial.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${initial.sessionId} AND "userId"=${initial.userId} FOR SHARE`;
    const row = await tx.ssoPolicyChallenge.findUnique({ where: { id }, include: { tenant: { include: { policy: true } }, session: { include: { user: true } } } });
    const member = await tx.membership.findFirst({ where: { tenantId, userId: initial.userId, status: "active", accessKind: "direct", role: { in: ["owner", "security"] } } });
    if (!row || !member || row.tenant.status !== "active" || row.session.user.status !== "active" || !row.session.user.emailVerified
      || row.session.user.email !== mail.to || row.emailHash !== tokenHash(mail.to) || row.consumedAt || row.revokedAt || row.attempts >= 5
      || (row.session.activeCompanyId && row.session.activeCompanyId !== job.tenantId)) return false;
    const policy = await ssoPolicy(tx, tenantId), proof = await currentSsoSessionProof(tx, row.sessionId, row.userId);
    if (policy.version !== row.policyVersion || !proof || proof.tenantId !== job.tenantId
      || proof.identityProvider !== (row.mode === "NONE" ? policy.mode : row.mode)) return false;
    const entitlement = await lockSecurityEntitlements(tx, tenantId);
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.job.findFirst({ where: { id: job.id, tenantId: job.tenantId, status: "leased", leaseOwner: workerId, attempts: job.attempts } });
    if (!current?.leaseUntil) return false;
    const valid = () => row.expiresAt > new Date() && row.session.expiresAt > new Date()
      && (!row.tenant.policy || row.session.updatedAt.getTime() + row.tenant.policy.sessionMinutes * 60000 > Date.now())
      && proof.authenticatedAt.getTime() + 5 * 60000 > Date.now() && current.leaseUntil! > new Date()
      && entitlement.snapshot()["security.sso_login_policy"].available;
    if (!valid()) return false;
    await deliverMail(job, mail, undefined, async () => { if (!valid()) throw new Error("SSO_POLICY_MAIL_EXPIRED"); });
    return true;
  }, { timeout: 45000 });
}
