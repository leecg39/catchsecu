import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { normalizedCatalogName, type PurposeInput, type RecipientInput } from "@/contracts/processing-catalog";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { currentServiceScope } from "./service-access";
import { audit } from "./audit";
import { fail, listQuery } from "./http";

export type CatalogKind = "purposes" | "recipients";
export const catalogQuery = listQuery.extend({ serviceId: z.uuid().optional(), status: z.enum(["active", "archived", "all"]).default("active") });
const recipientInclude = { service: { select: { name: true } }, _count: { select: { purposes: { where: { purpose: { status: "active" } } } } } };
const purposeInclude = { service: { select: { name: true } }, recipients: { orderBy: { recipientId: "asc" as const }, include: { recipient: { include: recipientInclude } } } };
type RecipientRow = Prisma.RecipientGetPayload<{ include: typeof recipientInclude }>;
type PurposeRow = Prisma.ProcessingPurposeGetPayload<{ include: typeof purposeInclude }>;
function recipientDto(row: RecipientRow) {
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service.name, name: row.name, kind: row.kind,
    countryCode: row.countryCode, purpose: row.purpose, items: row.items, retentionMode: row.retentionMode,
    retentionDays: row.retentionDays, retentionReason: row.retentionReason, contact: row.contact,
    transferMethod: row.transferMethod, transferTiming: row.transferTiming, refusalNotice: row.refusalNotice,
    status: row.status, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, activePurposeCount: row._count.purposes };
}
function purposeDto(row: PurposeRow) {
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service.name, name: row.name, purpose: row.purpose,
    lawfulBasis: row.lawfulBasis, basisReference: row.basisReference, items: row.items, retentionMode: row.retentionMode,
    retentionDays: row.retentionDays, retentionReason: row.retentionReason, recipientIds: row.recipients.map(link => link.recipientId),
    recipients: row.recipients.map(link => recipientDto(link.recipient)), status: row.status, version: row.version,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}
async function identity(tx: Transaction, ctx: Context, write: boolean) {
  return currentServiceScope(tx, ctx, write ? "document.write" : "document.read");
}
export async function lockCatalogService(tx: Transaction, ctx: Context, serviceId: string, write: boolean) {
  const scope = await identity(tx, ctx, write);
  // Serialize a service's catalog mutations so link changes cannot race archiving.
  if (write) await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const service = await tx.service.findFirst({ where: { AND: [scope, { id: serviceId }] } });
  if (!service) fail(403, "SERVICE_FORBIDDEN", "해당 서비스 자료에 접근할 권한이 없습니다.");
  if (write && service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스의 자료는 변경할 수 없습니다.");
}
async function locate(tx: Transaction, ctx: Context, kind: CatalogKind, id: string, write: boolean) {
  const row = kind === "purposes" ? await tx.processingPurpose.findFirst({ where: { id, tenantId: ctx.tenantId } }) :
    await tx.recipient.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "자료를 찾을 수 없습니다.");
  await lockCatalogService(tx, ctx, row.serviceId, write);
  return row.serviceId;
}
export async function listCatalog(ctx: Context, kind: CatalogKind, query: z.infer<typeof catalogQuery>) {
  return db.$transaction(async tx => {
    const service = await identity(tx, ctx, false);
    const where = { tenantId: ctx.tenantId, service, ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.status === "all" ? {} : { status: query.status }), name: { contains: query.search, mode: "insensitive" as const } };
    const paging = { orderBy: [{ [query.sort]: query.direction }, { id: "asc" as const }], take: query.pageSize, skip: (query.page - 1) * query.pageSize };
    if (kind === "purposes") {
      const items = await tx.processingPurpose.findMany({ where, ...paging, include: purposeInclude });
      const total = await tx.processingPurpose.count({ where });
      return { items: items.map(purposeDto), total, page: query.page, pageSize: query.pageSize };
    }
    const items = await tx.recipient.findMany({ where, ...paging, include: recipientInclude });
    const total = await tx.recipient.count({ where });
    return { items: items.map(recipientDto), total, page: query.page, pageSize: query.pageSize };
  });
}
async function read(tx: Transaction, kind: CatalogKind, id: string) {
  return kind === "purposes" ? purposeDto(await tx.processingPurpose.findUniqueOrThrow({ where: { id }, include: purposeInclude })) :
    recipientDto(await tx.recipient.findUniqueOrThrow({ where: { id }, include: recipientInclude }));
}
export async function readCatalog(ctx: Context, kind: CatalogKind, id: string) {
  return db.$transaction(async tx => { await locate(tx, ctx, kind, id, false); return read(tx, kind, id); });
}
async function revision(tx: Transaction, ctx: Context, kind: CatalogKind, id: string, requestId: string, action: string, fields: string[]) {
  const record = await read(tx, kind, id), snapshot = JSON.parse(JSON.stringify(record)) as Prisma.InputJsonValue;
  const data = { tenantId: ctx.tenantId, version: record.version, actorId: ctx.user.id, snapshot };
  if (kind === "purposes") await tx.purposeRevision.create({ data: { ...data, purposeId: id } });
  else await tx.recipientRevision.create({ data: { ...data, recipientId: id } });
  await audit(tx, ctx, requestId, "catalog." + action, kind === "purposes" ? "processingPurpose" : "recipient", id, fields, record.serviceId);
  return record;
}
async function recipientLinks(tx: Transaction, ctx: Context, serviceId: string, recipientIds: string[]) {
  const count = await tx.recipient.count({ where: { id: { in: recipientIds }, tenantId: ctx.tenantId, serviceId, status: "active" } });
  if (count !== recipientIds.length) fail(422, "INVALID_RECIPIENT", "같은 서비스의 사용 중인 제공·수탁자만 연결할 수 있습니다.");
}
function editable(row: { version: number; status: string }, version: number) {
  if (row.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 새로고침한 뒤 다시 시도해주세요.");
  if (row.status !== "active") fail(409, "CATALOG_ARCHIVED", "보관된 자료를 복원한 뒤 수정해주세요.");
}
export async function createPurpose(tx: Transaction, ctx: Context, input: PurposeInput, requestId: string) {
  await lockCatalogService(tx, ctx, input.serviceId, true); await recipientLinks(tx, ctx, input.serviceId, input.recipientIds);
  const { recipientIds, ...data } = input;
  const row = await tx.processingPurpose.create({ data: { ...data, tenantId: ctx.tenantId, nameKey: normalizedCatalogName(data.name) } });
  if (recipientIds.length) await tx.purposeRecipient.createMany({ data: recipientIds.map(recipientId => ({ tenantId: ctx.tenantId, serviceId: input.serviceId, purposeId: row.id, recipientId })) });
  return revision(tx, ctx, "purposes", row.id, requestId, "created", Object.keys(input));
}
export async function createRecipient(tx: Transaction, ctx: Context, input: RecipientInput, requestId: string) {
  await lockCatalogService(tx, ctx, input.serviceId, true);
  const row = await tx.recipient.create({ data: { ...input, tenantId: ctx.tenantId, nameKey: normalizedCatalogName(input.name) } });
  return revision(tx, ctx, "recipients", row.id, requestId, "created", Object.keys(input));
}
export async function updatePurpose(ctx: Context, id: string, input: PurposeInput & { version: number }, requestId: string) {
  return db.$transaction(async tx => {
    const serviceId = await locate(tx, ctx, "purposes", id, true);
    if (input.serviceId !== serviceId) fail(422, "IMMUTABLE_SERVICE", "저장한 자료를 다른 서비스로 옮길 수 없습니다.");
    const row = await tx.processingPurpose.findUniqueOrThrow({ where: { id } }); editable(row, input.version);
    await recipientLinks(tx, ctx, serviceId, input.recipientIds);
    const { version, recipientIds, ...data } = input;
    await tx.purposeRecipient.deleteMany({ where: { tenantId: ctx.tenantId, purposeId: id } });
    if (recipientIds.length) await tx.purposeRecipient.createMany({ data: recipientIds.map(recipientId => ({ tenantId: ctx.tenantId, serviceId, purposeId: id, recipientId })) });
    await tx.processingPurpose.update({ where: { id }, data: { ...data, nameKey: normalizedCatalogName(data.name), version: version + 1 } });
    return revision(tx, ctx, "purposes", id, requestId, "updated", Object.keys(data).concat("recipientIds"));
  });
}
export async function updateRecipient(ctx: Context, id: string, input: RecipientInput & { version: number }, requestId: string) {
  return db.$transaction(async tx => {
    const serviceId = await locate(tx, ctx, "recipients", id, true);
    if (input.serviceId !== serviceId) fail(422, "IMMUTABLE_SERVICE", "저장한 자료를 다른 서비스로 옮길 수 없습니다.");
    const row = await tx.recipient.findUniqueOrThrow({ where: { id } }); editable(row, input.version);
    const { version, ...data } = input;
    await tx.recipient.update({ where: { id }, data: { ...data, nameKey: normalizedCatalogName(data.name), version: version + 1 } });
    return revision(tx, ctx, "recipients", id, requestId, "updated", Object.keys(data));
  });
}
export async function changeCatalogStatus(ctx: Context, kind: CatalogKind, id: string, version: number, restore: boolean, requestId: string) {
  return db.$transaction(async tx => {
    const serviceId = await locate(tx, ctx, kind, id, true);
    const row = kind === "purposes" ? await tx.processingPurpose.findUniqueOrThrow({ where: { id }, include: purposeInclude }) :
      await tx.recipient.findUniqueOrThrow({ where: { id }, include: recipientInclude });
    if (row.version !== version) fail(409, "VERSION_CONFLICT", "자료가 변경되었습니다. 다시 불러와주세요.");
    if (row.status !== (restore ? "archived" : "active")) fail(409, "INVALID_TRANSITION", "자료 상태를 다시 확인해주세요.");
    if (kind === "recipients" && !restore && await tx.purposeRecipient.count({ where: { tenantId: ctx.tenantId, recipientId: id, purpose: { status: "active" } } }))
      fail(409, "RECIPIENT_IN_USE", "사용 중인 수집 목적의 연결을 해제하거나 목적을 보관한 뒤 처리해주세요.");
    if (kind === "purposes" && restore) {
      const links = await tx.purposeRecipient.findMany({ where: { tenantId: ctx.tenantId, purposeId: id } });
      await recipientLinks(tx, ctx, serviceId, links.map(link => link.recipientId));
    }
    const data = { status: restore ? "active" : "archived", version: version + 1 };
    if (kind === "purposes") await tx.processingPurpose.update({ where: { id }, data });
    else await tx.recipient.update({ where: { id }, data });
    return revision(tx, ctx, kind, id, requestId, restore ? "restored" : "archived", ["status"]);
  });
}
export async function catalogHistory(ctx: Context, kind: CatalogKind, id: string, query: z.infer<typeof listQuery>) {
  return db.$transaction(async tx => {
    await locate(tx, ctx, kind, id, false);
    const paging = { orderBy: { version: "desc" as const }, skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    if (kind === "purposes") {
      const where = { tenantId: ctx.tenantId, purposeId: id };
      return { items: await tx.purposeRevision.findMany({ where, ...paging }), total: await tx.purposeRevision.count({ where }), page: query.page, pageSize: query.pageSize };
    }
    const where = { tenantId: ctx.tenantId, recipientId: id };
    return { items: await tx.recipientRevision.findMany({ where, ...paging }), total: await tx.recipientRevision.count({ where }), page: query.page, pageSize: query.pageSize };
  });
}
