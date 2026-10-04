import { Prisma, type ComplianceExportJob } from "@/generated/prisma/client";
import type { z } from "zod";
import type { complianceExportInput, complianceExportList, ComplianceExportRecord } from "@/contracts/compliance-exports";
import { db, type Transaction } from "./db";
import { activeMembershipWhere, type Context } from "./context";
import { audit } from "./audit";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { assertFileDeadlines, lockFileIssuer } from "./file-access";
import { assertCompanyMfa } from "./mfa-enforcement";
import { fail, HttpError, requireVersion } from "./http";
import { authorizeComplianceClose, complianceSnapshot, renderComplianceCsv } from "./compliance-close";
import { renderPdf, sha256 } from "./pdf-renderer";
import { complianceEvidenceChecks, evidenceStatusLabels } from "@/contracts/compliance-evidence";

export const complianceExportLimits = { activePerMember: 5, ttlHours: 24, bytes: 16777216, services: 4998, leaseSeconds: 60, attempts: 5 };
const expirable = ["queued", "processing", "ready"];
function dto(row: ComplianceExportJob): ComplianceExportRecord {
  const status = row.expiresAt <= new Date() && expirable.includes(row.status) ? "expired" : row.status;
  return { id: row.id, closeId: row.closeId, format: row.format, status, version: row.version, byteLength: row.byteLength,
    pageCount: row.pageCount, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
    errorCode: row.lastError, actions: { download: status === "ready", cancel: ["queued", "processing"].includes(status), delete: status !== "deleted" } };
}
async function source(tx: Transaction, tenantId: string, id: string) {
  const row = await tx.complianceClose.findFirst({ where: { id, tenantId } });
  if (!row) fail(404, "NOT_FOUND", "마감 기록을 찾을 수 없습니다.");
  const snapshot = complianceSnapshot(row);
  if (snapshot.services.length > complianceExportLimits.services) fail(413, "EXPORT_TOO_LARGE", "출력할 서비스는 4,998개를 넘을 수 없습니다.");
  const sourceHash = sha256(JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString(), snapshot }));
  return { row, snapshot, sourceHash };
}
async function event(tx: Transaction, row: ComplianceExportJob, action: string, requestId: string, serviceKey: string) {
  await audit(tx, { tenantId: row.tenantId, user: { id: row.requesterId } }, requestId, action, "complianceExport", row.id, [], serviceKey || undefined);
}
async function clear(tx: Transaction, row: ComplianceExportJob, status: string, error: string | null = null) {
  return tx.complianceExportJob.update({ where: { id: row.id }, data: { status, resultCipher: null, resultHash: null,
    leaseOwner: null, leaseUntil: null, lastError: error, version: { increment: 1 } } });
}
async function owned(tx: Transaction, ctx: Context, id: string) {
  const initial = await tx.complianceExportJob.findFirst({ where: { id, tenantId: ctx.tenantId, requesterId: ctx.user.id, memberId: ctx.member.id } });
  if (!initial) fail(404, "NOT_FOUND", "출력 작업을 찾을 수 없습니다.");
  const currentSource = await source(tx, ctx.tenantId, initial.closeId);
  const actor = await authorizeComplianceClose(tx, ctx, currentSource.row.serviceKey);
  await tx.$queryRaw`SELECT id FROM "ComplianceExportJob" WHERE id=${id} FOR UPDATE`;
  let row = await tx.complianceExportJob.findUniqueOrThrow({ where: { id } });
  if (row.expiresAt <= new Date() && expirable.includes(row.status)) row = await clear(tx, row, "expired", "EXPORT_EXPIRED");
  return { row, actor, currentSource };
}
export async function createComplianceExport(ctx: Context, input: z.infer<typeof complianceExportInput>, key: string | null, requestId: string) {
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail(400, "IDEMPOTENCY_KEY_REQUIRED", "출력 요청 키가 필요합니다.");
  return db.$transaction(async tx => {
    const currentSource = await source(tx, ctx.tenantId, input.closeId), actor = await authorizeComplianceClose(tx, ctx, currentSource.row.serviceKey);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"compliance-export:" + ctx.member.id},0))`;
    const requestKeyHash = tokenHash(key);
    const existing = await tx.complianceExportJob.findUnique({ where: { tenantId_memberId_requestKeyHash: { tenantId: ctx.tenantId, memberId: ctx.member.id, requestKeyHash } } });
    if (existing) {
      if (existing.closeId !== input.closeId || existing.format !== input.format || existing.sourceHash !== currentSource.sourceHash)
        fail(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키로 다른 마감이나 형식을 요청할 수 없습니다.");
      if (existing.expiresAt <= new Date() || ["deleted", "cancelled"].includes(existing.status)) fail(410, "EXPORT_EXPIRED", "종료된 출력 요청입니다. 새 작업을 요청해주세요.");
      assertFileDeadlines(actor.deadlines); return dto(existing);
    }
    if (await tx.complianceExportJob.count({ where: { tenantId: ctx.tenantId, memberId: ctx.member.id, status: { in: ["queued", "processing"] }, expiresAt: { gt: new Date() } } }) >= complianceExportLimits.activePerMember)
      fail(409, "EXPORT_QUEUE_LIMIT", "진행 중인 출력 작업이 5개입니다. 완료하거나 취소한 뒤 요청해주세요.");
    const now = new Date(), expiresAt = new Date(now.getTime() + complianceExportLimits.ttlHours * 3600000);
    const row = await tx.complianceExportJob.create({ data: { tenantId: ctx.tenantId, memberId: ctx.member.id, requesterId: ctx.user.id,
      closeId: input.closeId, format: input.format, sourceHash: currentSource.sourceHash, requestKeyHash, createdAt: now, expiresAt } });
    await event(tx, row, "compliance.export_requested", requestId, currentSource.row.serviceKey);
    assertFileDeadlines(actor.deadlines); return dto(row);
  });
}
export async function listComplianceExports(ctx: Context, input: z.infer<typeof complianceExportList>) {
  return db.$transaction(async tx => {
    const currentSource = await source(tx, ctx.tenantId, input.closeId), actor = await authorizeComplianceClose(tx, ctx, currentSource.row.serviceKey);
    const where = { tenantId: ctx.tenantId, memberId: ctx.member.id, requesterId: ctx.user.id, closeId: input.closeId, status: { not: "deleted" } };
    const total = await tx.complianceExportJob.count({ where }), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const rows = await tx.complianceExportJob.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * input.pageSize, take: input.pageSize });
    assertFileDeadlines(actor.deadlines); return { items: rows.map(dto), total, page, pageSize: input.pageSize };
  });
}
export async function getComplianceExport(ctx: Context, id: string) {
  return db.$transaction(async tx => { const { row, actor } = await owned(tx, ctx, id); assertFileDeadlines(actor.deadlines); return dto(row); });
}
export async function changeComplianceExport(ctx: Context, id: string, version: number, remove: boolean, requestId: string) {
  return db.$transaction(async tx => {
    const { row, actor, currentSource } = await owned(tx, ctx, id); requireVersion({ version }, row);
    if (row.status === "deleted") fail(410, "EXPORT_DELETED", "삭제된 작업입니다.");
    if (!remove && !["queued", "processing"].includes(row.status)) fail(409, "EXPORT_STATE", "대기 또는 처리 중인 작업만 취소할 수 있습니다.");
    const next = await clear(tx, row, remove ? "deleted" : "cancelled");
    await event(tx, next, remove ? "compliance.export_deleted" : "compliance.export_cancelled", requestId, currentSource.row.serviceKey);
    assertFileDeadlines(actor.deadlines); return dto(next);
  });
}
export async function downloadComplianceExport(ctx: Context, id: string, requestId: string) {
  const result = await db.$transaction(async tx => {
    const { row, actor, currentSource } = await owned(tx, ctx, id);
    if (["queued", "processing"].includes(row.status)) return { error: "EXPORT_NOT_READY" };
    if (row.status !== "ready") return { error: "EXPORT_UNAVAILABLE" };
    if (row.sourceHash !== currentSource.sourceHash) fail(409, "EXPORT_SOURCE_CHANGED", "마감 검증 정보가 일치하지 않습니다.");
    const bytes = Buffer.from(decrypt<string>(row.resultCipher!), "base64");
    if (bytes.length !== row.byteLength || sha256(bytes) !== row.resultHash) fail(500, "EXPORT_INTEGRITY", "출력 파일의 검증 정보가 일치하지 않습니다.");
    await event(tx, row, "compliance.export_downloaded", requestId, currentSource.row.serviceKey);
    assertFileDeadlines(actor.deadlines);
    if (row.expiresAt <= new Date()) fail(410, "EXPORT_EXPIRED", "출력 파일이 만료되었습니다.");
    return { bytes: new Uint8Array(bytes), hash: row.resultHash!, sourceHash: row.sourceHash, format: row.format, filename: `compliance-${currentSource.row.month}-${id}.${row.format}` };
  });
  if (result.error) fail(result.error === "EXPORT_NOT_READY" ? 409 : 410, result.error, "파일이 준비되지 않았거나 만료됐습니다. 출력 작업 상태를 확인해주세요.");
  return result;
}
// Background processing checks issuer authority independently of the requesting
// browser session; downloads always require a fresh authenticated Context.
async function workerAuthority(tx: Transaction, job: ComplianceExportJob, serviceKey: string) {
  if (serviceKey) {
    const issuer = await lockFileIssuer(tx, { tenantId: job.tenantId, member: { id: job.memberId }, user: { id: job.requesterId } }, serviceKey, ["service.read"], false, true);
    return { expert: issuer.member.expertAssignment?.expiresAt ?? null, mfa: issuer.mfa };
  }
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${job.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${job.memberId} AND "tenantId"=${job.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${job.requesterId} FOR SHARE`;
  await tx.$queryRaw`SELECT "tenantId" FROM "SecurityPolicy" WHERE "tenantId"=${job.tenantId} FOR SHARE`;
  const member = await tx.membership.findFirst({ where: { ...activeMembershipWhere(job.requesterId, job.tenantId), id: job.memberId, accessKind: "direct", role: { in: ["owner", "admin"] } }, include: { user: true, tenant: { include: { policy: true } } } });
  if (!member || !member.user.emailVerified || member.user.status !== "active") fail(403, "EXPORT_PERMISSION_REVOKED", "요청자의 현재 권한을 확인해주세요.");
  const mfa = await assertCompanyMfa(job.tenantId, job.memberId, member.user.twoFactorEnabled, !!member.tenant.policy?.requireMfa, tx);
  return { expert: null, mfa };
}
function issuerDeadline(deadlines: { expert: Date | null; mfa: Date | null }) {
  if (deadlines.expert && deadlines.expert <= new Date()) fail(403, "EXPERT_SCOPE", "전문가 배정이 만료되었습니다.");
  if (deadlines.mfa && deadlines.mfa <= new Date()) fail(403, "MFA_REQUIRED", "인증 예외가 만료되었습니다.");
}
export async function claimComplianceExport(workerId: string, now = new Date(), onlyId?: string) {
  return db.$transaction(async tx => {
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "ComplianceExportJob" WHERE status IN ('queued','processing') AND "expiresAt">${now}
      AND ("leaseUntil" IS NULL OR "leaseUntil"<=${now}) ${onlyId ? Prisma.sql`AND id=${onlyId}` : Prisma.empty} ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!ids.length) return null;
    const row = await tx.complianceExportJob.findUniqueOrThrow({ where: { id: ids[0].id } });
    if (row.attempts >= complianceExportLimits.attempts) { await clear(tx, row, "failed", "LEASE_EXHAUSTED"); return null; }
    return tx.complianceExportJob.update({ where: { id: row.id }, data: { status: "processing", leaseOwner: workerId,
      leaseUntil: new Date(now.getTime() + complianceExportLimits.leaseSeconds * 1000), attempts: { increment: 1 }, version: { increment: 1 } } });
  });
}
function leaseMatches(current: ComplianceExportJob, claim: ComplianceExportJob, workerId: string) {
  return current.status === "processing" && current.version === claim.version && current.leaseOwner === workerId && !!current.leaseUntil && current.leaseUntil > new Date() && current.expiresAt > new Date();
}
export async function processComplianceExport(job: ComplianceExportJob, workerId: string) {
  const input = await db.$transaction(async tx => {
    const currentSource = await source(tx, job.tenantId, job.closeId);
    const deadlines = await workerAuthority(tx, job, currentSource.row.serviceKey);
    const current = await tx.complianceExportJob.findUniqueOrThrow({ where: { id: job.id } });
    if (!leaseMatches(current, job, workerId)) return null;
    if (currentSource.sourceHash !== job.sourceHash) fail(409, "EXPORT_SOURCE_CHANGED", "마감 검증 정보가 일치하지 않습니다.");
    issuerDeadline(deadlines); return currentSource;
  });
  if (!input) return;
  let bytes: Uint8Array, pageCount = 0;
  if (job.format === "csv") bytes = new Uint8Array(Buffer.from(renderComplianceCsv(input.snapshot), "utf8"));
  else {
    const s = input.snapshot;
    const text = [`개인정보 월마감 집계 ${s.month}`, `판정: 미판정 (법적 준수 통과를 의미하지 않습니다.)`,
      `범위: ${s.serviceId ? "선택 서비스" : "회사 전체"}`, `집계 저장 시각: ${input.row.createdAt.toISOString()}`,
      `접수·파기 기간: ${s.period.from} 이상 ${s.period.to} 미만`,
      `서비스 ${s.totals.services}개 / 폼 ${s.totals.forms}개 / 동의서 ${s.totals.consentDocuments}개 / 처리방침 ${s.totals.policyDocuments}개`,
      `보유 응답 ${s.totals.retainedSubmissions}건 / 기간 접수 ${s.totals.periodSubmissions}건 / 기간 파기 ${s.totals.periodDestructions}건`,
      "보유·문서 건수는 마감 저장 당시의 현황이며 과거 월말 상태를 복원한 값이 아닙니다.", "", "서비스별 집계",
      ...s.services.map(service => `${service.name}\n보유 ${service.retainedSubmissions}건 / 기간 접수 ${service.periodSubmissions}건`),
      ...(s.evidence ? ["", "저장된 점검 근거", `점검 시각: ${s.evidence.checkedAt}`, `근거 해시: ${s.evidence.hash}`,
        "조건 확인은 법적 준수 판정이 아닙니다. 점검은 마감 저장 당시의 데이터이며 과거 월말 복원이 아닙니다.",
        ...complianceEvidenceChecks(s.evidence).map(check => `${check.category} · ${check.title} · ${evidenceStatusLabels[check.status]}\n${check.detail}\n원천: ${check.source}`)] : [])].join("\n");
    const pdf = await renderPdf({ title: `월마감 집계 ${s.month}`, author: "Catchsecu", text, contentHash: job.sourceHash,
      version: 1, publishedAt: input.row.createdAt, label: "월마감 집계 · 미판정" });
    bytes = pdf.bytes; pageCount = pdf.pageCount;
  }
  if (bytes.length > complianceExportLimits.bytes) fail(413, "EXPORT_TOO_LARGE", "출력 파일이 16MB를 넘습니다.");
  await db.$transaction(async tx => {
    const currentSource = await source(tx, job.tenantId, job.closeId), deadlines = await workerAuthority(tx, job, currentSource.row.serviceKey);
    await tx.$queryRaw`SELECT id FROM "ComplianceExportJob" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.complianceExportJob.findUniqueOrThrow({ where: { id: job.id } });
    if (!leaseMatches(current, job, workerId)) return;
    if (currentSource.sourceHash !== job.sourceHash) fail(409, "EXPORT_SOURCE_CHANGED", "마감 검증 정보가 일치하지 않습니다.");
    const next = await tx.complianceExportJob.update({ where: { id: job.id }, data: { status: "ready", resultCipher: encrypt(Buffer.from(bytes).toString("base64")),
      resultHash: sha256(bytes), byteLength: bytes.length, pageCount, completedAt: new Date(), lastError: null, leaseOwner: null, leaseUntil: null, version: { increment: 1 } } });
    await event(tx, next, "compliance.export_completed", workerId, currentSource.row.serviceKey);
    issuerDeadline(deadlines);
    if (current.expiresAt <= new Date() || current.leaseUntil! <= new Date()) fail(409, "EXPORT_LEASE_EXPIRED", "출력 작업 임대가 만료되었습니다.");
  }, { timeout: 15000 });
}
export async function runOneComplianceExport(workerId: string, now = new Date(), onlyId?: string) {
  const job = await claimComplianceExport(workerId, now, onlyId); if (!job) return false;
  try { await processComplianceExport(job, workerId); }
  catch (error) {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ComplianceExportJob" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.complianceExportJob.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status !== "processing" || current.version !== job.version || current.leaseOwner !== workerId) return;
      if (error instanceof HttpError || current.attempts >= complianceExportLimits.attempts) await clear(tx, current, "failed", error instanceof HttpError ? error.code : "EXPORT_WORKER_FAILED");
      else await tx.complianceExportJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() + 1000 * 2 ** current.attempts), lastError: "EXPORT_WORKER_RETRY", version: { increment: 1 } } });
    });
  }
  return true;
}
export async function cleanupComplianceExports(now = new Date(), onlyId?: string) {
  return db.$transaction(async tx => {
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "ComplianceExportJob" WHERE "expiresAt"<=${now} AND status IN ('queued','processing','ready') ${onlyId ? Prisma.sql`AND id=${onlyId}` : Prisma.empty} ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const { id } of ids) { const row = await tx.complianceExportJob.findUniqueOrThrow({ where: { id } }); await clear(tx, row, "expired", "EXPORT_EXPIRED"); }
    return ids.length;
  });
}
