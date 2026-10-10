import { authorAssetScope, copyAuthorAssets, withAuthorAssetReferences } from "./author-asset-references";
import { lockFileQuota } from "./file-quota";
import { formScope, lockFormService, formTransaction, withFormAccess } from "./form-access";
import { cloneFormContent } from "@/contracts/form-copy";
import { validateDocumentSelections } from "./form-documents";
import { z } from "zod";
import { type Transaction } from "./db";
import { type Context } from "./context";
import { audit } from "./audit";
import { fail, listQuery } from "./http";
import { roleCan } from "./permissions";
import type { TemplateActions, TemplatePermissions } from "@/contracts/forms";
import { invalidateTemplateCache } from "./template-cache";
import { formContentSchema, validateFormForPublish } from "@/contracts/domains";
import { createForm, formDto } from "./forms";
import type { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import { checkedQuestionOptions } from "./question-options";
import { normalizeQuestionExplanations } from "@/contracts/question-explanations";
import { normalizeQuestionImages } from "@/contracts/question-images";
import { normalizeQuestionMaterials } from "@/contracts/question-materials";
import { normalizeQuestionPersonalInformation } from "@/contracts/question-personal-information";
import { normalizeFormContentRichBody } from "./form-rich-body";
import { FormPresentationError, normalizeFormPresentation } from "@/contracts/form-sections";

export const templateInput = z.object({
  serviceId: z.uuid(), title: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional(), thumbnailAssetId: z.uuid().nullable().optional(), content: formContentSchema,
}).strict();
export const templatePatch = templateInput.omit({ serviceId: true }).partial().extend({ version: z.number().int().positive() }).strict()
  .refine(input => input.title !== undefined || input.category !== undefined || input.description !== undefined
    || input.thumbnailAssetId !== undefined || input.content !== undefined, "변경할 제목·분류·설명·대표 이미지 또는 내용을 입력해주세요.");
export const templateListQuery = listQuery.extend({ scope: z.enum(["all", "company", "public"]).default("all"),
  status: z.enum(["active", "archived"]).default("active"), serviceId: z.uuid().optional() }).strict();
const include = { service: { select: { name: true } } };
function dto(row: Prisma.FormTemplateGetPayload<{ include: typeof include }>) {
  const content = formContentSchema.parse(row.content);
  if (content.bodyRich === null) delete content.bodyRich;
  content.questions = checkedQuestionOptions(normalizeQuestionImages(content.questions), [], (questionId, value) => {
    // Stable read fallback for legacy JSON; reading a template never writes or invents new IDs on each request.
    const hex = createHash("sha256").update(JSON.stringify([row.id, questionId, value])).digest("hex");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-8" + hex.slice(13, 16) + "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
  });
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service?.name ?? null, scope: row.tenantId ? "company" : "public",
    title: row.title, category: row.category, description: row.description, thumbnailAssetId: row.thumbnailAssetId,
    licenseScope: row.licenseScope as "SERVICE" | "ACTIVE_SUBSCRIPTION", licenseAvailable: row.licenseScope === "SERVICE",
    status: row.status as "active" | "archived",
    content, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function validContent(content: z.infer<typeof formContentSchema>) {
  try { validateFormForPublish(content); }
  catch (error) { fail(422, "INVALID_TEMPLATE", error instanceof Error ? error.message : "템플릿 내용을 확인해주세요."); }
}
function normalizeTemplatePresentation(content: z.infer<typeof formContentSchema>, current?: z.infer<typeof formContentSchema>) {
  try { return normalizeFormPresentation(content, current) as z.infer<typeof formContentSchema>; }
  catch (error) {
    if (error instanceof FormPresentationError) fail(422, error.code, error.message);
    throw error;
  }
}
async function readPermissions(tx: Transaction, ctx: Context, selectedServiceId?: string): Promise<TemplatePermissions> {
  const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id } });
  const targets = roleCan(member.role, "form.write") ? await tx.service.findMany({
    where: { ...await formScope(tx, ctx, "form.write"), status: "active" }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  }) : [];
  const now = new Date(), subscriptionActive = await tx.billingSubscription.count({ where: { tenantId: ctx.tenantId,
    status: { in: ["trialing", "active"] }, periodStart: { lte: now }, periodEnd: { gt: now }, OR: [{ cancelAt: null }, { cancelAt: { gt: now } }] } }) > 0;
  return { canCreate: targets.some(service => !selectedServiceId || service.id === selectedServiceId), subscriptionActive, targets };
}
function readDto(row: Prisma.FormTemplateGetPayload<{ include: typeof include }>, permissions: TemplatePermissions) {
  const writable = !!row.tenantId && permissions.targets.some(service => service.id === row.serviceId);
  const active = row.status === "active", licenseAvailable = row.licenseScope === "SERVICE" || permissions.subscriptionActive;
  return { ...dto(row), licenseAvailable,
    actions: { preview: true, use: active && permissions.targets.length > 0 && licenseAvailable, edit: active && writable,
      archive: active && writable, restore: !active && writable, remove: writable } };
}
async function assertTemplateLicense(tx: Transaction, ctx: Context, licenseScope: string) {
  if (licenseScope === "SERVICE") return;
  await tx.$queryRaw`SELECT id FROM "BillingSubscription" WHERE "tenantId"=${ctx.tenantId} ORDER BY id FOR SHARE`;
  const now = new Date(), active = await tx.billingSubscription.count({ where: { tenantId: ctx.tenantId,
    status: { in: ["trialing", "active"] }, periodStart: { lte: now }, periodEnd: { gt: now }, OR: [{ cancelAt: null }, { cancelAt: { gt: now } }] } });
  if (!active) fail(402, "SUBSCRIPTION_REQUIRED", "공용 캐치폼 템플릿을 사용하려면 유효한 구독이 필요합니다.");
}
async function locateTemplate(tx: Transaction, ctx: Context, id: string, write: boolean): Promise<ReturnType<typeof dto> & { actions?: TemplateActions }> {
  await formScope(tx, ctx, write ? "form.write" : "form.read");
  if (write) await tx.$queryRaw`SELECT id FROM "FormTemplate" WHERE id=${id} AND ("tenantId"=${ctx.tenantId} OR "tenantId" IS NULL) FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "FormTemplate" WHERE id=${id} AND ("tenantId"=${ctx.tenantId} OR "tenantId" IS NULL) FOR SHARE`;
  const row = await tx.formTemplate.findFirst({ where: { id, OR: [{ tenantId: ctx.tenantId }, { tenantId: null }] }, include });
  if (!row || !["active", "archived"].includes(row.status) || (!row.tenantId && row.status !== "active"))
    fail(404, "NOT_FOUND", "템플릿을 찾을 수 없습니다.");
  if (!row.tenantId) {
    if (write) fail(403, "PUBLIC_TEMPLATE_READ_ONLY", "공용 템플릿은 서비스 템플릿으로 복제한 뒤 수정해주세요.");
  } else {
    if (!row.serviceId) fail(409, "TEMPLATE_SERVICE_REQUIRED", "템플릿의 서비스 정보가 없습니다.");
    const service = await lockFormService(tx, ctx, row.serviceId, write ? "form.write" : "form.read", write);
    const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, select: { accessKind: true } });
    if (member.accessKind === "expert" && service.status !== "active") fail(404, "NOT_FOUND", "활성 서비스를 찾을 수 없습니다.");
  }
  return write ? dto(row) : readDto(row, await readPermissions(tx, ctx));
}
export async function getTemplate(ctx: Context, id: string, write = false, tx?: Transaction) {
  return tx ? withFormAccess(tx, ctx, write ? "form.write" : "form.read", () => locateTemplate(tx, ctx, id, write))
    : formTransaction(ctx, write ? "form.write" : "form.read", client => locateTemplate(client, ctx, id, write));
}
export async function listTemplates(ctx: Context, query: { page: number; pageSize: number; search: string; scope: "all" | "company" | "public";
  status?: "active" | "archived"; serviceId?: string; sort?: "createdAt" | "name"; direction?: "asc" | "desc" }) {
  return formTransaction(ctx, "form.read", async tx => {
    const allowed = await formScope(tx, ctx, "form.read");
    const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, select: { accessKind: true } });
    if (query.serviceId) {
      const service = await lockFormService(tx, ctx, query.serviceId, "form.read", false);
      if (member.accessKind === "expert" && service.status !== "active") fail(404, "NOT_FOUND", "활성 서비스를 찾을 수 없습니다.");
    }
    const services = await tx.service.findMany({ where: { ...allowed, ...(member.accessKind === "expert" ? { status: "active" } : {}) }, select: { id: true } });
    const permissions = await readPermissions(tx, ctx, query.serviceId);
    const status = query.status ?? "active";
    const company = { tenantId: ctx.tenantId, serviceId: query.serviceId ?? { in: services.map(service => service.id) }, status };
    const publicTemplate = { tenantId: null, status: "active" };
    const where = { OR: query.scope === "public" ? status === "active" ? [publicTemplate] : [] : query.scope === "company" ? [company]
      : status === "active" ? [publicTemplate, company] : [company],
      AND: [{ OR: [{ title: { contains: query.search, mode: "insensitive" as const } }, { category: { contains: query.search, mode: "insensitive" as const } },
        { description: { contains: query.search, mode: "insensitive" as const } }] }] };
    const total = await tx.formTemplate.count({ where }), page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const items = await tx.formTemplate.findMany({ where, include, skip: (page - 1) * query.pageSize, take: query.pageSize,
      orderBy: [{ [query.sort === "name" ? "title" : "createdAt"]: query.direction ?? "desc" }, { id: "asc" }] });
    return { items: items.map(row => readDto(row, permissions)), total, page, pageSize: query.pageSize, permissions };
  });
}
export async function createTemplate(ctx: Context, input: z.infer<typeof templateInput>, requestId: string, tx: Transaction) {
  return withFormAccess(tx, ctx, "form.write", async () => {
    await lockFormService(tx, ctx, input.serviceId, "form.write");
    const normalized = normalizeTemplatePresentation(normalizeFormContentRichBody(input.content));
    validContent(normalized);
    await validateDocumentSelections(tx, ctx, input.serviceId, normalized.documentConsents ?? [], normalized.retentionDays);
    const content = { ...normalized, questions: checkedQuestionOptions(normalizeQuestionImages(normalizeQuestionPersonalInformation(normalizeQuestionMaterials(normalizeQuestionExplanations(normalized.questions))))) };
    const row = await tx.formTemplate.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, title: input.title, category: input.category,
      description: input.description ?? "", thumbnailAssetId: input.thumbnailAssetId ?? null, content: content as Prisma.InputJsonValue }, include });
    await withAuthorAssetReferences(tx, authorAssetScope(ctx, input.serviceId), { kind: "template", id: row.id },
      { ...content, templateThumbnailAssetId: row.thumbnailAssetId }, requestId, async () => undefined);
    await audit(tx, ctx, requestId, "template.created", "template", row.id, ["title", "category", "description", "thumbnailAssetId", "content"], input.serviceId);
    return dto(row);
  });
}
export async function updateTemplate(ctx: Context, id: string, input: z.infer<typeof templatePatch>, requestId: string) {
  return formTransaction(ctx, "form.write", async tx => {
    const current = await locateTemplate(tx, ctx, id, true);
    if (current.status === "archived") fail(409, "TEMPLATE_ARCHIVED", "보관된 템플릿은 복원한 뒤 변경해주세요.");
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 다시 불러와주세요.");
    let content = input.content ? { ...input.content, questions: checkedQuestionOptions(
      normalizeQuestionImages(normalizeQuestionPersonalInformation(normalizeQuestionMaterials(normalizeQuestionExplanations(input.content.questions, current.content.questions), current.content.questions), current.content.questions), current.content.questions), current.content.questions) } : current.content;
    content = normalizeFormContentRichBody(content, current.content);
    content = normalizeTemplatePresentation(content, current.content);
    if (content.formLanguage === undefined && current.content.formLanguage) content.formLanguage = current.content.formLanguage;
    if (input.content) validContent(content);
    await validateDocumentSelections(tx, ctx, current.serviceId!, content.documentConsents ?? [], content.retentionDays);
    const thumbnailAssetId = input.thumbnailAssetId === undefined ? current.thumbnailAssetId : input.thumbnailAssetId;
    const changed = await withAuthorAssetReferences(tx, authorAssetScope(ctx, current.serviceId!), { kind: "template", id },
      { ...content, templateThumbnailAssetId: thumbnailAssetId }, requestId,
      () => tx.formTemplate.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version },
        data: { title: input.title, category: input.category, description: input.description, thumbnailAssetId,
          ...(input.content ? { content: content as Prisma.InputJsonValue } : {}), version: { increment: 1 } } }));
    if (!changed.count) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 다시 불러와주세요.");
    await audit(tx, ctx, requestId, "template.updated", "template", id, Object.keys(input).filter(key => key !== "version"), current.serviceId ?? undefined);
    return dto(await tx.formTemplate.findUniqueOrThrow({ where: { id }, include }));
  });
}
export async function deleteTemplate(ctx: Context, id: string, version: number, requestId: string) {
  await formTransaction(ctx, "form.write", async tx => {
    const current = await locateTemplate(tx, ctx, id, true);
    const removed = await withAuthorAssetReferences(tx, authorAssetScope(ctx, current.serviceId!), { kind: "template", id }, { questions: [], templateThumbnailAssetId: null }, requestId,
      () => tx.formTemplate.deleteMany({ where: { id, tenantId: ctx.tenantId, version } }));
    if (!removed.count) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었거나 이미 삭제되었습니다.");
    await invalidateTemplateCache(tx, ctx.tenantId, id);
    await audit(tx, ctx, requestId, "template.deleted", "template", id, [], current.serviceId ?? undefined);
  });
}
export async function changeTemplateStatus(ctx: Context, id: string, version: number, action: "archive" | "restore", requestId: string) {
  return formTransaction(ctx, "form.write", async tx => {
    const current = await locateTemplate(tx, ctx, id, true), expected = action === "archive" ? "active" : "archived";
    if (current.version !== version) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 최신 내용을 확인해주세요.");
    if (current.status !== expected) fail(409, action === "archive" ? "TEMPLATE_ARCHIVED" : "TEMPLATE_NOT_ARCHIVED",
      action === "archive" ? "이미 보관된 템플릿입니다." : "보관된 템플릿만 복원할 수 있습니다.");
    const changed = await tx.formTemplate.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: expected },
      data: { status: action === "archive" ? "archived" : "active", version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "템플릿 상태가 변경되었습니다. 최신 내용을 확인해주세요.");
    if (action === "archive") await invalidateTemplateCache(tx, ctx.tenantId, id);
    await audit(tx, ctx, requestId, action === "archive" ? "template.archived" : "template.restored", "template", id, ["status"], current.serviceId ?? undefined);
    return readDto(await tx.formTemplate.findUniqueOrThrow({ where: { id }, include }), await readPermissions(tx, ctx));
  });
}
export async function useTemplate(ctx: Context, id: string, input: { version: number; serviceId: string; title?: string }, requestId: string, tx: Transaction) {
  await lockFileQuota(tx, ctx.tenantId); // Before actor SHARE; reserve logical copy bytes atomically.
  return withFormAccess(tx, ctx, "form.write", async () => {
    const template = await getTemplate(ctx, id, false, tx);
    if (template.status === "archived") fail(409, "TEMPLATE_ARCHIVED", "보관된 템플릿은 복원한 뒤 사용할 수 있습니다.");
    if (template.version !== input.version) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 최신 내용을 확인해주세요.");
    await assertTemplateLicense(tx, ctx, template.licenseScope);
    // Snapshot the full schema and allocate new question identities for the independent form.
    await lockFormService(tx, ctx, input.serviceId, "form.write");
    const sourceScope = template.scope === "public" ? { tenantId: null, serviceId: null, memberId: null } : authorAssetScope(ctx, template.serviceId!);
    const content = cloneFormContent(await copyAuthorAssets(tx, ctx, input.serviceId, { kind: "template", id }, sourceScope, template.content, requestId));
    const form = await createForm(ctx, { serviceId: input.serviceId, title: input.title ?? template.title, content }, requestId, tx);
    await audit(tx, ctx, requestId, "template.used", "template", id, [], input.serviceId);
    return formDto(form, ctx);
  });
}
