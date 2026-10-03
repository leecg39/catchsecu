import { eraseMarketingJobs } from "./marketing-jobs";
import { eraseCampaignContacts } from "./campaign-erasure";
import { eraseMarketingSource } from "./marketing";
import { detachSubmissionSubject } from "./subject-identity";
import { randomUUID } from "node:crypto";
import { db, type Transaction } from "./db";
import { activeDestruction, certificateDigest } from "./destruction";
import { privateFiles } from "./file-storage";
import { finishFileDeletion } from "./files";

async function systemAudit(tx: Transaction, tenantId: string, serviceId: string, id: string, action: string, requestId: string) {
  await tx.auditEvent.create({ data: { tenantId, serviceId, resource: "destructionRequest", resourceId: id, action, requestId, detail: {} } });
}
export async function enqueueExpiredSubmissions(now = new Date(), limit = 100) {
  const candidates = await db.$queryRaw<{ id: string; tenantId: string }[]>`
    SELECT s.id,s."tenantId" FROM "Submission" s
    WHERE s.status IN ('submitted','corrected','withdrawn') AND NOT s."legalHold" AND s."retentionUntil"<=${now}
      AND NOT EXISTS (SELECT 1 FROM "DestructionRequest" d WHERE d."submissionId"=s.id
        AND (d.status IN ('pending','scheduled','running','retry','failed') OR d."retentionKey"=s.id||':'||s."retentionVersion"::text))
    ORDER BY s."retentionUntil",s.id LIMIT ${Math.min(1000, Math.max(1, limit))}`;
  let created = 0;
  for (const candidate of candidates) {
    const added = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${candidate.tenantId} FOR SHARE`;
      if (!(await tx.company.findFirst({ where: { id: candidate.tenantId, status: "active" } }))) return false;
      await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${candidate.tenantId} FOR SHARE`;
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Submission" WHERE id=${candidate.id} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return false;
      const row = await tx.submission.findUniqueOrThrow({ where: { id: candidate.id }, include: { formVersion: { include: { form: true } } } });
      if (row.legalHold || row.retentionUntil > now || !["submitted", "corrected", "withdrawn"].includes(row.status)) return false;
      const retentionKey = row.id + ":" + row.retentionVersion;
      if (await tx.destructionRequest.findFirst({ where: { submissionId: row.id, OR: [{ status: { in: activeDestruction } }, { retentionKey }] } })) return false;
      const policy = await tx.securityPolicy.findUniqueOrThrow({ where: { tenantId: row.tenantId } });
      const request = await tx.destructionRequest.create({ data: { tenantId: row.tenantId, serviceId: row.formVersion.form.serviceId,
        submissionId: row.id, source: "retention", retentionKey, previousStatus: row.status, dueAt: row.retentionUntil,
        status: policy.automaticDestruction ? "scheduled" : "pending" } });
      await tx.submission.update({ where: { id: row.id }, data: { status: "pendingDestruction", version: { increment: 1 } } });
      await systemAudit(tx, row.tenantId, request.serviceId, request.id, "destruction.retention_requested", randomUUID());
      return true;
    });
    if (added) created++;
  }
  return { created };
}
export type DestructionWorkerScope = { tenantId: string; requestId: string };
export async function claimDestruction(workerId: string, now = new Date(), scope?: DestructionWorkerScope) {
  const candidates = await db.destructionRequest.findMany({ where: { ...(scope ? { tenantId: scope.tenantId, id: scope.requestId } : {}), OR: [
    { status: "scheduled", dueAt: { lte: now }, submission: { legalHold: false } },
    { status: "retry", nextAttemptAt: { lte: now } }, { status: "running", leaseUntil: { lte: now } },
  ] }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 30 });
  for (const candidate of candidates) {
    const claimed = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${candidate.tenantId} FOR SHARE`;
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Submission" WHERE id=${candidate.submissionId} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return null;
      await tx.$queryRaw`SELECT id FROM "DestructionRequest" WHERE id=${candidate.id} FOR UPDATE`;
      const row = await tx.destructionRequest.findUniqueOrThrow({ where: { id: candidate.id }, include: { submission: true } });
      if (!((row.status === "scheduled" && row.dueAt <= now) || (row.status === "retry" && row.nextAttemptAt && row.nextAttemptAt <= now)
        || (row.status === "running" && row.leaseUntil && row.leaseUntil <= now))) return null;
      if (row.attempts >= row.maxAttempts) {
        await tx.destructionRequest.update({ where: { id: row.id }, data: { status: "failed", leaseOwner: null, leaseUntil: null,
          lastError: "LEASE_EXHAUSTED", version: { increment: 1 } } }); return null;
      }
      if (!row.startedAt) {
        if (!(await tx.company.findFirst({ where: { id: row.tenantId, status: "active" } }))) return null;
        if (row.submission.legalHold || row.submission.status !== "pendingDestruction") return null;
        await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${row.tenantId} FOR SHARE`;
        const policy = await tx.securityPolicy.findUniqueOrThrow({ where: { tenantId: row.tenantId } });
        if (row.approverId) {
          await tx.$queryRaw`SELECT id FROM "Membership" WHERE "tenantId"=${row.tenantId} AND "userId"=${row.approverId} FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.approverId} FOR SHARE`;
        }
        const approved = row.approverId ? await tx.membership.findFirst({ where: { tenantId: row.tenantId, userId: row.approverId,
          role: { in: ["owner", "admin"] }, status: "active", user: { status: "active", emailVerified: true, ...(policy.requireMfa ? { twoFactorEnabled: true } : {}) } } }) : null;
        if (!approved && !(row.source === "retention" && policy.automaticDestruction && !row.approverId)) {
          await tx.destructionRequest.update({ where: { id: row.id }, data: { status: "pending", approverId: null, approvedAt: null,
            decisionCipher: null, lastError: "APPROVAL_REQUIRED", version: { increment: 1 } } });
          await systemAudit(tx, row.tenantId, row.serviceId, row.id, "destruction.approval_invalidated", randomUUID());
          return null;
        }
      }
      const result = await tx.destructionRequest.update({ where: { id: row.id }, data: { status: "running", attempts: { increment: 1 },
        startedAt: row.startedAt ?? now, leaseOwner: workerId, leaseUntil: new Date(now.getTime() + 60000), nextAttemptAt: null,
        lastError: null, version: { increment: 1 } } });
      if (!row.startedAt) {
        await tx.submission.update({ where: { id: row.submissionId }, data: { status: "destroying", version: { increment: 1 } } });
        await tx.fileObject.updateMany({ where: { tenantId: row.tenantId, submissionId: row.submissionId, status: { notIn: ["deleting", "deleted"] } },
          data: { status: "deleting", uploadTokenHash: null, version: { increment: 1 } } });
        await systemAudit(tx, row.tenantId, row.serviceId, row.id, "destruction.started", workerId);
      }
      const files = await tx.fileObject.findMany({ where: { tenantId: row.tenantId, submissionId: row.submissionId }, select: { id: true, storageKey: true, status: true }, orderBy: { id: "asc" } });
      await invalidateSubmissionCaches(tx, row.tenantId, row.submissionId, files.map(file => file.id), now);
      return { ...result, files };
    }, { timeout: 15000 });
    if (claimed) return claimed;
  }
  return null;
}
async function invalidateSubmissionCaches(tx: Transaction, tenantId: string, id: string, fileIds: string[], now: Date) {
  return tx.idempotencyRecord.updateMany({ where: { tenantId, invalidatedAt: null, OR: [
    { resourceType: "submission", resourceId: id }, { resourceType: "file", resourceId: { in: fileIds } },
  ] }, data: { responseCipher: null, requestHash: null, invalidatedAt: now } });
}
export async function runOneDestruction(workerId: string, now = new Date(), scope?: DestructionWorkerScope) {
  const job = await claimDestruction(workerId, now, scope);
  if (!job) return false;
  try {
    for (const file of job.files) {
      const lease = await db.destructionRequest.updateMany({ where: { id: job.id, tenantId: job.tenantId, status: "running", leaseOwner: workerId, attempts: job.attempts, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + 60000), version: { increment: 1 } } });
      if (!lease.count) return true;
      if (file.status === "deleted") await privateFiles.remove(file.storageKey);
      else await finishFileDeletion(file.id, workerId);
    }
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${job.tenantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${job.submissionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "DestructionRequest" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.destructionRequest.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status !== "running" || current.leaseOwner !== workerId || current.attempts !== job.attempts || !current.leaseUntil || current.leaseUntil <= new Date()) return;
      const submission = await tx.submission.findUniqueOrThrow({ where: { id: job.submissionId } });
      if (submission.legalHold || submission.status !== "destroying") throw new Error("DESTRUCTION_STATE");
      if (await tx.fileObject.count({ where: { submissionId: job.submissionId, status: { not: "deleted" } } })) throw new Error("FILES_REMAIN");
      const where = { tenantId: job.tenantId, submissionId: job.submissionId };
      const verification = await tx.verificationReceipt.findMany({ where, select: { attemptId: true } });
      const verificationAttempts = verification.map(row => row.attemptId);
      const verificationEvents = await tx.verificationEvent.count({ where: { tenantId: job.tenantId, attemptId: { in: verificationAttempts } } });
      // The database DELETE trigger also removes each receipt's event and encrypted attempt.
      const verificationReceipts = (await tx.verificationReceipt.deleteMany({ where })).count;
      const identityCounts = await detachSubmissionSubject(tx, job.submissionId);
      const counts = { ...identityCounts, verificationReceipts, verificationEvents, verificationAttempts: verificationAttempts.length,
        campaignRecipients: await eraseCampaignContacts(tx, { sourceSubmissionId: job.submissionId }), marketingJobs: await eraseMarketingJobs(tx, { marketingSubmissionId: job.submissionId }), marketingPreferences: await eraseMarketingSource(tx, job.submissionId), answers: (await tx.answer.deleteMany({ where })).count,
        notes: (await tx.submissionNote.deleteMany({ where })).count,
        correctionPayloads: (await tx.correctionPayload.deleteMany({ where: { tenantId: job.tenantId, correction: { submissionId: job.submissionId } } })).count,
        corrections: (await tx.correction.deleteMany({ where })).count,
        consentEvents: (await tx.consentEvent.deleteMany({ where: { tenantId: job.tenantId, receipt: { submissionId: job.submissionId } } })).count,
        receipts: (await tx.consentReceipt.deleteMany({ where })).count, files: job.files.length,
        importEvidence: (await tx.importEvidence.deleteMany({ where })).count,
        importRows: (await tx.importRow.updateMany({ where: { ...where, OR: [{ payloadCipher: { not: null } }, { digest: { not: null } }] }, data: { payloadCipher: null, digest: null } })).count };
      await invalidateSubmissionCaches(tx, job.tenantId, job.submissionId, job.files.map(file => file.id), new Date());
      await tx.destructionRequest.updateMany({ where, data: { reasonCipher: null, decisionCipher: null, version: { increment: 1 } } });
      const evidence = { id: randomUUID(), ...where, serviceId: job.serviceId, requestId: job.id,
        scope: "active-database-and-private-storage", method: "database-delete-and-encrypted-object-unlink",
        counts, version: 1, completedAt: new Date() };
      await tx.destructionCertificate.create({ data: { ...evidence, digest: certificateDigest(evidence) } });
      await tx.submission.update({ where: { id: job.submissionId }, data: { status: "destroyed", version: { increment: 1 } } });
      await tx.destructionRequest.update({ where: { id: job.id }, data: { status: "completed", completedAt: evidence.completedAt,
        leaseOwner: null, leaseUntil: null, lastError: null, nextAttemptAt: null, version: { increment: 1 } } });
      await systemAudit(tx, job.tenantId, job.serviceId, job.id, "destruction.completed", workerId);
      if (current.leaseUntil <= new Date()) throw new Error("DESTRUCTION_LEASE_EXPIRED");
    }, { timeout: 15000 });
  } catch {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${job.tenantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${job.submissionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "DestructionRequest" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.destructionRequest.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status !== "running" || current.leaseOwner !== workerId || current.attempts !== job.attempts || !current.leaseUntil || current.leaseUntil <= new Date()) return;
      await tx.destructionRequest.update({ where: { id: job.id }, data: { status: job.attempts >= job.maxAttempts ? "failed" : "retry", leaseOwner: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** job.attempts)), lastError: "DESTRUCTION_FAILED", version: { increment: 1 } } });
      await systemAudit(tx, job.tenantId, job.serviceId, job.id, "destruction.failed_attempt", workerId);
      if (current.leaseUntil <= new Date()) throw new Error("DESTRUCTION_LEASE_EXPIRED");
    }, { timeout: 15000 });
  }
  return true;
}
