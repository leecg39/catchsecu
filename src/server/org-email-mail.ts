import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { tokenHash } from "./crypto";
import { deliverMail, type ClaimedJob, type Mail } from "./jobs";
import { ssoPolicy, providerMatchesPolicy } from "./sso-policy-enforcement";

// An outbox entry is not a lasting permission to send. Recheck the ticket and
// directory under the locks used by the administrator and registration paths.
export async function deliverOrgEmailMail(job: ClaimedJob, workerId: string, mail: Mail) {
  const id = job.dedupeKey.slice("mail:org-email:".length);
  if (!z.uuid().safeParse(id).success || !job.tenantId) return false;
  const tenantId = job.tenantId;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${job.tenantId} FOR SHARE`;
    const initial = await tx.orgEmailChallenge.findFirst({ where: { id, tenantId }, include: { state: true } });
    if (!initial?.state.orgMemberId) return false;
    await tx.$queryRaw`SELECT id FROM "SsoProvider" WHERE id=${initial.state.providerId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "VirtualOrgMember" WHERE id=${initial.state.orgMemberId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "SsoState" WHERE id=${initial.stateId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "OrgEmailChallenge" WHERE id=${id} FOR SHARE`;
    const row = await tx.orgEmailChallenge.findUnique({ where: { id }, include: { state: { include: { provider: { include: { tenant: true } } } } } });
    const member = await tx.virtualOrgMember.findUnique({ where: { id: initial.state.orgMemberId } });
    if (!row || !member) return false;
    const { state } = row, { provider } = state;
    if (provider.tenant.status !== "active" || !provider.enabled || !provider.preflightOk || provider.version !== state.providerVersion
      || member.providerId !== provider.id || member.emailCipher || row.revokedAt || row.attempts >= 5
      || row.emailHash !== tokenHash(mail.to) || state.nonceHash !== createHash("sha256").update(`orgmember:${member.id}:${member.version}`).digest("hex")
      || !providerMatchesPolicy(provider, (await ssoPolicy(tx, tenantId)).mode)) return false;
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${job.id} FOR UPDATE`;
    const lease = await tx.job.findFirst({ where: { id: job.id, tenantId, status: "leased", leaseOwner: workerId, attempts: job.attempts, payloadErasedAt: null } });
    if (!lease?.leaseUntil) return false;
    const valid = () => state.expiresAt > new Date() && row.expiresAt > new Date() && lease.leaseUntil! > new Date();
    if (!valid()) return false;
    await deliverMail(job, mail, undefined, async () => { if (!valid()) throw new Error("ORG_EMAIL_MAIL_EXPIRED"); });
    return true;
  }, { timeout: 45000 });
}
