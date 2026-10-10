import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { QuestionDefinition } from "@/contracts/questions";
import type { FormContent } from "@/contracts/forms";
import { remapRichDocument, richDocumentImages, type RichDocumentV1 } from "@/contracts/rich-content";
import type { Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { reserveQuota } from "./file-quota";

export type AuthorAssetParent = { kind: "version" | "template" | "approval"; id: string };
export type AuthorAssetScope = { tenantId: string | null; serviceId: string | null; memberId: string | null; actorId?: string };
type QuestionSlotName = "material" | "option" | "question";
type DocumentSlotName = "form_content" | "page_content" | "end_page_content" | "private_page_content" | "template_thumbnail";
type Slot = { assetId: string; questionKey: string | null; documentKey: string | null; nodeKey: string | null;
  slot: QuestionSlotName | DocumentSlotName; orderNumber: number | null; optionKey: string | null };
type AuthorAssetGraphContent = Pick<FormContent, "questions"> & Partial<Pick<FormContent, "bodyRich" | "sections" | "completionPage" | "closedPage">>
  & { templateThumbnailAssetId?: string | null };
type StoredAsset = Prisma.AuthorAssetGetPayload<{ include: { blob: true } }>;
export const authorAssetScope = (ctx: Context, serviceId: string): AuthorAssetScope =>
  ({ tenantId: ctx.tenantId, serviceId, memberId: ctx.member.id, actorId: ctx.user.id });
const parentWhere = (parent: AuthorAssetParent): Prisma.AuthorAssetReferenceWhereInput =>
  parent.kind === "version" ? { formVersionId: parent.id } : parent.kind === "template" ? { templateId: parent.id } : { approvalId: parent.id };
const slotKey = (slot: Slot) => JSON.stringify([
  slot.questionKey, slot.documentKey, slot.nodeKey, slot.slot, slot.orderNumber, slot.optionKey, slot.assetId,
]);

function documentSlots(document: RichDocumentV1 | null | undefined, slot: DocumentSlotName, documentKey: string): Slot[] {
  return document ? richDocumentImages(document).map(image => ({
    assetId: image.assetId, questionKey: null, documentKey, nodeKey: image.nodeId,
    slot, orderNumber: null, optionKey: null,
  })) : [];
}

export function authorAssetSlots(content: AuthorAssetGraphContent): Slot[] {
  const questionSlots: Slot[] = content.questions.flatMap((question: QuestionDefinition) => [
    ...(question.questionImageKey ? [{ assetId: question.questionImageKey, questionKey: question.id,
      documentKey: null, nodeKey: null, slot: "question" as const, orderNumber: null, optionKey: null }] : []),
    ...(question.materialList ?? []).filter(material => material.materialType === "FILE").map(material => ({
      assetId: material.fileKey!, questionKey: question.id, documentKey: null, nodeKey: null,
      slot: "material" as const, orderNumber: material.orderNumber, optionKey: null,
    })),
    ...(question.optionDefinitions ?? []).filter(option => !!option.optionImageKey).map(option => ({
      assetId: option.optionImageKey!, questionKey: question.id, documentKey: null, nodeKey: null,
      slot: "option" as const, orderNumber: null, optionKey: option.id,
    })),
  ]);
  return [
    ...questionSlots,
    ...(content.templateThumbnailAssetId ? [{ assetId: content.templateThumbnailAssetId, questionKey: null,
      documentKey: "template", nodeKey: null, slot: "template_thumbnail" as const, orderNumber: null, optionKey: null }] : []),
    ...documentSlots(content.bodyRich, "form_content", "form"),
    ...(content.sections ?? []).flatMap(section => documentSlots(section.bodyRich, "page_content", section.id)),
    ...documentSlots(content.completionPage?.mode === "custom" ? content.completionPage.bodyRich : undefined, "end_page_content", "completion"),
    ...documentSlots(content.closedPage?.mode === "custom" ? content.closedPage.bodyRich : undefined, "private_page_content", "closed"),
  ];
}
async function lockAssets(tx: Transaction, ids: string[]): Promise<Map<string, StoredAsset>> {
  const unique = [...new Set(ids)].sort();
  if (!unique.length) return new Map();
  // Parent locks are already held by the form/template/approval caller. All assets
  // precede all blobs, including removals, so replacement does not invert GC order.
  await tx.$queryRaw`SELECT id FROM "AuthorAsset" WHERE id=ANY(${unique}::text[]) ORDER BY id FOR UPDATE`;
  const initial = await tx.authorAsset.findMany({ where: { id: { in: unique } }, select: { blobId: true } });
  const blobIds = [...new Set(initial.map(asset => asset.blobId))].sort();
  if (blobIds.length) await tx.$queryRaw`SELECT id FROM "AuthorAssetBlob" WHERE id=ANY(${blobIds}::text[]) ORDER BY id FOR UPDATE`;
  const assets = await tx.authorAsset.findMany({ where: { id: { in: unique } }, include: { blob: true }, orderBy: { id: "asc" } });
  return new Map(assets.map(asset => [asset.id, asset]));
}
function assertAsset(asset: StoredAsset | undefined, scope: AuthorAssetScope, slot: Slot, allowQuarantined: boolean) {
  if (!asset || asset.ownerKind !== (scope.tenantId ? "company" : "system") || asset.tenantId !== scope.tenantId || asset.serviceId !== scope.serviceId)
    fail(404, "AUTHOR_ASSET_NOT_FOUND", "현재 서비스에서 사용할 수 있는 자료를 찾을 수 없습니다.");
  if (asset.purpose !== ({ material: "QUESTION_MATERIAL", option: "OPTION_IMAGE", question: "QUESTION_IMAGE",
    form_content: "FORM_CONTENT_IMAGE", page_content: "PAGE_CONTENT_IMAGE",
    end_page_content: "END_PAGE_CONTENT_IMAGE", private_page_content: "PRIVATE_PAGE_CONTENT_IMAGE",
    template_thumbnail: "FORM_CONTENT_IMAGE" } as const)[slot.slot])
    fail(422, "AUTHOR_ASSET_PURPOSE", "자료의 용도와 문항의 첨부 위치가 일치하지 않습니다.");
  if (asset.expiresAt && asset.expiresAt.getTime() <= Date.now()) fail(410, "AUTHOR_ASSET_EXPIRED", "자료의 임시 보관 기간이 끝났습니다.");
  if (asset.status !== "ready" || !(asset.blob.status === "ready" && asset.blob.scanStatus === "clean")
    && !(allowQuarantined && asset.blob.status === "quarantined"))
    fail(409, "AUTHOR_ASSET_NOT_READY", "검사를 통과한 자료만 새로 연결할 수 있습니다.");
  return asset;
}
async function settleLifetime(tx: Transaction, assets: Map<string, StoredAsset>) {
  for (const asset of assets.values()) {
    const pinned = await tx.authorAssetReference.count({ where: { assetId: asset.id } });
    if (pinned && asset.expiresAt !== null) await tx.authorAsset.update({ where: { id: asset.id }, data: { expiresAt: null, version: { increment: 1 } } });
    else if (!pinned && asset.expiresAt === null && asset.status === "ready") {
      // Database clock and TIMESTAMP(3) precision are authoritative for the one-hour bound.
      await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)+interval '1 hour',version=version+1,"updatedAt"=now() WHERE id=${asset.id}`;
    }
  }
}
async function referenceAudit(tx: Transaction, scope: AuthorAssetScope, parent: AuthorAssetParent, assetIds: string[], action: string, requestId: string) {
  if (!scope.tenantId || !assetIds.length) return;
  let formId: string | undefined;
  if (parent.kind === "version") formId = (await tx.formVersion.findUnique({ where: { id: parent.id }, select: { formId: true } }))?.formId;
  if (parent.kind === "approval") formId = (await tx.approvalRequest.findUnique({ where: { id: parent.id }, select: { formId: true } }))?.formId;
  await tx.auditEvent.createMany({ data: [...new Set(assetIds)].map(id => ({ tenantId: scope.tenantId, serviceId: scope.serviceId, actorId: scope.actorId,
    resource: "author-asset", resourceId: id, requestId, action,
    detail: { parentKind: parent.kind, parentId: parent.id, ...(formId ? { formId } : {}) },
  })) });
}

/** Internal graph primitive: the caller must first authorize and lock this exact parent.
 * System scope is only for the trusted platform importer; never construct it from HTTP input.
 * Removes obsolete pins before physical questions, then adds pins after new questions exist.
 */
export async function withAuthorAssetReferences<T>(tx: Transaction, scope: AuthorAssetScope, parent: AuthorAssetParent,
  content: AuthorAssetGraphContent, requestId: string, write: () => Promise<T>): Promise<T> {
  const desired = authorAssetSlots(content), existing = await tx.authorAssetReference.findMany({ where: parentWhere(parent) });
  const wanted = new Map(desired.map(slot => [slotKey(slot), slot])), current = new Map(existing.map(ref => [slotKey(ref as Slot), ref]));
  if (wanted.size !== desired.length) fail(422, "AUTHOR_ASSET_SLOT_DUPLICATE", "자료 연결 위치가 중복되었습니다.");
  const assets = await lockAssets(tx, [...desired.map(slot => slot.assetId), ...existing.map(ref => ref.assetId)]);
  for (const slot of desired) {
    const unchanged = current.has(slotKey(slot)), asset = assertAsset(assets.get(slot.assetId), scope, slot, unchanged);
    // Unbound uploads belong to the issuing member. Already pinned content may be reused
    // by another authorized writer of this same service, as template registration requires.
    if (!unchanged && scope.tenantId && asset.createdById !== scope.memberId
      && !await tx.authorAssetReference.count({ where: { assetId: asset.id } }))
      fail(403, "AUTHOR_ASSET_UPLOAD_OWNER", "다른 사용자의 미저장 업로드를 연결할 수 없습니다.");
  }
  const removed = existing.filter(ref => !wanted.has(slotKey(ref as Slot)));
  if (removed.length && parent.kind === "approval") fail(409, "AUTHOR_ASSET_IMMUTABLE", "승인 자료는 변경할 수 없습니다.");
  if (removed.length) await tx.authorAssetReference.deleteMany({ where: { id: { in: removed.map(ref => ref.id) } } });
  // Log the old immutable parent association before purge can remove the parent row.
  await referenceAudit(tx, scope, parent, removed.map(ref => ref.assetId), "author_asset.detached", requestId);
  const result = await write();
  const added = desired.filter(slot => !current.has(slotKey(slot)));
  const questionIds = parent.kind === "version" && added.some(slot => slot.questionKey !== null) ? new Map((await tx.question.findMany({
    where: { formVersionId: parent.id }, select: { id: true, stableKey: true },
  })).map(question => [question.stableKey, question.id])) : new Map<string, string>();
  for (const slot of added) {
    assertAsset(assets.get(slot.assetId), scope, slot, false);
    const questionId = parent.kind === "version" && slot.questionKey ? questionIds.get(slot.questionKey) : null;
    if (parent.kind === "version" && slot.questionKey && !questionId) fail(422, "AUTHOR_ASSET_QUESTION", "자료가 연결된 질문을 찾을 수 없습니다.");
    await tx.authorAssetReference.create({ data: { ...slot, tenantId: scope.tenantId, serviceId: scope.serviceId,
      ...(parent.kind === "version" ? { formVersionId: parent.id, questionId } : parent.kind === "template" ? { templateId: parent.id } : { approvalId: parent.id }),
    } });
  }
  await settleLifetime(tx, assets);
  await referenceAudit(tx, scope, parent, added.map(slot => slot.assetId), "author_asset.attached", requestId);
  return result;
}

/** Publishing needs every asset to be currently clean, even when an old pin is unchanged. */
export async function assertAuthorAssetReferences(tx: Transaction, scope: AuthorAssetScope, parent: AuthorAssetParent, content: AuthorAssetGraphContent) {
  const slots = authorAssetSlots(content), refs = await tx.authorAssetReference.findMany({
    where: { ...parentWhere(parent), ...(parent.kind === "template" ? { slot: { not: "template_thumbnail" } } : {}) },
  });
  const expected = slots.map(slotKey).sort(), actual = refs.map(ref => slotKey(ref as Slot)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail(409, "AUTHOR_ASSET_REFERENCES", "자료 연결 상태가 변경되었습니다. 폼을 다시 저장해주세요.");
  const assets = await lockAssets(tx, slots.map(slot => slot.assetId));
  for (const slot of slots) assertAsset(assets.get(slot.assetId), scope, slot, false);
  return assets;
}

/** Explicit form/template copies always allocate new owner IDs, including same-service copies.
 * The outer caller must acquire lockFileQuota BEFORE any actor SHARE lock, authorize the
 * actual source parent, and authorize the target service. No storage read/write is needed.
 */
export async function copyAuthorAssets(tx: Transaction, ctx: Context, targetServiceId: string, source: AuthorAssetParent,
  sourceScope: AuthorAssetScope, content: FormContent, requestId: string): Promise<FormContent> {
  const assets = await assertAuthorAssetReferences(tx, sourceScope, source, content);
  if (!assets.size) return structuredClone(content);
  await reserveQuota(tx, ctx.tenantId, [...assets.values()].reduce((sum, asset) => sum + asset.size, 0));
  const mapping = new Map<string, string>();
  for (const asset of assets.values()) {
    const id = randomUUID();
    await tx.authorAsset.create({ data: { id, blobId: asset.blobId, ownerKind: "company", tenantId: ctx.tenantId, serviceId: targetServiceId,
      createdById: ctx.member.id, purpose: asset.purpose, nameCipher: asset.nameCipher, size: asset.size, status: "ready" } });
    mapping.set(asset.id, id);
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, serviceId: targetServiceId, actorId: ctx.user.id, resource: "author-asset", resourceId: id,
      requestId, action: "author_asset.copied", detail: { sourceKind: source.kind, sourceId: source.id } } });
  }
  const copy = structuredClone(content);
  for (const question of copy.questions) {
    if (question.questionImageKey) question.questionImageKey = mapping.get(question.questionImageKey)!;
    for (const material of question.materialList ?? []) if (material.materialType === "FILE") material.fileKey = mapping.get(material.fileKey)!;
    for (const option of question.optionDefinitions ?? []) if (option.optionImageKey) option.optionImageKey = mapping.get(option.optionImageKey)!;
  }
  const remap = (document: RichDocumentV1 | null | undefined) => document ? remapRichDocument(document, { assetIds: mapping }) : document;
  if (copy.bodyRich) copy.bodyRich = remap(copy.bodyRich)!;
  if (copy.sections) for (const section of copy.sections) if (section.bodyRich) section.bodyRich = remap(section.bodyRich)!;
  if (copy.completionPage?.mode === "custom" && copy.completionPage.bodyRich)
    copy.completionPage.bodyRich = remap(copy.completionPage.bodyRich)!;
  if (copy.closedPage?.mode === "custom" && copy.closedPage.bodyRich)
    copy.closedPage.bodyRich = remap(copy.closedPage.bodyRich)!;
  return copy;
}
