import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { documentTypes, documentType, emptyDisplay, type DocumentInput, type ClauseInput, type DisplayInput, type DisplayKind, type DocumentSnapshot, type PublicPurpose, type PublicRecipient } from "@/contracts/documents";
import { basisLabels, itemKinds, recipientKinds } from "@/contracts/processing-catalog";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { roleCan, type Capability } from "./permissions";
import { currentServiceScope } from "./service-access";
import { audit } from "./audit";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { fail, listQuery, requireVersion } from "./http";

export const documentQuery = listQuery.omit({ sort: true, direction: true }).extend({ serviceId: z.uuid().optional(), type: documentType.optional(), status: z.enum(["all", "draft", "published", "private", "archived"]).default("all") });
export const clauseQuery = documentQuery.omit({ status: true }).extend({ status: z.enum(["active", "archived", "all"]).default("active") });
const include = { service: { include: { tenant: { select: { publicName: true } } } },
  purposes: { orderBy: { purposeId: "asc" as const }, include: { purpose: { include: { recipients: { include: { recipient: true } } } } } },
  recipients: { orderBy: { recipientId: "asc" as const }, include: { recipient: true } }, versions: { orderBy: { number: "desc" as const }, take: 1 },
  publications: { where: { status: "active" }, select: { documentVersionId: true, expiresAt: true } } };
type StoredDocument = Prisma.DocumentGetPayload<{ include: typeof include }>;
const iso = (value: Date) => value.toISOString();
const publicUrl = (cipher: string) => "/document/view/" + decrypt<string>(cipher);
function hasLatestPublication(row: StoredDocument) {
  return row.publications.some(link => link.documentVersionId === row.versions[0]?.id && (!link.expiresAt || link.expiresAt > new Date()));
}

export const documentScope = currentServiceScope;
export async function lockDocumentService(tx: Transaction, ctx: Context, serviceId: string, capability: Capability) {
  const scope = await documentScope(tx, ctx, capability);
  if (capability === "document.read") await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  else await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  const service = await tx.service.findFirst({ where: { AND: [scope, { id: serviceId }] } });
  if (!service) fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  if (capability !== "document.read" && service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에서는 문서를 변경할 수 없습니다.");
}
async function locate(tx: Transaction, ctx: Context, id: string, write: boolean) {
  const row = await tx.document.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { serviceId: true } });
  if (!row) fail(404, "NOT_FOUND", "문서를 찾을 수 없습니다.");
  await lockDocumentService(tx, ctx, row.serviceId, write ? "document.write" : "document.read");
  return tx.document.findUniqueOrThrow({ where: { id }, include });
}
function dto(row: StoredDocument) {
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service.name, type: row.type, title: row.title, body: row.body,
    refusalNotice: row.refusalNotice, rightsContact: row.rightsContact, effectiveDate: row.effectiveDate,
    purposeIds: row.purposes.map(item => item.purposeId), recipientIds: row.recipients.map(item => item.recipientId),
    status: row.status, version: row.version, draftRevision: row.draftRevision, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
    latestNumber: row.versions[0]?.number ?? 0, hasUnpublishedChanges: !row.versions[0] || row.versions[0].contentHash !== preview(row).contentHash,
    hasActivePublication: hasLatestPublication(row) };
}
function editable(row: { version: number; status: string }, version: number) {
  requireVersion({ version }, row); if (row.status === "archived") fail(409, "DOCUMENT_ARCHIVED", "문서를 복원한 뒤 변경해주세요.");
}
async function validateLinks(tx: Transaction, ctx: Context, input: DocumentInput) {
  const purposes = await tx.processingPurpose.count({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, id: { in: input.purposeIds }, status: "active" } });
  const recipients = await tx.recipient.count({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, id: { in: input.recipientIds }, status: "active", kind: { not: "source" } } });
  if (purposes !== input.purposeIds.length || recipients !== input.recipientIds.length)
    fail(422, "INVALID_DOCUMENT_REFERENCE", "같은 서비스에서 사용 중인 수집 목적과 제공·수탁자를 선택해주세요.");
}
async function writeLinks(tx: Transaction, ctx: Context, id: string, input: DocumentInput) {
  await tx.documentPurpose.deleteMany({ where: { documentId: id } }); await tx.documentRecipient.deleteMany({ where: { documentId: id } });
  const data = { tenantId: ctx.tenantId, serviceId: input.serviceId, documentId: id };
  if (input.purposeIds.length) await tx.documentPurpose.createMany({ data: input.purposeIds.map(purposeId => ({ ...data, purposeId })) });
  if (input.recipientIds.length) await tx.documentRecipient.createMany({ data: input.recipientIds.map(recipientId => ({ ...data, recipientId })) });
}
export async function createDocument(tx: Transaction, ctx: Context, input: DocumentInput, requestId: string) {
  await lockDocumentService(tx, ctx, input.serviceId, "document.write"); await validateLinks(tx, ctx, input);
  const { purposeIds: _purposes, recipientIds: _recipients, ...data } = input; void _purposes; void _recipients;
  const row = await tx.document.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.user.id } });
  await writeLinks(tx, ctx, row.id, input); await audit(tx, ctx, requestId, "document.created", "document", row.id, Object.keys(input), row.serviceId);
  return dto(await tx.document.findUniqueOrThrow({ where: { id: row.id }, include }));
}
export async function listDocuments(ctx: Context, query: z.infer<typeof documentQuery>) {
  return db.$transaction(async tx => {
    const service = await documentScope(tx, ctx, "document.read");
    const where = { tenantId: ctx.tenantId, service, ...(query.serviceId ? { serviceId: query.serviceId } : {}), ...(query.type ? { type: query.type } : {}),
      ...(query.status === "all" ? {} : { status: query.status }), title: { contains: query.search, mode: "insensitive" as const } };
    const rows = await tx.document.findMany({ where, include, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize });
    return { items: rows.map(dto), total: await tx.document.count({ where }), page: query.page, pageSize: query.pageSize };
  });
}
export async function readDocument(ctx: Context, id: string) { return db.$transaction(async tx => dto(await locate(tx, ctx, id, false))); }
export async function updateDocument(ctx: Context, id: string, input: DocumentInput & { version: number }, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); editable(row, input.version);
    if (row.serviceId !== input.serviceId || row.type !== input.type) fail(422, "IMMUTABLE_DOCUMENT_SCOPE", "문서의 서비스와 유형은 변경할 수 없습니다.");
    await validateLinks(tx, ctx, input);
    const { purposeIds: _p, recipientIds: _r, version, ...data } = input; void _p; void _r;
    await tx.document.update({ where: { id }, data: { ...data, version: version + 1, draftRevision: { increment: 1 } } }); await writeLinks(tx, ctx, id, input);
    await audit(tx, ctx, requestId, "document.draft_updated", "document", id, Object.keys(input), row.serviceId);
    return dto(await tx.document.findUniqueOrThrow({ where: { id }, include }));
  });
}
function purposeSnapshot(row: StoredDocument["purposes"][number]["purpose"]): PublicPurpose {
  return { name: row.name, purpose: row.purpose, lawfulBasis: row.lawfulBasis, basisReference: row.basisReference, items: row.items as PublicPurpose["items"],
    retentionMode: row.retentionMode, retentionDays: row.retentionDays, retentionReason: row.retentionReason };
}
function recipientSnapshot(row: StoredDocument["recipients"][number]["recipient"]): PublicRecipient {
  return { name: row.name, kind: row.kind, countryCode: row.countryCode, purpose: row.purpose, items: row.items, retentionMode: row.retentionMode,
    retentionDays: row.retentionDays, retentionReason: row.retentionReason, contact: row.contact, transferMethod: row.transferMethod, transferTiming: row.transferTiming, refusalNotice: row.refusalNotice };
}
export function canonicalDocument(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalDocument).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalDocument((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
const retention = (row: { retentionMode: string; retentionDays: number | null; retentionReason: string }) => row.retentionMode === "days" ? `${row.retentionDays}일${row.retentionReason ? " · " + row.retentionReason : ""}` : row.retentionReason;
export function renderDocument(snapshot: DocumentSnapshot) {
  const lines = [snapshot.title, documentTypes[snapshot.type], snapshot.companyName + " · " + snapshot.serviceName, "시행일: " + snapshot.effectiveDate, snapshot.body];
  for (const purpose of snapshot.purposes) lines.push("", "처리 목적: " + purpose.name, purpose.purpose,
    "수집 근거: " + basisLabels[purpose.lawfulBasis as keyof typeof basisLabels] + (purpose.basisReference ? " · " + purpose.basisReference : ""),
    "항목: " + purpose.items.map(item => `${item.name} (${itemKinds[item.kind]}, ${item.required ? "필수" : "선택"})`).join(", "), "보유 기간: " + retention(purpose));
  for (const recipient of snapshot.recipients) lines.push("", recipientKinds[recipient.kind as keyof typeof recipientKinds] + ": " + recipient.name,
    "국가·지역: " + recipient.countryCode, "처리 목적: " + recipient.purpose, "항목: " + recipient.items.join(", "), "보유 기간: " + retention(recipient),
    ...(recipient.contact ? ["연락처: " + recipient.contact] : []), ...(recipient.countryCode !== "KR" ? ["이전 방법: " + recipient.transferMethod, "이전 시기: " + recipient.transferTiming, "거부 안내: " + recipient.refusalNotice] : []));
  if (snapshot.refusalNotice) lines.push("", "동의 거부 안내", snapshot.refusalNotice);
  if (snapshot.rightsContact) lines.push("", "권리 행사·문의", snapshot.rightsContact);
  return lines.join("\n");
}
function preview(row: StoredDocument) {
  const map = new Map(row.recipients.map(link => [link.recipient.id, link.recipient]));
  for (const link of row.purposes) for (const rel of link.purpose.recipients) if (rel.recipient.kind !== "source") map.set(rel.recipient.id, rel.recipient);
  const recipients = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  const snapshot: DocumentSnapshot = { schemaVersion: 1, type: row.type as DocumentInput["type"], title: row.title, body: row.body, refusalNotice: row.refusalNotice,
    rightsContact: row.rightsContact, effectiveDate: row.effectiveDate, companyName: row.service.tenant.publicName, serviceName: row.service.externalName,
    purposes: row.purposes.map(link => purposeSnapshot(link.purpose)), recipients: recipients.map(recipientSnapshot) };
  const publishErrors: string[] = [];
  if (!row.purposes.length) publishErrors.push("수집 목적을 하나 이상 선택해주세요.");
  if (row.purposes.some(link => link.purpose.status !== "active") || recipients.some(item => item.status !== "active")) publishErrors.push("보관된 목적 또는 제공·수탁자 연결을 수정해주세요.");
  if (row.type !== "privacy_policy") {
    if (!row.refusalNotice.trim()) publishErrors.push("동의 거부 안내를 입력해주세요.");
    if (row.purposes.some(link => link.purpose.lawfulBasis !== "consent")) publishErrors.push("동의서에는 정보주체 동의를 근거로 하는 수집 목적을 선택해주세요.");
  } else if (!row.rightsContact.trim()) publishErrors.push("권리 행사·문의 안내를 입력해주세요.");
  if (row.type === "overseas_transfer" && !recipients.some(item => item.countryCode !== "KR")) publishErrors.push("국외 제공·수탁자를 하나 이상 연결해주세요.");
  return { snapshot, renderedText: renderDocument(snapshot), contentHash: createHash("sha256").update(canonicalDocument(snapshot)).digest("hex"), publishErrors };
}
export async function previewDocument(ctx: Context, id: string) { return db.$transaction(async tx => preview(await locate(tx, ctx, id, false))); }
export async function publishDocument(ctx: Context, id: string, input: { version: number; expiresAt: string | null }, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); editable(row, input.version);
    const result = preview(row);
    if (result.publishErrors.length) fail(422, "DOCUMENT_INCOMPLETE", result.publishErrors.join(" "));
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (expiresAt.getTime() <= Date.now() + 60000 || expiresAt.getTime() > Date.now() + 3650 * 86400000)) fail(422, "INVALID_EXPIRY", "공개 기한은 1분 이후부터 10년 이내로 지정해주세요.");
    if (row.status === "published" && row.versions[0]?.contentHash === result.contentHash && hasLatestPublication(row))
      fail(409, "NO_DOCUMENT_CHANGES", "이미 게시한 내용입니다. 기존 링크를 사용하거나 새 초안을 저장해주세요.");
    const published = await tx.documentVersion.create({ data: { tenantId: row.tenantId, serviceId: row.serviceId, documentId: id,
      number: (row.versions[0]?.number ?? 0) + 1, draftRevision: row.draftRevision, snapshot: result.snapshot as unknown as Prisma.InputJsonValue,
      contentHash: result.contentHash, renderedText: result.renderedText } });
    const token = opaqueToken();
    const link = await tx.documentPublication.create({ data: { tenantId: row.tenantId, serviceId: row.serviceId, documentId: id, documentVersionId: published.id,
      tokenHash: tokenHash(token), tokenCipher: encrypt(token), expiresAt } });
    await tx.document.update({ where: { id }, data: { status: "published", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "document.published", "document", id, ["version", "publication"], row.serviceId);
    return { document: dto(await tx.document.findUniqueOrThrow({ where: { id }, include })), number: published.number, publicationId: link.id, url: "/document/view/" + token };
  });
}
async function ensureDisconnected(tx: Transaction, ids: string[]) {
  if (await tx.serviceConsentDisplay.count({ where: { publicationId: { in: ids } } })) fail(409, "DOCUMENT_IN_USE", "서비스의 동의서 표시 설정에서 처리방침 연결을 해제한 뒤 처리해주세요.");
}
export async function changeDocumentState(ctx: Context, id: string, version: number, action: "archive" | "restore" | "unpublish", requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); requireVersion({ version }, row);
    if (action === "restore" ? row.status !== "archived" : row.status === "archived" || (action === "unpublish" && row.status !== "published"))
      fail(409, "INVALID_TRANSITION", "문서 상태를 다시 확인해주세요.");
    if (action !== "restore") {
      const links = await tx.documentPublication.findMany({ where: { documentId: id, status: "active" }, select: { id: true } }); await ensureDisconnected(tx, links.map(item => item.id));
      await tx.documentPublication.updateMany({ where: { documentId: id, status: "active" }, data: { status: "revoked", revokedAt: new Date() } });
    }
    await tx.document.update({ where: { id }, data: { status: action === "restore" ? "draft" : action === "archive" ? "archived" : "private", version: version + 1 } });
    await audit(tx, ctx, requestId, "document." + action, "document", id, ["status"], row.serviceId);
    return dto(await tx.document.findUniqueOrThrow({ where: { id }, include }));
  });
}
export async function revokeDocumentLink(ctx: Context, id: string, input: { version: number; publicationId: string }, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); editable(row, input.version);
    const link = await tx.documentPublication.findFirst({ where: { id: input.publicationId, documentId: id, status: "active" } });
    if (!link) fail(409, "PUBLICATION_CLOSED", "이미 회수되었거나 이 문서에 속하지 않는 링크입니다.");
    await ensureDisconnected(tx, [link.id]);
    await tx.documentPublication.update({ where: { id: link.id }, data: { status: "revoked", revokedAt: new Date() } });
    const active = await tx.documentPublication.count({ where: { documentId: id, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    await tx.document.update({ where: { id }, data: { version: { increment: 1 }, ...(active ? {} : { status: "private" }) } });
    await audit(tx, ctx, requestId, "document.link_revoked", "document", id, ["publication"], row.serviceId);
    return dto(await tx.document.findUniqueOrThrow({ where: { id }, include }));
  });
}
export async function documentHistory(ctx: Context, id: string, query: z.infer<typeof listQuery>) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, false);
    const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, include: { grants: true } });
    const canShare = roleCan(member.role, "document.write") && (["owner", "admin"].includes(member.role) || member.grants.some(item => item.serviceId === row.serviceId && item.capabilities.includes("document.write")));
    const versions = await tx.documentVersion.findMany({ where: { documentId: id }, orderBy: { number: "desc" }, take: query.pageSize, skip: (query.page - 1) * query.pageSize,
      include: { publications: { orderBy: { createdAt: "desc" }, include: { _count: { select: { displays: true } } } } } });
    return { items: versions.map(version => ({ id: version.id, number: version.number, draftRevision: version.draftRevision, snapshot: version.snapshot, renderedText: version.renderedText, contentHash: version.contentHash, createdAt: iso(version.createdAt),
      publications: version.publications.map(link => ({ id: link.id, status: link.status === "active" && link.expiresAt && link.expiresAt <= new Date() ? "expired" : link.status,
        createdAt: iso(link.createdAt), expiresAt: link.expiresAt ? iso(link.expiresAt) : null, revokedAt: link.revokedAt ? iso(link.revokedAt) : null,
        ...(canShare && link.status === "active" && (!link.expiresAt || link.expiresAt > new Date()) ? { url: publicUrl(link.tokenCipher) } : {}), displayCount: link._count.displays })) })), total: await tx.documentVersion.count({ where: { documentId: id } }), page: query.page, pageSize: query.pageSize };
  });
}
export async function lockPublicDocument(tx: Transaction, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "문서를 찾을 수 없습니다.");
    const found = await tx.documentPublication.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true, tenantId: true, serviceId: true } });
    if (!found) fail(404, "NOT_FOUND", "문서를 찾을 수 없습니다.");
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${found.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${found.serviceId} FOR SHARE`;
    const link = await tx.documentPublication.findUniqueOrThrow({ where: { id: found.id }, include: { documentVersion: true, document: { include: { service: { include: { tenant: true } } } } } });
    if (link.status !== "active" || (link.expiresAt && link.expiresAt <= new Date()) || link.document.status !== "published" || link.document.service.status !== "active" || link.document.service.tenant.status !== "active")
      fail(410, "DOCUMENT_CLOSED", "공개가 종료되었거나 만료된 문서입니다.");
    return link;
}
export async function publicDocument(token: string) {
  return db.$transaction(async tx => {
    const link = await lockPublicDocument(tx, token), version = link.documentVersion;
    return { number: version.number, publishedAt: iso(version.createdAt), expiresAt: link.expiresAt ? iso(link.expiresAt) : null,
      snapshot: version.snapshot as unknown as DocumentSnapshot, renderedText: version.renderedText, contentHash: version.contentHash };
  });
}
function clauseDto(row: Prisma.ClauseTemplateGetPayload<object>) { return { id: row.id, serviceId: row.serviceId, type: row.type, title: row.title, body: row.body, status: row.status, version: row.version, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }; }
export async function listClauses(ctx: Context, query: z.infer<typeof clauseQuery>) {
  return db.$transaction(async tx => {
    const service = await documentScope(tx, ctx, "document.read"); const where = { tenantId: ctx.tenantId, service,
      ...(query.serviceId ? { serviceId: query.serviceId } : {}), ...(query.type ? { type: query.type } : {}), ...(query.status === "all" ? {} : { status: query.status }), title: { contains: query.search, mode: "insensitive" as const } };
    return { items: (await tx.clauseTemplate.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })).map(clauseDto), total: await tx.clauseTemplate.count({ where }), page: query.page, pageSize: query.pageSize };
  });
}
export async function createClause(tx: Transaction, ctx: Context, input: ClauseInput, requestId: string) {
  await lockDocumentService(tx, ctx, input.serviceId, "document.write");
  const row = await tx.clauseTemplate.create({ data: { ...input, tenantId: ctx.tenantId } });
  await audit(tx, ctx, requestId, "clause.created", "clauseTemplate", row.id, Object.keys(input), row.serviceId); return clauseDto(row);
}
async function locateClause(tx: Transaction, ctx: Context, id: string, write: boolean) {
  const found = await tx.clauseTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } }); if (!found) fail(404, "NOT_FOUND", "문구를 찾을 수 없습니다.");
  await lockDocumentService(tx, ctx, found.serviceId, write ? "document.write" : "document.read"); return tx.clauseTemplate.findUniqueOrThrow({ where: { id } });
}
export async function readClause(ctx: Context, id: string) { return db.$transaction(async tx => clauseDto(await locateClause(tx, ctx, id, false))); }
export async function updateClause(ctx: Context, id: string, input: ClauseInput & { version: number }, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locateClause(tx, ctx, id, true); editable(row, input.version);
    if (input.serviceId !== row.serviceId || input.type !== row.type) fail(422, "IMMUTABLE_DOCUMENT_SCOPE", "문구의 서비스와 유형은 변경할 수 없습니다.");
    const result = await tx.clauseTemplate.update({ where: { id }, data: { title: input.title, body: input.body, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "clause.updated", "clauseTemplate", id, ["title", "body"], row.serviceId); return clauseDto(result);
  });
}
export async function changeClauseState(ctx: Context, id: string, version: number, restore: boolean, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locateClause(tx, ctx, id, true); requireVersion({ version }, row);
    if (row.status !== (restore ? "archived" : "active")) fail(409, "INVALID_TRANSITION", "문구 상태를 다시 확인해주세요.");
    const result = await tx.clauseTemplate.update({ where: { id }, data: { status: restore ? "active" : "archived", version: version + 1 } });
    await audit(tx, ctx, requestId, "clause." + (restore ? "restored" : "archived"), "clauseTemplate", id, ["status"], row.serviceId); return clauseDto(result);
  });
}
export async function applyClause(ctx: Context, id: string, input: { version: number; templateId: string; templateVersion: number }, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); editable(row, input.version);
    const template = await tx.clauseTemplate.findFirst({ where: { id: input.templateId, tenantId: ctx.tenantId, serviceId: row.serviceId, type: row.type, status: "active" } });
    if (!template) fail(422, "INVALID_CLAUSE", "같은 서비스와 문서 유형의 사용 중인 문구를 선택해주세요."); requireVersion({ version: input.templateVersion }, template);
    await tx.document.update({ where: { id }, data: { body: template.body, version: { increment: 1 }, draftRevision: { increment: 1 } } });
    await audit(tx, ctx, requestId, "document.clause_applied", "document", id, ["body"], row.serviceId); return dto(await tx.document.findUniqueOrThrow({ where: { id }, include }));
  });
}
export async function documentOptions(ctx: Context, serviceId: string) {
  return db.$transaction(async tx => {
    await lockDocumentService(tx, ctx, serviceId, "document.read"); const where = { tenantId: ctx.tenantId, serviceId, status: "active" };
    const purposes = await tx.processingPurpose.findMany({ where, select: { id: true, name: true, version: true, status: true }, orderBy: { name: "asc" } });
    const recipients = await tx.recipient.findMany({ where: { ...where, kind: { not: "source" } }, select: { id: true, name: true, kind: true, countryCode: true, version: true, status: true }, orderBy: { name: "asc" } });
    const templates = (await tx.clauseTemplate.findMany({ where, orderBy: { title: "asc" } })).map(clauseDto);
    const policies = (await tx.documentPublication.findMany({ where: { ...where, document: { type: "privacy_policy", status: "published" }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { documentVersion: true }, orderBy: { createdAt: "desc" } })).map(item => ({ publicationId: item.id, title: (item.documentVersion.snapshot as unknown as DocumentSnapshot).title, number: item.documentVersion.number, expiresAt: item.expiresAt ? iso(item.expiresAt) : null }));
    return { purposes, recipients, templates, policies };
  });
}
function displayDto(row: Prisma.ServiceConsentDisplayGetPayload<{ include: { publication: true } }> | null, serviceId: string, kind: DisplayKind) {
  if (!row) return { ...emptyDisplay(), serviceId, kind, policyUrl: null };
  return { serviceId, kind, version: row.version, nameMode: row.nameMode, startText: row.startText, processorText: row.processorText, policyText: row.policyText,
    requiredText: row.requiredText, optionalText: row.optionalText, policyMode: row.policyMode, externalUrl: row.externalUrl, publicationId: row.publicationId,
    policyUrl: row.policyMode === "external" ? row.externalUrl : row.publication && row.publication.status === "active" && (!row.publication.expiresAt || row.publication.expiresAt > new Date()) ? publicUrl(row.publication.tokenCipher) : null };
}
async function displayNames(tx: Transaction, serviceId: string) {
  const service = await tx.service.findUniqueOrThrow({ where: { id: serviceId }, include: { tenant: { select: { publicName: true } } } });
  return { companyName: service.tenant.publicName, serviceName: service.externalName };
}
export async function readDisplay(ctx: Context, serviceId: string, kind: DisplayKind) {
  return db.$transaction(async tx => {
    await lockDocumentService(tx, ctx, serviceId, "service.manage");
    return { ...displayDto(await tx.serviceConsentDisplay.findUnique({ where: { tenantId_serviceId_kind: { tenantId: ctx.tenantId, serviceId, kind } }, include: { publication: true } }), serviceId, kind), ...await displayNames(tx, serviceId) };
  });
}
export async function updateDisplay(ctx: Context, serviceId: string, kind: DisplayKind, input: DisplayInput, requestId: string) {
  return db.$transaction(async tx => {
    await lockDocumentService(tx, ctx, serviceId, "service.manage");
    const where = { tenantId_serviceId_kind: { tenantId: ctx.tenantId, serviceId, kind } }, row = await tx.serviceConsentDisplay.findUnique({ where });
    if (input.version !== (row?.version ?? 0)) fail(409, "VERSION_CONFLICT", "표시 설정이 변경되었습니다. 최신 내용을 다시 불러와주세요.");
    if (input.publicationId && !await tx.documentPublication.findFirst({ where: { id: input.publicationId, tenantId: ctx.tenantId, serviceId, status: "active",
      document: { type: "privacy_policy", status: "published" }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })) fail(422, "INVALID_POLICY_LINK", "같은 서비스의 공개 중인 처리방침 버전을 선택해주세요.");
    const data = { ...input, version: input.version + 1 };
    const result = row ? await tx.serviceConsentDisplay.update({ where, data, include: { publication: true } }) :
      await tx.serviceConsentDisplay.create({ data: { ...data, tenantId: ctx.tenantId, serviceId, kind }, include: { publication: true } });
    await audit(tx, ctx, requestId, "service.consent_display_updated", "service", serviceId, Object.keys(input).filter(key => key !== "version"), serviceId);
    return { ...displayDto(result, serviceId, kind), ...await displayNames(tx, serviceId) };
  });
}
