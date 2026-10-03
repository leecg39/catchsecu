import { z } from "zod";
import type { ImportJob, Prisma } from "@/generated/prisma/client";
import type { ImportCreate, ImportJobRecord, ImportMapping, ImportOptions, ImportPayload, ImportPreview, ImportRowError, ImportSnapshot } from "@/contracts/imports";
import { purposeInput, recipientInput } from "@/contracts/processing-catalog";
import { submissionDataAvailable } from "@/contracts/destruction";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { encrypt, decrypt } from "./crypto";
import { fail, listQuery, requireVersion } from "./http";
import { audit } from "./audit";
import { fileData, reserveQuota } from "./files";
import { lockFileContext, assertFileDeadlines } from "./file-access";
import { roleCan } from "./permissions";
import { requireFileScanner } from "./file-scanner";
import { privateFiles } from "./file-storage";
import { idempotent } from "./idempotency";
import { parseImportCsv, checkImportMapping, validateImportRows, encodeErrorCsv } from "./import-csv";

export const importQuery = listQuery.extend({ serviceId: z.uuid(), status: z.enum(["uploading", "draft", "validated", "committing", "retry", "failed", "completed", "partialFailed", "cancelled", "expired", "archived"]).optional() }).strict();
export const importRowsQuery = listQuery.pick({ page: true, pageSize: true }).extend({ errorsOnly: z.enum(["true", "false"]).default("false") }).strict();
export function importRequestQuery(request: Request) {
  const result: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(result, key)) fail(422, "DUPLICATE_QUERY", "같은 검색 조건을 여러 번 지정할 수 없습니다.");
    result[key] = value;
  }
  return result;
}
export function emptyImportQuery(request: Request) { z.object({}).strict().parse(importRequestQuery(request)); }
export const importInclude = { file: true, formVersion: { select: { formId: true } } };
type Stored = Prisma.ImportJobGetPayload<{ include: typeof importInclude }>;
export function importDto(row: Stored, canWrite = false): ImportJobRecord {
  const alive = row.expiresAt > new Date() && !["cancelled", "expired", "archived"].includes(row.status);
  const editable = alive && canWrite && ["draft", "validated"].includes(row.status);
  const fileReady = row.file.status === "ready" && row.file.scanStatus === "clean" && !!row.file.expiresAt && row.file.expiresAt > new Date();
  return { id: row.id, title: row.title, serviceId: row.serviceId, fileId: row.fileId, status: row.status, version: row.version,
    totalRows: row.totalRows, validRows: row.validRows, invalidRows: row.invalidRows, skippedRows: row.skippedRows, importedRows: row.importedRows,
    headers: alive && row.headersCipher ? decrypt<string[]>(row.headersCipher) : [],
    mapping: alive && row.mappingCipher ? decrypt<ImportMapping>(row.mappingCipher) : null,
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), lastError: row.lastError,
    formId: row.formVersion?.formId ?? null, fileStatus: row.file.status,
    fileName: alive && row.file.expiresAt && row.file.expiresAt > new Date() && row.file.nameCipher ? decrypt<string>(row.file.nameCipher) : "원본 삭제됨", encoding: row.file.encoding,
    permissions: { canEdit: editable, canInspect: alive && canWrite && row.status === "uploading" && fileReady,
      canValidate: editable && !!row.mappingCipher && fileReady, canCommit: alive && canWrite && row.status === "validated" && row.validRows > 0 && fileReady,
      canRetry: alive && canWrite && row.status === "failed" && row.validRows > row.importedRows,
      canClean: alive && canWrite && !["committing", "retry"].includes(row.status) } };
}
async function importAccess(tx: Transaction, ctx: Context, serviceId: string, write = false) {
  const deadlines = await lockFileContext(tx, ctx, serviceId, [write ? "import.write" : "import.read"], !write);
  const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, include: { grants: true } });
  const service = await tx.service.findUniqueOrThrow({ where: { id: serviceId } });
  const canWrite = service.status === "active" && roleCan(member.role, "import.write") &&
    (["owner", "admin"].includes(member.role) || member.grants.some(g => g.serviceId === serviceId && g.capabilities.includes("import.write")));
  return { deadlines, canWrite };
}
function finishImport(row: ImportJob & { access: Awaited<ReturnType<typeof importAccess>> }, alive = true) {
  assertFileDeadlines(row.access.deadlines);
  if (alive) requireImportAlive(row);
}
export async function lockImport(tx: Transaction, ctx: Context, id: string, write = false) {
  const initial = await tx.importJob.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { serviceId: true } });
  if (!initial) fail(404, "NOT_FOUND", "가져오기 작업을 찾을 수 없습니다.");
  const access = await importAccess(tx, ctx, initial.serviceId, write);
  if (write) await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${id} FOR SHARE`;
  const row = await tx.importJob.findUniqueOrThrow({ where: { id }, include: importInclude });
  assertFileDeadlines(access.deadlines);
  return { ...row, access };
}
export function requireImportAlive(row: ImportJob) {
  if (row.expiresAt <= new Date() || ["cancelled", "expired", "archived"].includes(row.status))
    fail(410, "IMPORT_EXPIRED", "임시 자료의 보관 기간이 끝났습니다. 새 파일로 작업을 시작해주세요.");
}
function editable(row: ImportJob, version: number) {
  requireVersion({ version }, row); requireImportAlive(row);
  if (!["draft", "validated"].includes(row.status)) fail(409, "IMPORT_LOCKED", "이 상태에서는 설정을 변경할 수 없습니다.");
}
export async function createImport(ctx: Context, input: ImportCreate, key: string | null, requestId: string) {
  await requireFileScanner();
  const scope = "import:create:" + ctx.member.id;
  let access: Awaited<ReturnType<typeof importAccess>>, current: Stored;
  return idempotent(scope, key, input, async tx => {
    await reserveQuota(tx, ctx.tenantId, input.size);
    access = await importAccess(tx, ctx, input.serviceId, true);
    const expiresAt = new Date(Date.now() + 86400000);
    const file = await tx.fileObject.create({ data: { ...fileData(input), expiresAt, encoding: input.encoding,
      tenantId: ctx.tenantId, serviceId: input.serviceId, ownerId: ctx.user.id, ownerKind: "import" } });
    const row = await tx.importJob.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId,
      creatorId: ctx.user.id, title: input.title, fileId: file.id, expiresAt }, include: importInclude });
    await audit(tx, ctx, requestId, "import.created", "import", row.id, [], input.serviceId);
    current = row;
    return { status: 201, body: importDto(row, access.canWrite), resource: { tenantId: ctx.tenantId, resourceType: "file" as const, resourceId: file.id } };
  }, async tx => {
    const record = await tx.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope, key: key! } } });
    const saved = await lockImport(tx, ctx, decrypt<ImportJobRecord>(record.responseCipher!).id, true);
    access = saved.access; current = saved; requireImportAlive(saved);
  }, async () => importDto(current, access.canWrite), async () => {
    assertFileDeadlines(access.deadlines); requireImportAlive(current);
  });
}
export async function listImports(ctx: Context, query: z.infer<typeof importQuery>, requestId: string) {
  return db.$transaction(async tx => {
    const access = await importAccess(tx, ctx, query.serviceId);
    const where = { tenantId: ctx.tenantId, serviceId: query.serviceId,
      ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" as const } }, { id: { contains: query.search, mode: "insensitive" as const } }] } : {}), ...(query.status ? { status: query.status } : {}) };
    const total = await tx.importJob.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.importJob.findMany({ where, include: importInclude, skip: (page - 1) * query.pageSize,
      take: query.pageSize, orderBy: [query.sort === "name" ? { title: query.direction } : { createdAt: query.direction }, { id: "asc" }] });
    await audit(tx, ctx, requestId, "import.list_viewed", "import", undefined, [], query.serviceId);
    assertFileDeadlines(access.deadlines);
    return { items: rows.map(row => importDto(row, access.canWrite)), total, page, pageSize: query.pageSize };
  }, { isolationLevel: "RepeatableRead" });
}
export async function getImport(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id);
    await audit(tx, ctx, requestId, "import.viewed", "import", id, [], row.serviceId);
    finishImport(row, false); return importDto(row, row.access.canWrite);
  });
}
async function options(tx: Transaction, tenantId: string, serviceId: string): Promise<ImportOptions> {
  const purposes = await tx.processingPurpose.findMany({ where: { tenantId, serviceId, status: "active" }, include: { recipients: true }, orderBy: { name: "asc" } });
  const recipients = await tx.recipient.findMany({ where: { tenantId, serviceId, status: "active", kind: "source" }, orderBy: { name: "asc" } });
  const select = (value: object, keys: string[]) => Object.fromEntries(keys.map(key => [key, (value as Record<string, unknown>)[key]]));
  return { purposes: purposes.map(row => ({ ...purposeInput.parse({ ...select(row, Object.keys(purposeInput.shape).filter(k => k !== "recipientIds")), recipientIds: row.recipients.map(r => r.recipientId) }), id: row.id, version: row.version })),
    recipients: recipients.map(row => ({ ...recipientInput.parse(select(row, Object.keys(recipientInput.shape))), id: row.id, version: row.version })) };
}
export async function importOptions(ctx: Context, serviceId: string) {
  return db.$transaction(async tx => { const access = await importAccess(tx, ctx, serviceId);
    const result = await options(tx, ctx.tenantId, serviceId); assertFileDeadlines(access.deadlines); return result; });
}
async function snapshot(tx: Transaction, row: ImportJob, mapping: ImportMapping): Promise<ImportSnapshot> {
  await tx.$queryRaw`SELECT id FROM "ProcessingPurpose" WHERE id=${mapping.purposeId} AND "tenantId"=${row.tenantId} FOR SHARE`;
  if (mapping.sourceRecipientId) await tx.$queryRaw`SELECT id FROM "Recipient" WHERE id=${mapping.sourceRecipientId} AND "tenantId"=${row.tenantId} FOR SHARE`;
  const available = await options(tx, row.tenantId, row.serviceId);
  const purpose = available.purposes.find(p => p.id === mapping.purposeId), recipient = available.recipients.find(r => r.id === mapping.sourceRecipientId) ?? null;
  if (!purpose || (mapping.source === "third_party" && !recipient)) fail(422, "IMPORT_CATALOG", "같은 서비스의 사용 중인 수집 목적과 원자료 제공자를 선택해주세요.");
  return { purpose, recipient };
}
export async function readImportCsv(tx: Transaction, row: Stored) {
  await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${row.fileId} FOR SHARE`;
  const file = await tx.fileObject.findUniqueOrThrow({ where: { id: row.fileId } });
  if (file.status !== "ready" || file.scanStatus !== "clean" || !file.expiresAt || file.expiresAt <= new Date())
    fail(409, "IMPORT_FILE_NOT_READY", "파일 업로드와 안전 검사를 먼저 완료해주세요.");
  const bytes = await privateFiles.read(file.storageKey);
  if (file.expiresAt <= new Date()) fail(410, "IMPORT_EXPIRED", "임시 자료의 보관 기간이 끝났습니다.");
  return parseImportCsv(bytes, file.encoding);
}
export async function inspectImport(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id, true); requireVersion({ version }, row); requireImportAlive(row);
    if (row.status !== "uploading") fail(409, "IMPORT_LOCKED", "이미 확인한 파일입니다.");
    const csv = await readImportCsv(tx, row);
    const saved = await tx.importJob.update({ where: { id }, data: { status: "draft", headersCipher: encrypt(csv.headers), totalRows: csv.rows.length, version: { increment: 1 } }, include: importInclude });
    await audit(tx, ctx, requestId, "import.inspected", "import", id, [], row.serviceId); finishImport(row); return importDto(saved, row.access.canWrite);
  }, { timeout: 30000 });
}
export async function updateImport(ctx: Context, id: string, version: number, mapping: ImportMapping, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id, true); editable(row, version);
    const captured = await snapshot(tx, row, mapping); checkImportMapping(mapping, decrypt<string[]>(row.headersCipher!), captured);
    await tx.importRow.deleteMany({ where: { jobId: id } });
    const saved = await tx.importJob.update({ where: { id }, data: { purposeId: mapping.purposeId, sourceRecipientId: mapping.sourceRecipientId,
      mappingCipher: encrypt(mapping), snapshotCipher: null, purposeVersion: null, sourceRecipientVersion: null,
      status: "draft", validRows: 0, invalidRows: 0, skippedRows: 0, version: { increment: 1 } }, include: importInclude });
    await audit(tx, ctx, requestId, "import.configured", "import", id, [], row.serviceId); finishImport(row); return importDto(saved, row.access.canWrite);
  });
}
export async function validateImport(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id, true); editable(row, version);
    if (!row.mappingCipher) fail(422, "IMPORT_MAPPING_REQUIRED", "컬럼과 수집 근거를 먼저 설정해주세요.");
    const mapping = decrypt<ImportMapping>(row.mappingCipher), captured = await snapshot(tx, row, mapping);
    const validated = validateImportRows(await readImportCsv(tx, row), mapping, captured);
    await tx.importRow.deleteMany({ where: { jobId: id } });
    for (let i = 0; i < validated.length; i += 100) await tx.importRow.createMany({ data: validated.slice(i, i + 100).map(r => ({
      tenantId: row.tenantId, jobId: id, rowNo: r.rowNo, lineNo: r.lineNo, status: r.status, payloadCipher: encrypt(r.payload),
      digest: r.digest, errors: r.errors, duplicateOf: r.duplicateOf })) });
    const saved = await tx.importJob.update({ where: { id }, data: { status: "validated", snapshotCipher: encrypt(captured),
      purposeVersion: captured.purpose.version, sourceRecipientVersion: captured.recipient?.version ?? null,
      totalRows: validated.length, validRows: validated.filter(r => r.status === "valid").length,
      invalidRows: validated.filter(r => r.status === "error").length, skippedRows: validated.filter(r => r.status === "duplicate").length,
      version: { increment: 1 } }, include: importInclude });
    await audit(tx, ctx, requestId, "import.validated", "import", id, [], row.serviceId); finishImport(row); return importDto(saved, row.access.canWrite);
  }, { timeout: 60000 });
}
export async function commitImport(ctx: Context, id: string, version: number, requestId: string, retry = false) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id, true); requireVersion({ version }, row); requireImportAlive(row);
    if (row.status !== (retry ? "failed" : "validated") || row.validRows <= row.importedRows || !row.mappingCipher)
      fail(409, "IMPORT_NOT_VALIDATED", "반영할 정상 행을 검증한 뒤 요청해주세요.");
    const current = await snapshot(tx, row, decrypt<ImportMapping>(row.mappingCipher));
    if (current.purpose.version !== row.purposeVersion || (current.recipient?.version ?? null) !== row.sourceRecipientVersion)
      fail(409, "IMPORT_CATALOG_CHANGED", "수집 근거가 변경되었습니다. 다시 검증해주세요.");
    if (!retry) {
      await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${row.fileId} FOR UPDATE`;
      const file = await tx.fileObject.findUniqueOrThrow({ where: { id: row.fileId } });
      if (file.status !== "ready" || file.scanStatus !== "clean" || !file.expiresAt || file.expiresAt <= new Date()) fail(409, "IMPORT_FILE_NOT_READY", "원본 파일 상태를 확인해주세요.");
      await tx.fileObject.update({ where: { id: row.fileId }, data: { status: "deleting", version: { increment: 1 } } });
    }
    const saved = await tx.importJob.update({ where: { id }, data: { status: "committing", committerId: ctx.user.id,
      startedAt: row.startedAt ?? new Date(), leaseOwner: null, leaseUntil: null, nextAttemptAt: null, attempts: 0, lastError: null, version: { increment: 1 } }, include: importInclude });
    await audit(tx, ctx, requestId, retry ? "import.retried" : "import.commit_requested", "import", id, [], row.serviceId); finishImport(row); return importDto(saved, row.access.canWrite);
  });
}
export async function clearImportPayloads(tx: Transaction, id: string) {
  await tx.importRow.updateMany({ where: { jobId: id, OR: [{ payloadCipher: { not: null } }, { digest: { not: null } }] }, data: { payloadCipher: null, digest: null } });
}
export async function removeImport(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id, true); requireVersion({ version }, row);
    if (["committing", "retry"].includes(row.status)) fail(409, "IMPORT_RUNNING", "반영 중인 작업은 보관할 수 없습니다. 반영 후 응답 관리에서 파기를 요청해주세요.");
    if (["cancelled", "archived", "expired"].includes(row.status)) fail(409, "IMPORT_LOCKED", "이미 정리된 작업입니다.");
    await clearImportPayloads(tx, id);
    if (!["deleted", "deleting"].includes(row.file.status)) await tx.fileObject.update({ where: { id: row.fileId }, data: { status: "deleting", version: { increment: 1 } } });
    const saved = await tx.importJob.update({ where: { id }, data: { status: row.startedAt ? "archived" : "cancelled",
      headersCipher: null, mappingCipher: null, snapshotCipher: null, leaseOwner: null, leaseUntil: null, version: { increment: 1 } }, include: importInclude });
    await audit(tx, ctx, requestId, "import.cleaned", "import", id, [], row.serviceId); finishImport(row, false); return importDto(saved, row.access.canWrite);
  });
}
async function safeRows(tx: Transaction, row: ImportJob, query: z.infer<typeof importRowsQuery>, all = false) {
  requireImportAlive(row);
  const where = { tenantId: row.tenantId, jobId: row.id, ...(query.errorsOnly === "true" ? { status: { in: ["error", "duplicate"] } } : {}) };
  const total = await tx.importRow.count({ where }), page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
  const rows = await tx.importRow.findMany({ where, orderBy: { rowNo: "asc" }, ...(all ? {} : { skip: (page - 1) * query.pageSize, take: query.pageSize }) });
  const ids = [...new Set(rows.flatMap(r => r.submissionId ? [r.submissionId] : []))].sort();
  for (const id of ids) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} FOR SHARE`;
  const submissions = await tx.submission.findMany({ where: { id: { in: ids } } });
  return { rows, submissions, total, page };
}
function readableImportRows(result: Awaited<ReturnType<typeof safeRows>>) {
  return result.rows.map(r => ({ ...r, payload: r.payloadCipher && (!r.submissionId || result.submissions.some(s => s.id === r.submissionId && submissionDataAvailable(s))) ? decrypt<ImportPayload>(r.payloadCipher) : null }));
}
export async function previewImport(ctx: Context, id: string, query: z.infer<typeof importRowsQuery>, requestId: string): Promise<ImportPreview> {
  return db.$transaction(async tx => {
    const job = await lockImport(tx, ctx, id), result = await safeRows(tx, job, query);
    await audit(tx, ctx, requestId, "import.previewed", "import", id, [], job.serviceId);
    finishImport(job);
    return { items: readableImportRows(result).map(r => ({ rowNo: r.rowNo, lineNo: r.lineNo, status: r.status,
      values: r.payload?.raw ?? null, errors: r.errors as ImportRowError[] })), total: result.total, page: result.page, pageSize: query.pageSize };
  });
}
export async function importErrorsCsv(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => {
    const job = await lockImport(tx, ctx, id), result = await safeRows(tx, job, importRowsQuery.parse({ errorsOnly: "true" }), true);
    await audit(tx, ctx, requestId, "import.errors_downloaded", "import", id, [], job.serviceId);
    finishImport(job);
    return encodeErrorCsv(job.headersCipher ? decrypt<string[]>(job.headersCipher) : [], readableImportRows(result).flatMap(r => r.payload ? [{ raw: r.payload.raw, rowNo: r.rowNo, errors: r.errors as ImportRowError[] }] : []));
  }, { timeout: 30000 });
}
