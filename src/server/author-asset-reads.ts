import { z } from "zod";
import { authorAssetReadScopeSchema, type AuthorAssetReadScope } from "@/contracts/author-assets";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { withFormAccess, lockFormService } from "./form-access";
import { lockFileSubmission } from "./file-access";
import { tokenHash } from "./crypto";
import { fail } from "./http";
import { lockPublicPublication, lockPublicPublicationView } from "./public-publication";
import { requireParticipationSession } from "./participation-access";
import { lockCompletionProof } from "./form-notice-access";
import { assertLiveAuthorAsset, authorAssetInfo, authorAssetResponse, readAuthorAssetBytes } from "./author-asset-uploads";
import { sharingQuery } from "./share-query";

export function authorAssetReadQuery(url: URL): AuthorAssetReadScope {
  const input = sharingQuery(url, z.record(z.string(), z.string()));
  return authorAssetReadScopeSchema.parse({ ...input, ...(input.version !== undefined ? { version: /^\d+$/.test(input.version) ? Number(input.version) : NaN } : {}) });
}
export type AuthorAssetReferenceSelector = { slots: string[]; questionKeys?: string[]; documentKeys?: string[] };
export type AuthorAssetParent = ({ formVersionId: string; templateId?: never; approvalId?: never }
  | { templateId: string; formVersionId?: never; approvalId?: never }
  | { approvalId: string; formVersionId?: never; templateId?: never }) & { selectors?: AuthorAssetReferenceSelector[] };
/** Caller holds the authorized parent/share and its natural expiry through this operation. */
export async function readPinnedAuthorAssets(tx: Transaction, parent: AuthorAssetParent, id?: string) {
  const { selectors, ...scope } = parent;
  const where: Prisma.AuthorAssetReferenceWhereInput = { ...scope, ...(selectors ? { OR: selectors.map(selector => ({
    slot: { in: selector.slots }, ...(selector.questionKeys ? { questionKey: { in: selector.questionKeys } } : {}),
    ...(selector.documentKeys ? { documentKey: { in: selector.documentKeys } } : {}),
  })) } : {}), ...(id ? { assetId: id } : {}) };
  const refs = await tx.authorAssetReference.findMany({ where, select: { assetId: true } });
  const ids = [...new Set(refs.map(ref => ref.assetId))].sort();
  if (id && !ids.includes(id)) fail(404, "NOT_FOUND", "이 문항에서 사용할 수 있는 자료를 찾을 수 없습니다.");
  for (const key of ids) await tx.$queryRaw`SELECT id FROM "AuthorAsset" WHERE id=${key} FOR SHARE`;
  const rows = await tx.authorAsset.findMany({ where: { id: { in: ids } }, include: { blob: true }, orderBy: { id: "asc" } });
  for (const key of [...new Set(rows.map(row => row.blobId))].sort()) await tx.$queryRaw`SELECT id FROM "AuthorAssetBlob" WHERE id=${key} FOR SHARE`;
  // Re-read the blob after acquiring locks: a quarantine may have won before them.
  const current = await tx.authorAsset.findMany({ where: { id: { in: ids } }, include: { blob: true }, orderBy: { id: "asc" } });
  if (current.length !== ids.length) fail(404, "NOT_FOUND", "첨부 자료를 찾을 수 없습니다.");
  for (const asset of current) assertLiveAuthorAsset(asset, true);
  if (!id) return { items: current.map(authorAssetInfo) };
  const asset = current[0];
  return authorAssetResponse(asset, await readAuthorAssetBytes(asset));
}
async function lockMemberParent(tx: Transaction, ctx: Context, scope: AuthorAssetReadScope): Promise<{ parent: AuthorAssetParent; serviceId: string | null; deadline?: Date }> {
  if (scope.kind === "template") {
    await tx.$queryRaw`SELECT id FROM "FormTemplate" WHERE id=${scope.id} AND ("tenantId"=${ctx.tenantId} OR "tenantId" IS NULL) FOR SHARE`;
    const template = await tx.formTemplate.findFirst({ where: { id: scope.id, OR: [{ tenantId: ctx.tenantId }, { tenantId: null }], status: "active" } });
    if (!template) fail(404, "NOT_FOUND", "템플릿을 찾을 수 없습니다.");
    if (template.version !== scope.version) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 다시 불러와주세요.");
    if (template.tenantId) {
      if (!template.serviceId) fail(409, "TEMPLATE_SERVICE_REQUIRED", "템플릿의 서비스 정보가 없습니다.");
      await lockFormService(tx, ctx, template.serviceId, "form.read", false);
    }
    return { parent: { templateId: template.id }, serviceId: template.serviceId };
  }
  if (scope.kind === "submission") {
    const initial = await tx.submission.findFirst({ where: { id: scope.id, tenantId: ctx.tenantId }, include: { formVersion: { include: { form: true } } } });
    if (!initial) fail(404, "NOT_FOUND", "응답을 찾을 수 없습니다.");
    await lockFormService(tx, ctx, initial.formVersion.form.serviceId, "submission.read", false);
    const submission = await lockFileSubmission(tx, ctx.tenantId, scope.id);
    return { parent: { formVersionId: submission.formVersionId }, serviceId: submission.formVersion.form.serviceId,
      ...(!submission.legalHold ? { deadline: submission.retentionUntil } : {}) };
  }
  let formId = scope.id;
  if (scope.kind === "approval") {
    const row = await tx.approvalRequest.findFirst({ where: { id: scope.id, tenantId: ctx.tenantId }, select: { formId: true } });
    if (!row) fail(404, "NOT_FOUND", "승인 요청을 찾을 수 없습니다.");
    formId = row.formId;
  }
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${formId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const form = await tx.form.findFirst({ where: { id: formId, tenantId: ctx.tenantId }, include: { versions: { orderBy: { number: "desc" }, take: 2 } } });
  if (!form) fail(404, "NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  await lockFormService(tx, ctx, form.serviceId, "form.read", false);
  if (scope.kind === "approval") {
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id=${scope.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const approval = await tx.approvalRequest.findFirst({ where: { id: scope.id, tenantId: ctx.tenantId, formId } });
    if (!approval) fail(404, "NOT_FOUND", "승인 요청을 찾을 수 없습니다.");
    return { parent: { approvalId: approval.id }, serviceId: form.serviceId };
  }
  if (form.version !== scope.version) fail(409, "VERSION_CONFLICT", "폼이 변경되었습니다. 다시 불러와주세요.");
  const version = form.versions.find(row => row.status === "draft") ?? form.versions[0];
  if (!version) fail(404, "NOT_FOUND", "캐치폼 문항을 찾을 수 없습니다.");
  await tx.$queryRaw`SELECT id FROM "FormVersion" WHERE id=${version.id} FOR SHARE`;
  return { parent: { formVersionId: version.id }, serviceId: form.serviceId };
}
export async function memberAuthorAssets(ctx: Context, scope: AuthorAssetReadScope, requestId: string, id?: string) {
  return db.$transaction(tx => withFormAccess(tx, ctx, scope.kind === "submission" ? "submission.read" : "form.read", async () => {
    const selected = await lockMemberParent(tx, ctx, scope), result = await readPinnedAuthorAssets(tx, selected.parent, id);
    if (id) await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, serviceId: selected.serviceId, requestId,
      resource: "author-asset", resourceId: id, action: "author_asset.downloaded", detail: { parentKind: scope.kind, parentId: scope.id } } });
    if (selected.deadline && selected.deadline.getTime() <= Date.now()) fail(410, "SUBMISSION_UNAVAILABLE", "응답 보유 기한이 만료되었습니다.");
    return result;
  }), { timeout: 15000 });
}
export async function publicAuthorAssets(token: string, requestId: string, id?: string,
  access: { surface?: "active" | "closed" | "completion"; proof?: string; participationProof?: string } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  return db.$transaction(async tx => {
    const initial = await tx.publication.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true } });
    if (!initial) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
    const surface = access.surface ?? "active";
    let publication;
    if (surface === "completion") {
      publication = await lockPublicPublication(tx, initial.id);
      await lockCompletionProof(tx, publication, access.proof ?? "");
    } else {
      const view = await lockPublicPublicationView(tx, initial.id);
      if (view.state !== surface) fail(410, "PUBLICATION_SURFACE_CLOSED", "현재 공개 폼 상태에서는 이 안내를 열람할 수 없습니다.");
      publication = view.publication;
      if (surface === "active") await requireParticipationSession(tx, publication, access.participationProof);
    }
    const slots = surface === "active" ? ["material", "option", "question", "form_content", "page_content"]
      : surface === "completion" ? ["end_page_content"] : ["private_page_content"];
    const result = await readPinnedAuthorAssets(tx, { formVersionId: publication.formVersionId, selectors: [{ slots }] }, id);
    if (id) await tx.auditEvent.create({ data: { tenantId: publication.tenantId, serviceId: publication.form.serviceId, requestId,
      resource: "author-asset", resourceId: id, action: "author_asset.public_downloaded", detail: { publicationId: publication.id, surface } } });
    if (surface === "completion") {
      const current = await lockPublicPublication(tx, publication.id);
      await lockCompletionProof(tx, current, access.proof ?? "");
    } else {
      const current = await lockPublicPublicationView(tx, publication.id);
      if (current.state !== surface) fail(410, "PUBLICATION_SURFACE_CLOSED", "현재 공개 폼 상태에서는 이 안내를 열람할 수 없습니다.");
      if (surface === "active") await requireParticipationSession(tx, current.publication, access.participationProof);
    }
    return result;
  }, { timeout: 15000 });
}
