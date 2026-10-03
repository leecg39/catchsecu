import { createHash } from "node:crypto";
import { Prisma, type ExportJob } from "@/generated/prisma/client";
import type { ExportRecord } from "@/contracts/exports";
import { submissionFilters, type SubmissionFilters } from "@/contracts/submissions";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { activeMembershipWhere, type Context } from "./context";
import { canReadFiles, lockFileIssuer } from "./file-access";
import { lockResponseForm, lockResponseRows, responseWhere } from "./submission-query";
import { csvLine, exportBaseColumns, exportLayout, exportRowInclude, exportSourceHash, renderExportRow, type ExportLayout } from "./export-renderer";
import { fail, HttpError, requireVersion } from "./http";

export const asyncExportLimits = { rows: 100000, columns: 1000, bytes: 20 * 1024 * 1024, batch: 100, activePerMember: 5, ttlHours: 24, leaseSeconds: 60, attempts: 5 } as const;
const activeStatuses = ["queued", "processing", "ready"];
export function exportDto(row: ExportJob): ExportRecord {
  const expired = row.expiresAt <= new Date(), status = expired && activeStatuses.includes(row.status) ? "expired" : row.status;
  return { id: row.id, formId: row.formId, status, version: row.version, totalRows: row.totalRows, processedRows: row.processedRows,
    byteLength: row.byteLength, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
    errorCode: row.lastError, actions: { download: status === "ready", cancel: ["queued", "processing"].includes(status), delete: status !== "deleted" } };
}
async function event(tx: Transaction, row: ExportJob, action: string, requestId: string) {
  await tx.auditEvent.create({ data: { tenantId: row.tenantId, serviceId: row.serviceId, actorId: row.requesterId, resource: "export", resourceId: row.id,
    action, requestId, detail: { status: row.status, rowCount: row.processedRows, byteLength: row.byteLength } } });
}
export async function clearExport(tx: Transaction, row: ExportJob, status: string, code: string | null = null) {
  await tx.exportChunk.deleteMany({ where: { tenantId: row.tenantId, jobId: row.id } });
  await tx.exportSource.updateMany({ where: { tenantId: row.tenantId, jobId: row.id }, data: { sourceHash: null } });
  return tx.exportJob.update({ where: { id: row.id }, data: { status, lastError: code, filtersCipher: null, layoutCipher: null,
    requestHash: null, resultHash: null, leaseOwner: null, leaseUntil: null, version: { increment: 1 } } });
}
async function lockOwnedExport(tx: Transaction, ctx: Context, id: string, lock = true) {
  const initial = await tx.exportJob.findFirst({ where: { id, tenantId: ctx.tenantId, requesterId: ctx.user.id } });
  if (!initial) fail(404, "NOT_FOUND", "내보내기 작업을 찾을 수 없습니다.");
  await lockResponseForm(tx, ctx, initial.formId);
  if (lock) await tx.$queryRaw`SELECT id FROM "ExportJob" WHERE id=${id} FOR UPDATE`;
  let row = await tx.exportJob.findUniqueOrThrow({ where: { id } });
  if (lock && row.expiresAt <= new Date() && activeStatuses.includes(row.status)) row = await clearExport(tx, row, "expired", "EXPORT_EXPIRED");
  return row;
}
export async function createExport(ctx: Context, input: { formId: string; filters: SubmissionFilters }, key: string | null, requestId: string) {
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail(400, "IDEMPOTENCY_KEY_REQUIRED", "내보내기 요청 키가 필요합니다.");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${"export:" + ctx.tenantId + ":" + ctx.user.id},0))`;
    const form = await lockResponseForm(tx, ctx, input.formId), requestKeyHash = tokenHash(key), requestHash = tokenHash(JSON.stringify(input));
    const existing = await tx.exportJob.findUnique({ where: { tenantId_requesterId_requestKeyHash: { tenantId: ctx.tenantId, requesterId: ctx.user.id, requestKeyHash } } });
    if (existing) {
      if (!existing.requestHash || existing.expiresAt <= new Date()) fail(410, "EXPORT_EXPIRED", "이 요청 결과가 종료되었습니다. 새 작업을 요청해주세요.");
      if (existing.requestHash !== requestHash) fail(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키에 다른 검색 조건을 사용할 수 없습니다.");
      return exportDto(existing);
    }
    if (await tx.exportJob.count({ where: { tenantId: ctx.tenantId, requesterId: ctx.user.id, status: { in: ["queued", "processing"] }, expiresAt: { gt: new Date() } } }) >= asyncExportLimits.activePerMember)
      fail(409, "EXPORT_QUEUE_LIMIT", "진행 중인 내보내기가 5개입니다. 완료하거나 취소한 뒤 요청해주세요.");
    const row = await tx.exportJob.create({ data: { tenantId: ctx.tenantId, serviceId: form.serviceId, formId: form.id, requesterId: ctx.user.id,
      requestKeyHash, requestHash, filtersCipher: encrypt(input.filters), expiresAt: new Date(Date.now() + asyncExportLimits.ttlHours * 3600000) } });
    await event(tx, row, "export.requested", requestId); return exportDto(row);
  });
}
export async function listExports(ctx: Context, input: { formId: string; page: number; pageSize: number }) {
  return db.$transaction(async tx => {
    await lockResponseForm(tx, ctx, input.formId);
    const where = { tenantId: ctx.tenantId, requesterId: ctx.user.id, formId: input.formId, status: { not: "deleted" } };
    const total = await tx.exportJob.count({ where }), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const items = await tx.exportJob.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.pageSize, skip: (page - 1) * input.pageSize });
    return { items: items.map(exportDto), total, page, pageSize: input.pageSize, canCreate: true, limits: asyncExportLimits };
  });
}
export async function getExport(ctx: Context, id: string) {
  return db.$transaction(async tx => exportDto(await lockOwnedExport(tx, ctx, id)));
}
export async function changeExport(ctx: Context, id: string, version: number, remove: boolean, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockOwnedExport(tx, ctx, id); requireVersion({ version }, row);
    if (row.status === "deleted") fail(410, "EXPORT_DELETED", "삭제된 작업입니다.");
    if (!remove && !["queued", "processing"].includes(row.status)) fail(409, "EXPORT_STATE", "대기 또는 처리 중인 작업만 취소할 수 있습니다.");
    const next = await clearExport(tx, row, remove ? "deleted" : "cancelled");
    await event(tx, next, remove ? "export.deleted" : "export.cancelled", requestId); return exportDto(next);
  });
}
// Download uses the same lock order as source mutations: scope -> submissions -> job.
export async function downloadExport(ctx: Context, id: string, requestId: string) {
  const outcome = await db.$transaction(async tx => {
    const initial = await lockOwnedExport(tx, ctx, id, false);
    const refs = await tx.exportSource.findMany({ where: { tenantId: ctx.tenantId, jobId: id }, orderBy: { rowNo: "asc" } });
    await lockResponseRows(tx, ctx.tenantId, refs.map(r => r.submissionId));
    await tx.$queryRaw`SELECT id FROM "ExportJob" WHERE id=${id} FOR UPDATE`;
    const row = await tx.exportJob.findUniqueOrThrow({ where: { id } });
    if (row.expiresAt <= new Date() && activeStatuses.includes(row.status)) { await clearExport(tx, row, "expired", "EXPORT_EXPIRED"); return { error: "EXPORT_EXPIRED" }; }
    if (["queued", "processing"].includes(row.status)) return { error: "EXPORT_NOT_READY" };
    if (row.status !== "ready") return { error: "EXPORT_UNAVAILABLE" };
    const readFiles = await canReadFiles(tx, ctx, initial.serviceId);
    let changed = readFiles !== row.readFiles || refs.length !== row.totalRows;
    for (let offset = 0; offset < refs.length && !changed; offset += asyncExportLimits.batch) {
      const batch = refs.slice(offset, offset + asyncExportLimits.batch);
      const stored = await tx.submission.findMany({ where: { tenantId: ctx.tenantId, id: { in: batch.map(r => r.submissionId) } }, include: exportRowInclude });
      const rows = new Map(stored.map(r => [r.id, r]));
      changed = batch.some(ref => !rows.has(ref.submissionId) || exportSourceHash(rows.get(ref.submissionId)!, new Date()) !== ref.sourceHash);
    }
    if (changed) { await clearExport(tx, row, "invalidated", "SOURCE_CHANGED"); return { error: "EXPORT_SOURCE_CHANGED" }; }
    const chunks = await tx.exportChunk.findMany({ where: { tenantId: ctx.tenantId, jobId: id }, orderBy: { number: "asc" } });
    const csv = chunks.map(c => decrypt<string>(c.contentCipher)).join("");
    if (Buffer.byteLength(csv) !== row.byteLength || createHash("sha256").update(csv).digest("hex") !== row.resultHash) fail(500, "EXPORT_INTEGRITY", "내보내기 파일 무결성을 확인할 수 없습니다.");
    await event(tx, row, "export.downloaded", requestId); return { csv, rowCount: row.totalRows };
  }, { timeout: 60000 });
  if (outcome.error) fail(outcome.error === "EXPORT_NOT_READY" ? 409 : 410, outcome.error, outcome.error === "EXPORT_NOT_READY" ? "내보내기를 준비 중입니다." : "자료나 권한이 변경되었거나 결과가 만료됐습니다. 새 작업을 요청해주세요.");
  return { csv: outcome.csv!, rowCount: outcome.rowCount! };
}
async function workerPrincipal(tx: Transaction, job: ExportJob) {
  const initial = await tx.membership.findFirst({ where: activeMembershipWhere(job.requesterId, job.tenantId) });
  if (!initial) fail(403, "EXPORT_PERMISSION_REVOKED", "요청자의 현재 권한을 확인해주세요.");
  await lockFileIssuer(tx, { tenantId: job.tenantId, member: initial, user: { id: job.requesterId } }, job.serviceId, ["submission.read"], true);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${job.requesterId} FOR SHARE`;
  await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${job.tenantId} FOR SHARE`;
  if (initial.expertAssignmentId) {
    await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${initial.expertAssignmentId} AND "tenantId"=${job.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT "assignmentId" FROM "ExpertAssignmentService" WHERE "assignmentId"=${initial.expertAssignmentId} AND "tenantId"=${job.tenantId} FOR SHARE`;
  }
  const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(job.requesterId, job.tenantId), id: initial.id }, include: { grants: true, expertAssignment: { include: { services: true } }, tenant: { include: { policy: true } }, user: true } });
  if (!member || member.user.status !== "active" || !member.user.emailVerified || (member.tenant.policy?.requireMfa && !member.user.twoFactorEnabled)) fail(403, "EXPORT_PERMISSION_REVOKED", "요청자의 현재 권한을 확인해주세요.");
  if (member.accessKind === "expert" && (!member.expertAssignment?.services.some(s => s.serviceId === job.serviceId) || !await tx.service.count({ where: { id: job.serviceId, tenantId: job.tenantId, status: "active" } })))
    fail(403, "EXPORT_PERMISSION_REVOKED", "전문가의 현재 배정 범위를 확인해주세요.");
  return { tenantId: job.tenantId, member, user: member.user };
}
export async function claimExport(workerId: string, now = new Date(), onlyJobId?: string) {
  return db.$transaction(async tx => {
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "ExportJob" WHERE status IN ('queued','processing') AND "expiresAt">${now}
      AND ("leaseUntil" IS NULL OR "leaseUntil"<=${now}) ${onlyJobId ? Prisma.sql`AND id=${onlyJobId}` : Prisma.empty} ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!ids.length) return null;
    const row = await tx.exportJob.findUniqueOrThrow({ where: { id: ids[0].id } });
    if (row.attempts >= asyncExportLimits.attempts) { await clearExport(tx, row, "failed", "LEASE_EXHAUSTED"); return null; }
    return tx.exportJob.update({ where: { id: row.id }, data: { status: "processing", leaseOwner: workerId, leaseUntil: new Date(now.getTime() + asyncExportLimits.leaseSeconds * 1000), attempts: { increment: 1 }, version: { increment: 1 } } });
  });
}
export async function processExportClaim(job: ExportJob, workerId: string) {
  await db.$transaction(async tx => {
    const principal = await workerPrincipal(tx, job);
    await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${job.formId} AND "tenantId"=${job.tenantId} FOR SHARE`;
    if (!job.layoutCipher) {
      const filters = submissionFilters.parse(decrypt<SubmissionFilters>(job.filtersCipher!));
      const where = responseWhere({ tenantId: job.tenantId }, job.formId, filters);
      const selected = await tx.submission.findMany({ where, orderBy: [{ submittedAt: "desc" }, { id: "asc" }], select: { id: true }, take: asyncExportLimits.rows + 1 });
      if (selected.length > asyncExportLimits.rows) fail(413, "SUBMISSION_EXPORT_ROWS", "100,000건을 넘습니다. 기간 또는 상태를 좁혀주세요.");
      await lockResponseRows(tx, job.tenantId, selected.map(r => r.id));
      const rowsById = new Map<string, { id: string; formVersionId: string; retentionUntil: Date; legalHold: boolean; status: string }>();
      for (let offset = 0; offset < selected.length; offset += 1000) {
        const batch = await tx.submission.findMany({ where: { ...where, id: { in: selected.slice(offset, offset + 1000).map(r => r.id) } }, select: { id: true, formVersionId: true, retentionUntil: true, legalHold: true, status: true } });
        for (const row of batch) rowsById.set(row.id, row);
      }
      const rows = selected.flatMap(r => rowsById.has(r.id) ? [rowsById.get(r.id)!] : []);
      const layout = await exportLayout(tx, job.tenantId, job.formId, [...new Set(rows.map(r => r.formVersionId))]);
      const header = "\uFEFF" + csvLine([...exportBaseColumns, ...layout.columns.map(c => c.header)]);
      if (Buffer.byteLength(header) > asyncExportLimits.bytes) fail(413, "SUBMISSION_EXPORT_BYTES", "CSV 크기가 20MB를 넘습니다.");
      const readFiles = await canReadFiles(tx, principal, job.serviceId);
      const now = new Date(), expiresAt = new Date(rows.reduce((time, r) => !r.legalHold && r.retentionUntil > now && !["destroyed", "destroying"].includes(r.status) ? Math.min(time, r.retentionUntil.getTime()) : time, job.expiresAt.getTime()));
      await tx.$queryRaw`SELECT id FROM "ExportJob" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status !== "processing" || current.leaseOwner !== workerId || current.version !== job.version || current.leaseUntil! <= new Date()) return;
      for (let offset = 0; offset < rows.length; offset += 1000) await tx.exportSource.createMany({ data: rows.slice(offset, offset + 1000).map((r, index) => ({ tenantId: job.tenantId, jobId: job.id, submissionId: r.id, rowNo: offset + index })) });
      await tx.exportChunk.create({ data: { tenantId: job.tenantId, jobId: job.id, number: 0, contentCipher: encrypt(header), byteLength: Buffer.byteLength(header) } });
      await workerPrincipal(tx, job);
      const next = await tx.exportJob.update({ where: { id: job.id }, data: { expiresAt, layoutCipher: encrypt(layout), readFiles, totalRows: rows.length, byteLength: Buffer.byteLength(header), leaseOwner: null, leaseUntil: null, attempts: 0,
        ...(rows.length ? {} : { status: "ready", resultHash: createHash("sha256").update(header).digest("hex"), completedAt: new Date() }), version: { increment: 1 } } });
      if (!rows.length) await event(tx, next, "export.completed", workerId);
      return;
    }
    const refs = await tx.exportSource.findMany({ where: { tenantId: job.tenantId, jobId: job.id, rowNo: { gte: job.processedRows } }, orderBy: { rowNo: "asc" }, take: asyncExportLimits.batch });
    await lockResponseRows(tx, job.tenantId, refs.map(r => r.submissionId));
    const stored = await tx.submission.findMany({ where: { tenantId: job.tenantId, id: { in: refs.map(r => r.submissionId) } }, include: exportRowInclude });
    const files = stored.flatMap(r => r.files.map(f => f.id));
    if (files.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "FileObject" WHERE id IN (${Prisma.join(files)}) ORDER BY id FOR SHARE`);
    const readFiles = await canReadFiles(tx, principal, job.serviceId), rows = new Map(stored.map(r => [r.id, r]));
    await tx.$queryRaw`SELECT id FROM "ExportJob" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    if (current.status !== "processing" || current.leaseOwner !== workerId || current.version !== job.version || current.leaseUntil! <= new Date()) return;
    if (readFiles !== current.readFiles || refs.length !== Math.min(asyncExportLimits.batch, current.totalRows - current.processedRows) || stored.length !== refs.length) {
      await clearExport(tx, current, "invalidated", "SOURCE_CHANGED"); return;
    }
    const layout = decrypt<ExportLayout>(current.layoutCipher!), now = new Date(), csv = refs.map(r => renderExportRow(rows.get(r.submissionId)!, layout, readFiles, now)).join("");
    const bytes = Buffer.byteLength(csv);
    if (current.byteLength + bytes > asyncExportLimits.bytes) fail(413, "SUBMISSION_EXPORT_BYTES", "CSV 크기가 20MB를 넘습니다. 검색 조건을 좁혀주세요.");
    await tx.exportChunk.create({ data: { tenantId: job.tenantId, jobId: job.id, number: current.processedRows + 1, contentCipher: encrypt(csv), byteLength: bytes } });
    for (const ref of refs) await tx.exportSource.update({ where: { id: ref.id }, data: { sourceHash: exportSourceHash(rows.get(ref.submissionId)!, now) } });
    const done = current.processedRows + refs.length === current.totalRows;
    let resultHash: string | null = null;
    if (done) { const digest = createHash("sha256"); for (const chunk of await tx.exportChunk.findMany({ where: { jobId: job.id }, orderBy: { number: "asc" } })) digest.update(decrypt<string>(chunk.contentCipher)); resultHash = digest.digest("hex"); }
    await workerPrincipal(tx, job);
    const next = await tx.exportJob.update({ where: { id: job.id }, data: { processedRows: { increment: refs.length }, byteLength: { increment: bytes }, leaseOwner: null, leaseUntil: null, attempts: 0,
      ...(done ? { status: "ready", resultHash, completedAt: new Date() } : {}), version: { increment: 1 } } });
    if (done) await event(tx, next, "export.completed", workerId);
  }, { timeout: 60000 });
}
export async function runOneExport(workerId: string, now = new Date(), onlyJobId?: string) {
  const job = await claimExport(workerId, now, onlyJobId); if (!job) return false;
  try { await processExportClaim(job, workerId); }
  catch (error) {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ExportJob" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status !== "processing" || current.leaseOwner !== workerId || current.version !== job.version) return;
      if (error instanceof HttpError || current.attempts >= asyncExportLimits.attempts) await clearExport(tx, current, "failed", error instanceof HttpError ? error.code : "EXPORT_WORKER_FAILED");
      else await tx.exportJob.update({ where: { id: job.id }, data: { leaseOwner: null, leaseUntil: new Date(Date.now() + 1000 * 2 ** current.attempts), lastError: "EXPORT_WORKER_RETRY", version: { increment: 1 } } });
    });
  }
  return true;
}
export async function cleanupExpiredExports(now = new Date()) {
  return db.$transaction(async tx => {
    const ids = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ExportJob" WHERE "expiresAt"<=${now} AND ("filtersCipher" IS NOT NULL OR "layoutCipher" IS NOT NULL) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const { id } of ids) { const row = await tx.exportJob.findUniqueOrThrow({ where: { id } }); await clearExport(tx, row, "expired", "EXPORT_EXPIRED"); }
    return ids.length;
  });
}
