import { emitNotificationEvent } from "./notifications";
import { bindSubmissionSubject } from "./subject-identity";
import { randomUUID } from "node:crypto";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { HttpError } from "./http";
import { lockFileIssuer } from "./file-access";
import { finishFileDeletion } from "./files";
import { clearImportPayloads } from "./imports";
import type { ImportJob } from "@/generated/prisma/client";
import type { ImportMapping, ImportPayload, ImportSnapshot } from "@/contracts/imports";

async function event(tx: Transaction, job: { id: string; tenantId: string; serviceId: string }, action: string, requestId: string) {
  await tx.auditEvent.create({ data: { tenantId: job.tenantId, serviceId: job.serviceId, resource: "import", resourceId: job.id,
    action, requestId, detail: {} } });
}
export type ImportWorkerScope = { tenantId: string; jobId: string };
export async function claimImport(workerId: string, now = new Date(), scope?: ImportWorkerScope) {
  return db.$transaction(async tx => {
    const candidates = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ImportJob"
      WHERE status IN ('committing','retry') AND ("leaseUntil" IS NULL OR "leaseUntil"<=${now})
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=${now}) AND "expiresAt">${now}
      AND (${scope?.tenantId ?? null}::text IS NULL OR "tenantId"=${scope?.tenantId ?? null})
      AND (${scope?.jobId ?? null}::text IS NULL OR id=${scope?.jobId ?? null})
      ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!candidates.length) return null;
    const row = await tx.importJob.findUniqueOrThrow({ where: { id: candidates[0].id } });
    const attempts = row.attempts + (row.leaseUntil ? 1 : 0);
    if (attempts >= 5) {
      await tx.importJob.update({ where: { id: row.id }, data: { status: "failed", leaseOwner: null, leaseUntil: null, lastError: "LEASE_EXHAUSTED", version: { increment: 1 } } }); return null;
    }
    return tx.importJob.update({ where: { id: row.id }, data: { status: "committing", leaseOwner: workerId,
      leaseUntil: new Date(now.getTime() + 120000), nextAttemptAt: null, attempts, leaseGeneration: { increment: 1 }, version: { increment: 1 } } });
  });
}
function ownsExecution(current: ImportJob, job: ImportJob, workerId: string) {
  return current.status === "committing" && current.leaseOwner === workerId && current.leaseGeneration === job.leaseGeneration && !!current.leaseUntil && current.leaseUntil > new Date();
}
function assertExecutionDeadline(job: ImportJob, expert: Date | null = null) {
  if (!job.leaseUntil || job.leaseUntil <= new Date()) throw new HttpError(409, "IMPORT_LEASE_EXPIRED", "처리 임대가 만료되었습니다.");
  if (job.expiresAt <= new Date()) throw new HttpError(410, "IMPORT_EXPIRED", "임시 자료가 만료되었습니다.");
  if (expert && expert <= new Date()) throw new HttpError(403, "EXPERT_SCOPE", "전문가 배정이 만료되었습니다.");
}
async function lockExecution(tx: Transaction, job: ImportJob, workerId: string, write = true) {
  const member = await tx.membership.findFirst({ where: { tenantId: job.tenantId, userId: job.committerId! } });
  if (!member) throw new HttpError(403, "IMPORT_PERMISSION_REVOKED", "반영자의 권한을 확인해주세요.");
  const issuer = await lockFileIssuer(tx, { tenantId: job.tenantId, member, user: { id: job.committerId! } }, job.serviceId, ["import.write"]);
  if (write) await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${job.id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${job.id} FOR SHARE`;
  const current = await tx.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { file: true } });
  if (!ownsExecution(current, job, workerId)) return null;
  const expert = issuer.member.accessKind === "expert" ? issuer.member.expertAssignment!.expiresAt : null;
  assertExecutionDeadline(current, expert); return { current, expert };
}
export async function runOneImport(workerId: string, now = new Date(), scope?: ImportWorkerScope) {
  const job = await claimImport(workerId, now, scope);
  if (!job) return false;
  try {
    // A complete source file also contains every successful subject. Erase it before creating any subject.
    const authorized = await db.$transaction(async tx => {
      const execution = await lockExecution(tx, job, workerId, false);
      if (!execution) return false;
      await finishFileDeletion(job.fileId, workerId);
      assertExecutionDeadline(execution.current, execution.expert); return true;
    }, { timeout: 30000 });
    if (!authorized) return true;
    await db.$transaction(async tx => {
      const execution = await lockExecution(tx, job, workerId);
      if (!execution) return;
      const { current, expert } = execution;
      if (current.file.status !== "deleted") throw new Error("SOURCE_NOT_DELETED");
      const mapping = decrypt<ImportMapping>(current.mappingCipher!), snapshot = decrypt<ImportSnapshot>(current.snapshotCipher!);
      if (!current.formVersionId) {
        const form = await tx.form.create({ data: { tenantId: job.tenantId, serviceId: job.serviceId, ownerId: job.committerId!, title: job.title, sourceType: "import", status: "archived" } });
        const version = await tx.formVersion.create({ data: { tenantId: job.tenantId, formId: form.id, title: job.title, number: 1,
          consentRequired: snapshot.purpose.lawfulBasis === "consent", consentPurpose: snapshot.purpose.purpose,
          retentionDays: snapshot.purpose.retentionDays ?? 1, maxResponses: 10000 } });
        await tx.question.createMany({ data: mapping.fields.map((f, index) => ({ tenantId: job.tenantId, formVersionId: version.id, stableKey: randomUUID(),
          label: f.name, subjectRole: f.subjectRole, type: f.subjectRole ? "단문형 답변" : f.type === "date" ? "날짜" : "장문형 답변", required: snapshot.purpose.items[index].required, order: index })) });
        await tx.formVersion.update({ where: { id: version.id }, data: { status: "published", publishedAt: new Date() } });
        await tx.importJob.update({ where: { id: job.id }, data: { formVersionId: version.id, version: { increment: 1 } } });
        current.formVersionId = version.id;
      }
      const questions = await tx.question.findMany({ where: { formVersionId: current.formVersionId }, orderBy: { order: "asc" } });
      const rows = await tx.importRow.findMany({ where: { jobId: job.id, status: "valid" }, orderBy: { rowNo: "asc" }, take: 50 });
      let imported = 0, expired = 0;
      const retentionDeadlines: Date[] = [];
      for (const row of rows) {
        const payload = decrypt<ImportPayload>(row.payloadCipher!);
        if (new Date(payload.retentionUntil) <= new Date()) {
          await tx.importRow.update({ where: { id: row.id }, data: { status: "error", errors: [{ field: "보유 종료일", code: "RETENTION", message: "반영 전에 보유 기한이 끝났습니다." }] } }); expired++; continue;
        }
        const submission = await tx.submission.create({ data: { tenantId: job.tenantId, formVersionId: current.formVersionId,
          importJobId: job.id, importRowNo: row.rowNo, retentionUntil: new Date(payload.retentionUntil), originalRetentionUntil: new Date(payload.retentionUntil) } });
        retentionDeadlines.push(submission.retentionUntil);
        await tx.answer.createMany({ data: questions.map((question, i) => ({ tenantId: job.tenantId, submissionId: submission.id,
          formVersionId: current.formVersionId!, questionId: question.id, valueCipher: encrypt(payload.values[i]), valueType: question.type })) });
        await bindSubmissionSubject(tx, submission.id, job.serviceId, questions, Object.fromEntries(questions.map((q, i) => [q.stableKey, payload.values[i]])));
        await tx.importEvidence.create({ data: { tenantId: job.tenantId, jobId: job.id, submissionId: submission.id,
          payloadCipher: encrypt({ snapshot, fieldTypes: mapping.fields.map(f => f.type), source: mapping.source, sourceStatement: mapping.sourceStatement, rowEvidence: payload.evidence,
            collectedAt: payload.collectedAt, consentAsserted: payload.consent, origin: "CSV 업로더가 제공한 수집 증거" }) } });
        if (payload.consent) await tx.consentReceipt.create({ data: { tenantId: job.tenantId, submissionId: submission.id,
          purpose: snapshot.purpose.purpose, documentHash: tokenHash(JSON.stringify(snapshot)),
          retentionDays: Math.max(1, Math.ceil((Date.parse(payload.retentionUntil) - Date.parse(payload.collectedAt)) / 86400000)),
          grantedAt: new Date(payload.collectedAt), events: { create: { type: "imported", reason: "CSV 업로더의 행별 동의 기록" } } } });
        await tx.importRow.update({ where: { id: row.id }, data: { status: "imported", submissionId: submission.id, payloadCipher: null, digest: null } });
        await tx.importRow.updateMany({ where: { jobId: job.id, duplicateOf: row.rowNo }, data: { submissionId: submission.id } });
        imported++;
      }
      const remaining = await tx.importRow.count({ where: { jobId: job.id, status: "valid" } });
      const status = remaining ? "committing" : current.invalidRows + current.skippedRows + expired > 0 ? "partialFailed" : "completed";
      await tx.importJob.update({ where: { id: job.id }, data: { status, importedRows: { increment: imported },
        validRows: { decrement: expired }, invalidRows: { increment: expired }, completedAt: remaining ? null : new Date(),
        leaseOwner: null, leaseUntil: null, attempts: 0, lastError: null, version: { increment: 1 } } });
      if (!remaining) { await event(tx, job, "import.completed", workerId); await emitNotificationEvent(tx, "import.completed", job.id); }
      assertExecutionDeadline(current, expert);
      if (retentionDeadlines.some(date => date <= new Date())) throw new HttpError(409, "IMPORT_RETENTION_EXPIRED", "반영 중 보유 기한이 끝났습니다.");
    }, { timeout: 60000 });
  } catch (error) {
    const code = error instanceof HttpError ? error.code : "IMPORT_WORKER_FAILED";
    const permanent = error instanceof HttpError && [401, 403, 404, 409, 410].includes(error.status);
    try { await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${job.tenantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.importJob.findUniqueOrThrow({ where: { id: job.id } });
      if (!ownsExecution(current, job, workerId)) return;
      await tx.importJob.update({ where: { id: job.id }, data: {
        status: permanent || current.attempts >= 4 ? "failed" : "retry", attempts: { increment: 1 }, lastError: code,
        leaseOwner: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** current.attempts)), version: { increment: 1 } } });
      await event(tx, job, "import.failed_attempt", workerId);
      if (!current.leaseUntil || current.leaseUntil <= new Date()) throw new HttpError(409, "IMPORT_LEASE_EXPIRED", "처리 임대가 만료되었습니다.");
    }); } catch (failureError) {
      if (!(failureError instanceof HttpError && failureError.code === "IMPORT_LEASE_EXPIRED")) throw failureError;
    }
  }
  return true;
}
export async function cleanupExpiredImports(now = new Date(), scope?: ImportWorkerScope) {
  return db.$transaction(async tx => {
    const jobs = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ImportJob" WHERE "expiresAt"<=${now}
      AND (${scope?.tenantId ?? null}::text IS NULL OR "tenantId"=${scope?.tenantId ?? null})
      AND (${scope?.jobId ?? null}::text IS NULL OR id=${scope?.jobId ?? null})
      AND ("headersCipher" IS NOT NULL OR "mappingCipher" IS NOT NULL OR status IN ('uploading','draft','validated','committing','retry','failed'))
      ORDER BY "expiresAt",id LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const { id } of jobs) {
      const row = await tx.importJob.findUniqueOrThrow({ where: { id }, include: { file: true } });
      await clearImportPayloads(tx, id);
      if (!["deleted", "deleting"].includes(row.file.status)) await tx.fileObject.update({ where: { id: row.fileId }, data: { status: "deleting", version: { increment: 1 } } });
      await tx.importJob.update({ where: { id }, data: { status: ["completed", "partialFailed", "archived", "cancelled"].includes(row.status) ? row.status : "expired",
        headersCipher: null, mappingCipher: null, snapshotCipher: null, leaseOwner: null, leaseUntil: null, nextAttemptAt: null, version: { increment: 1 } } });
      await event(tx, row, "import.payloads_expired", randomUUID());
    }
    return { cleaned: jobs.length };
  }, { timeout: 30000 });
}
