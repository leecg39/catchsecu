import type { Prisma } from "@/generated/prisma/client";
import type { DocumentSnapshot, DisplayKind } from "@/contracts/documents";
import { emptyDisplay } from "@/contracts/documents";
import type { ConsentDisplaySnapshot, DocumentSelection, FormConsentBundle, FormDocumentOption } from "@/contracts/form-documents";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { documentScope } from "./documents";
import { fail } from "./http";

export const consentVersionInclude = { documentBindings: { orderBy: { order: "asc" as const }, include: { documentVersion: true } } };
export type ConsentVersion = Prisma.FormVersionGetPayload<{ include: typeof consentVersionInclude }>;
export function consentBundle(version: ConsentVersion): FormConsentBundle {
  return { display: version.consentDisplay as ConsentDisplaySnapshot | null,
    documents: version.documentBindings.map(binding => {
      const snapshot = binding.documentVersion.snapshot as unknown as DocumentSnapshot;
      return { key: binding.id, required: binding.required, kind: binding.kind as DisplayKind, title: snapshot.title, type: snapshot.type,
        number: binding.documentVersion.number, contentHash: binding.documentVersion.contentHash, renderedText: binding.documentVersion.renderedText,
        display: binding.displaySnapshot as ConsentDisplaySnapshot };
    }) };
}
function maximumRetention(snapshot: DocumentSnapshot) {
  const days = snapshot.purposes.filter(item => item.retentionMode === "days" && item.retentionDays !== null).map(item => item.retentionDays!);
  return days.length ? Math.min(...days) : null;
}
async function assertDocumentAccess(tx: Transaction, ctx: Context, serviceId: string) {
  const scope = await documentScope(tx, ctx, "document.read");
  if (!await tx.service.findFirst({ where: { AND: [scope, { id: serviceId, status: "active" }] } }))
    fail(403, "SERVICE_FORBIDDEN", "이 서비스의 문서를 선택할 권한이 없습니다.");
}
export async function formDocumentOptions(ctx: Context, serviceId: string, query: { page: number; pageSize: number; search: string }): Promise<{ items: FormDocumentOption[]; total: number; page: number; pageSize: number }> {
  return db.$transaction(async tx => {
    await assertDocumentAccess(tx, ctx, serviceId);
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${serviceId} FOR SHARE`;
    const where = { tenantId: ctx.tenantId, serviceId, snapshot: { path: ["title"], string_contains: query.search, mode: "insensitive" as const },
      document: { status: "published", type: { in: ["consent", "overseas_transfer"] } },
      publications: { some: { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } };
    const rows = await tx.documentVersion.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.pageSize, skip: (query.page - 1) * query.pageSize });
    return { items: rows.map(row => { const snapshot = row.snapshot as unknown as DocumentSnapshot;
      return { documentId: row.documentId, documentVersionId: row.id, title: snapshot.title, type: snapshot.type, number: row.number,
        contentHash: row.contentHash, renderedText: row.renderedText, maximumRetentionDays: maximumRetention(snapshot) }; }), total: await tx.documentVersion.count({ where }), page: query.page, pageSize: query.pageSize };
  });
}
async function captureDisplay(tx: Transaction, tenantId: string, serviceId: string, kind: DisplayKind): Promise<ConsentDisplaySnapshot> {
  const service = await tx.service.findUniqueOrThrow({ where: { id: serviceId }, include: { tenant: { select: { publicName: true } } } });
  const row = await tx.serviceConsentDisplay.findUnique({ where: { tenantId_serviceId_kind: { tenantId, serviceId, kind } },
    include: { publication: { include: { documentVersion: true, document: true } } } });
  const value = row ?? emptyDisplay(), names = { service_company: `${service.externalName}(${service.tenant.publicName})`, company_service: `${service.tenant.publicName}(${service.externalName})`, service: service.externalName, company: service.tenant.publicName };
  let policy: ConsentDisplaySnapshot["policy"] = null;
  if (value.policyMode === "external") policy = { kind: "external", url: value.externalUrl };
  if (value.policyMode === "document") {
    const link = row?.publication;
    if (!link || link.status !== "active" || link.document.status !== "published" || (link.expiresAt && link.expiresAt <= new Date()))
      fail(409, "CONSENT_POLICY_CLOSED", "서비스 표시 설정의 처리방침 링크가 종료되었습니다. 설정을 변경한 뒤 폼을 저장해주세요.");
    const snapshot = link.documentVersion.snapshot as unknown as DocumentSnapshot;
    policy = { kind: "document", title: snapshot.title, number: link.documentVersion.number, renderedText: link.documentVersion.renderedText, contentHash: link.documentVersion.contentHash };
  }
  return { schemaVersion: 1, kind, version: value.version, name: names[value.nameMode as keyof typeof names], startText: value.startText,
    processorText: value.processorText, policyText: value.policyText, requiredText: value.requiredText, optionalText: value.optionalText, policy };
}
export async function validateDocumentSelections(tx: Transaction, ctx: Context, serviceId: string, selections: DocumentSelection[], retentionDays: number) {
  if (!selections.length) return [];
  await assertDocumentAccess(tx, ctx, serviceId);
  const rows = await tx.documentVersion.findMany({ where: { id: { in: selections.map(item => item.documentVersionId) }, tenantId: ctx.tenantId, serviceId,
    document: { status: "published", type: { in: ["consent", "overseas_transfer"] } },
    publications: { some: { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } } });
  if (rows.length !== selections.length) fail(422, "INVALID_CONSENT_DOCUMENT", "같은 서비스에서 공개 중인 동의서 게시 버전을 선택해주세요.");
  if (new Set(rows.map(row => row.documentId)).size !== rows.length) fail(422, "DUPLICATE_CONSENT_DOCUMENT", "한 문서에서는 하나의 게시 버전만 선택해주세요.");
  for (const row of rows) {
    const maximum = maximumRetention(row.snapshot as unknown as DocumentSnapshot);
    if (maximum !== null && retentionDays > maximum) fail(422, "CONSENT_RETENTION_MISMATCH", `폼의 보유 기간을 선택한 동의서의 ${maximum}일 이내로 설정해주세요.`);
  }
  return selections.map(selection => rows.find(row => row.id === selection.documentVersionId)!);
}
export async function writeFormConsent(tx: Transaction, ctx: Context, serviceId: string, formVersionId: string, content: { documentConsents?: DocumentSelection[]; retentionDays: number }) {
  const selections = content.documentConsents ?? [], versions = await validateDocumentSelections(tx, ctx, serviceId, selections, content.retentionDays);
  const collection = await captureDisplay(tx, ctx.tenantId, serviceId, "collection");
  const thirdParty = selections.some(item => item.kind === "third_party") ? await captureDisplay(tx, ctx.tenantId, serviceId, "third_party") : null;
  await tx.formVersion.update({ where: { id: formVersionId }, data: { receiptEvidenceVersion: 1, consentDisplay: collection as unknown as Prisma.InputJsonValue } });
  await tx.formDocumentBinding.deleteMany({ where: { formVersionId } });
  for (const [order, selection] of selections.entries()) await tx.formDocumentBinding.create({ data: {
    tenantId: ctx.tenantId, serviceId, formVersionId, documentId: versions[order].documentId, documentVersionId: versions[order].id,
    required: selection.required, kind: selection.kind, order, displaySnapshot: (selection.kind === "collection" ? collection : thirdParty!) as unknown as Prisma.InputJsonValue,
  } });
}
export async function validateFormDocuments(tx: Transaction, ctx: Context, serviceId: string, version: ConsentVersion) {
  await validateDocumentSelections(tx, ctx, serviceId, version.documentBindings.map(row => ({ documentVersionId: row.documentVersionId, required: row.required, kind: row.kind as DisplayKind })), version.retentionDays);
}
