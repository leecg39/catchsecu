import { normalizeSubjectEmail } from "@/contracts/subjects";
import { tokenHash } from "./crypto";
import type { Transaction } from "./db";
export function contactEmailHash(email: string) { return tokenHash("subject:email:" + normalizeSubjectEmail(email)); }
export type DeliveryScope = { tenantId: string; serviceId: string; emailHash: string };
export async function lockDelivery(tx: Transaction, scope: DeliveryScope) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"delivery:" + scope.tenantId + ":" + scope.serviceId + ":" + scope.emailHash}, 0))`;
}
export async function isSuppressed(tx: Transaction, scope: DeliveryScope) {
  if (await tx.emailSuppression.count({ where: { tenantId: scope.tenantId, serviceId: scope.serviceId, contactHash: scope.emailHash } })) return true;
  return !!await tx.marketingPreference.count({ where: { tenantId: scope.tenantId, serviceId: scope.serviceId, channel: "email", contactHash: scope.emailHash, OR: [{ excluded: true }, { status: { not: "granted" } }] } }) || !!(await tx.suppression.findUnique({ where: { tenantId_serviceId_emailHash_channel: { ...scope, channel: "email" } } }));
}
/** The caller must hold the submission write lock and have changed its state to withdrawn. */
export async function suppressSubmission(tx: Transaction, submissionId: string, reason: "subject_withdrawal" | "administrator_withdrawal") {
  const row = await tx.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { subject: true } });
  if (!row.subject) return false;
  const scope = { tenantId: row.tenantId, serviceId: row.subject.serviceId, emailHash: row.subject.emailHash };
  await lockDelivery(tx, scope);
  if (!await tx.suppression.count({ where: { ...scope, channel: "email" } })) await tx.suppression.create({ data: { ...scope, reason, sourceSubmissionId: row.id } });
  return true;
}
