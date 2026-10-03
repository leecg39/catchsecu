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
import { lockFileContext } from "./file-access";
import { requireFileScanner } from "./file-scanner";
import { privateFiles } from "./file-storage";
import { idempotent } from "./idempotency";
import { parseImportCsv, checkImportMapping, validateImportRows, encodeErrorCsv } from "./import-csv";

export const importQuery = listQuery.extend({ serviceId: z.uuid(), status: z.string().max(30).optional() });
export const importRowsQuery = listQuery.extend({ errorsOnly: z.enum(["true", "false"]).default("false") });
export const importInclude = { file: true, formVersion: { select: { formId: true } } };
type Stored = Prisma.ImportJobGetPayload<{ include: typeof importInclude }>;
export function importDto(row: Stored): ImportJobRecord {
  const alive = row.expiresAt > new Date() && !["cancelled", "expired", "archived"].includes(row.status);
  return { id: row.id, title: row.title, serviceId: row.serviceId, fileId: row.fileId, status: row.status, version: row.version,
    totalRows: row.totalRows, validRows: row.validRows, invalidRows: row.invalidRows, skippedRows: row.skippedRows, importedRows: row.importedRows,
    headers: alive && row.headersCipher ? decrypt<string[]>(row.headersCipher) : [],
    mapping: alive && row.mappingCipher ? decrypt<ImportMapping>(row.mappingCipher) : null,
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), lastError: row.lastError,
    formId: row.formVersion?.formId ?? null, fileStatus: row.file.status,
    fileName: row.file.nameCipher ? decrypt<string>(row.file.nameCipher) : "원본 삭제됨", encoding: row.file.encoding };
}
export async function lockImport(tx: Transaction, ctx: Context, id: string, write = false) {
  const initial = await tx.importJob.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { serviceId: true } });
  if (!initial) fail(404, "NOT_FOUND", "가져오기 작업을 찾을 수 없습니다.");
  await lockFileContext(tx, ctx, initial.serviceId, [write ? "import.write" : "import.read"], !write);
  if (write) await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ImportJob" WHERE id=${id} FOR SHARE`;
  return tx.importJob.findUniqueOrThrow({ where: { id }, include: importInclude });
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
  return idempotent("import:create:" + ctx.member.id, key, input, async tx => {
    await reserveQuota(tx, ctx.tenantId, input.size);
    await lockFileContext(tx, ctx, input.serviceId, ["import.write"]);
    const expiresAt = new Date(Date.now() + 86400000);
    const file = await tx.fileObject.create({ data: { ...fileData(input), expiresAt, encoding: input.encoding,
      tenantId: ctx.tenantId, serviceId: input.serviceId, ownerId: ctx.user.id, ownerKind: "import" } });
    const row = await tx.importJob.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId,
      creatorId: ctx.user.id, title: input.title, fileId: file.id, expiresAt }, include: importInclude });
    await audit(tx, ctx, requestId, "import.created", "import", row.id, [], input.serviceId);
    return { status: 201, body: importDto(row), resource: { tenantId: ctx.tenantId, resourceType: "file" as const, resourceId: file.id } };
  }, tx => lockFileContext(tx, ctx, input.serviceId, ["import.write"]));
}
export async function listImports(ctx: Context, query: z.infer<typeof importQuery>, requestId: string) {
  return db.$transaction(async tx => {
    await lockFileContext(tx, ctx, query.serviceId, ["import.read"], true);
    const where = { tenantId: ctx.tenantId, serviceId: query.serviceId,
      ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}), ...(query.status ? { status: query.status } : {}) };
    const rows = await tx.importJob.findMany({ where, include: importInclude, skip: (query.page - 1) * query.pageSize,
      take: query.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    const total = await tx.importJob.count({ where });
    await audit(tx, ctx, requestId, "import.list_viewed", "import", undefined, [], query.serviceId);
    return { items: rows.map(importDto), total, page: query.page, pageSize: query.pageSize };
  });
}
export async function getImport(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id);
    await audit(tx, ctx, requestId, "import.viewed", "import", id, [], row.serviceId);
    return importDto(row);
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
  return db.$transaction(async tx => { await lockFileContext(tx, ctx, serviceId, ["import.read"]); return options(tx, ctx.tenantId, serviceId); });
}
async function snapshot(tx: Transaction, row: ImportJob, mapping: ImportMapping): Promise<ImportSnapshot> {
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
  return parseImportCsv(await privateFiles.read(file.storageKey), file.encoding);
}
export async function inspectImport(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id, true); requireVersion({ version }, row); requireImportAlive(row);
    if (row.status !== "uploading") fail(409, "IMPORT_LOCKED", "이미 확인한 파일입니다.");
    const csv = await readImportCsv(tx, row);
    const saved = await tx.importJob.update({ where: { id }, data: { status: "draft", headersCipher: encrypt(csv.headers), totalRows: csv.rows.length, version: { increment: 1 } }, include: importInclude });
    await audit(tx, ctx, requestId, "import.inspected", "import", id, [], row.serviceId); return importDto(saved);
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
    await audit(tx, ctx, requestId, "import.configured", "import", id, [], row.serviceId); return importDto(saved);
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
    await audit(tx, ctx, requestId, "import.validated", "import", id, [], row.serviceId); return importDto(saved);
  }, { timeout: 60000 });
}
export async function commitImport(ctx: Context, id: string, version: number, requestId: string, retry = false) {
  return db.$transaction(async tx => {
    const row = await lockImport(tx, ctx, id, true); requireVersion({ version }, row); requireImportAlive(row);
    if (row.status !== (retry ? "failed" : "validated") || !row.validRows || !row.mappingCipher)
      fail(409, "IMPORT_NOT_VALIDATED", "반영할 정상 행을 검증한 뒤 요청해주세요.");
    const current = await snapshot(tx, row, decrypt<ImportMapping>(row.mappingCipher));
    if (current.purpose.version !== row.purposeVersion || (current.recipient?.version ?? null) !== row.sourceRecipientVersion)
      fail(409, "IMPORT_CATALOG_CHANGED", "수집 근거가 변경되었습니다. 다시 검증해주세요.");
    if (!retry) {
      await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${row.fileId} FOR UPDATE`;
      const file = await tx.fileObject.findUniqueOrThrow({ where: { id: row.fileId } });
      if (file.status !== "ready" || file.scanStatus !== "clean") fail(409, "IMPORT_FILE_NOT_READY", "원본 파일 상태를 확인해주세요.");
      await tx.fileObject.update({ where: { id: row.fileId }, data: { status: "deleting", version: { increment: 1 } } });
    }
    const saved = await tx.importJob.update({ where: { id }, data: { status: "committing", committerId: ctx.user.id,
      startedAt: row.startedAt ?? new Date(), leaseOwner: null, leaseUntil: null, nextAttemptAt: null, attempts: 0, lastError: null, version: { increment: 1 } }, include: importInclude });
    await audit(tx, ctx, requestId, retry ? "import.retried" : "import.commit_requested", "import", id, [], row.serviceId); return importDto(saved);
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
    await audit(tx, ctx, requestId, "import.cleaned", "import", id, [], row.serviceId); return importDto(saved);
  });
}
async function safeRows(tx: Transaction, row: ImportJob, query: z.infer<typeof importRowsQuery>, all = false) {
  requireImportAlive(row);
  const where = { tenantId: row.tenantId, jobId: row.id, ...(query.errorsOnly === "true" ? { status: { in: ["error", "duplicate"] } } : {}) };
  const rows = await tx.importRow.findMany({ where, orderBy: { rowNo: "asc" }, ...(all ? {} : { skip: (query.page - 1) * query.pageSize, take: query.pageSize }) });
  const ids = [...new Set(rows.flatMap(r => r.submissionId ? [r.submissionId] : []))].sort();
  for (const id of ids) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} FOR SHARE`;
  const submissions = await tx.submission.findMany({ where: { id: { in: ids } } });
  return { rows: rows.map(r => ({ ...r, payload: r.payloadCipher && (!r.submissionId || submissions.some(s => s.id === r.submissionId && submissionDataAvailable(s))) ? decrypt<ImportPayload>(r.payloadCipher) : null })),
    total: await tx.importRow.count({ where }) };
}
export async function previewImport(ctx: Context, id: string, query: z.infer<typeof importRowsQuery>, requestId: string): Promise<ImportPreview> {
  return db.$transaction(async tx => {
    const job = await lockImport(tx, ctx, id), result = await safeRows(tx, job, query);
    await audit(tx, ctx, requestId, "import.previewed", "import", id, [], job.serviceId);
    return { items: result.rows.map(r => ({ rowNo: r.rowNo, lineNo: r.lineNo, status: r.status,
      values: r.payload?.raw ?? null, errors: r.errors as ImportRowError[] })), total: result.total, page: query.page, pageSize: query.pageSize };
  });
}
export async function importErrorsCsv(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => {
    const job = await lockImport(tx, ctx, id), result = await safeRows(tx, job, importRowsQuery.parse({ errorsOnly: "true" }), true);
    await audit(tx, ctx, requestId, "import.errors_downloaded", "import", id, [], job.serviceId);
    return encodeErrorCsv(job.headersCipher ? decrypt<string[]>(job.headersCipher) : [], result.rows.flatMap(r => r.payload ? [{ raw: r.payload.raw, rowNo: r.rowNo, errors: r.errors as ImportRowError[] }] : []));
  }, { timeout: 30000 });
}
