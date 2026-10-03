import { formScope, lockFormService } from "./form-access";
import { cloneFormContent } from "@/contracts/form-copy";
import { validateDocumentSelections } from "./form-documents";
import { z } from "zod";
import { db, type Transaction } from "./db";
import { type Context } from "./context";
import { audit } from "./audit";
import { fail, listQuery } from "./http";
import { roleCan } from "./permissions";
import type { TemplateActions, TemplatePermissions } from "@/contracts/forms";
import { invalidateTemplateCache } from "./template-cache";
import { formContentSchema, validateFormForPublish } from "@/contracts/domains";
import { createForm, formDto } from "./forms";
import type { Prisma } from "@/generated/prisma/client";

export const templateInput = z.object({ serviceId: z.uuid(), title: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(80), content: formContentSchema }).strict();
export const templatePatch = templateInput.omit({ serviceId: true }).partial().extend({ version: z.number().int().positive() }).strict()
  .refine(input => input.title !== undefined || input.category !== undefined || input.content !== undefined, "변경할 제목·분류 또는 내용을 입력해주세요.");
export const templateListQuery = listQuery.extend({ scope: z.enum(["all", "company", "public"]).default("all"), serviceId: z.uuid().optional() }).strict();
const include = { service: { select: { name: true } } };
function dto(row: Prisma.FormTemplateGetPayload<{ include: typeof include }>) {
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service?.name ?? null, scope: row.tenantId ? "company" : "public",
    title: row.title, category: row.category, content: formContentSchema.parse(row.content), version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function validContent(content: z.infer<typeof formContentSchema>) {
  try { validateFormForPublish(content); }
  catch (error) { fail(422, "INVALID_TEMPLATE", error instanceof Error ? error.message : "템플릿 내용을 확인해주세요."); }
}
async function readPermissions(tx: Transaction, ctx: Context, selectedServiceId?: string): Promise<TemplatePermissions> {
  const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id } });
  const targets = roleCan(member.role, "form.write") ? await tx.service.findMany({
    where: { ...await formScope(tx, ctx, "form.write"), status: "active" }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  }) : [];
  return { canCreate: targets.some(service => !selectedServiceId || service.id === selectedServiceId), targets };
}
function readDto(row: Prisma.FormTemplateGetPayload<{ include: typeof include }>, permissions: TemplatePermissions) {
  const writable = !!row.tenantId && permissions.targets.some(service => service.id === row.serviceId);
  return { ...dto(row), actions: { preview: true, use: permissions.targets.length > 0, edit: writable, remove: writable } };
}
async function locateTemplate(tx: Transaction, ctx: Context, id: string, write: boolean): Promise<ReturnType<typeof dto> & { actions?: TemplateActions }> {
  await formScope(tx, ctx, write ? "form.write" : "form.read");
  if (write) await tx.$queryRaw`SELECT id FROM "FormTemplate" WHERE id=${id} AND ("tenantId"=${ctx.tenantId} OR "tenantId" IS NULL) FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "FormTemplate" WHERE id=${id} AND ("tenantId"=${ctx.tenantId} OR "tenantId" IS NULL) FOR SHARE`;
  const row = await tx.formTemplate.findFirst({ where: { id, OR: [{ tenantId: ctx.tenantId }, { tenantId: null }] }, include });
  if (!row || row.status !== "active") fail(404, "NOT_FOUND", "템플릿을 찾을 수 없습니다.");
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
  return tx ? locateTemplate(tx, ctx, id, write) : db.$transaction(client => locateTemplate(client, ctx, id, write));
}
export async function listTemplates(ctx: Context, query: { page: number; pageSize: number; search: string; scope: "all" | "company" | "public"; serviceId?: string; sort?: "createdAt" | "name"; direction?: "asc" | "desc" }) {
  return db.$transaction(async tx => {
    const allowed = await formScope(tx, ctx, "form.read");
    const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, select: { accessKind: true } });
    if (query.serviceId) {
      const service = await lockFormService(tx, ctx, query.serviceId, "form.read", false);
      if (member.accessKind === "expert" && service.status !== "active") fail(404, "NOT_FOUND", "활성 서비스를 찾을 수 없습니다.");
    }
    const services = await tx.service.findMany({ where: { ...allowed, ...(member.accessKind === "expert" ? { status: "active" } : {}) }, select: { id: true } });
    const permissions = await readPermissions(tx, ctx, query.serviceId);
    const company = { tenantId: ctx.tenantId, serviceId: query.serviceId ?? { in: services.map(service => service.id) } };
    const where = { status: "active", OR: query.scope === "public" ? [{ tenantId: null }] : query.scope === "company" ? [company] : [{ tenantId: null }, company],
      AND: [{ OR: [{ title: { contains: query.search, mode: "insensitive" as const } }, { category: { contains: query.search, mode: "insensitive" as const } }] }] };
    const total = await tx.formTemplate.count({ where }), page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const items = await tx.formTemplate.findMany({ where, include, skip: (page - 1) * query.pageSize, take: query.pageSize,
      orderBy: [{ [query.sort === "name" ? "title" : "createdAt"]: query.direction ?? "desc" }, { id: "asc" }] });
    return { items: items.map(row => readDto(row, permissions)), total, page, pageSize: query.pageSize, permissions };
  });
}
export async function createTemplate(ctx: Context, input: z.infer<typeof templateInput>, requestId: string, tx: Transaction) {
  await lockFormService(tx, ctx, input.serviceId, "form.write");
  validContent(input.content);
  await validateDocumentSelections(tx, ctx, input.serviceId, input.content.documentConsents ?? [], input.content.retentionDays);
  const row = await tx.formTemplate.create({ data: { tenantId: ctx.tenantId, ...input, content: input.content as Prisma.InputJsonValue }, include });
  await audit(tx, ctx, requestId, "template.created", "template", row.id, ["title", "category", "content"], input.serviceId);
  return dto(row);
}
export async function updateTemplate(ctx: Context, id: string, input: z.infer<typeof templatePatch>, requestId: string) {
  if (input.content) validContent(input.content);
  return db.$transaction(async tx => {
    const current = await locateTemplate(tx, ctx, id, true);
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 다시 불러와주세요.");
    const content = input.content ?? current.content;
    await validateDocumentSelections(tx, ctx, current.serviceId!, content.documentConsents ?? [], content.retentionDays);
    const changed = await tx.formTemplate.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version },
      data: { title: input.title, category: input.category, ...(input.content ? { content: input.content as Prisma.InputJsonValue } : {}), version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 다시 불러와주세요.");
    await audit(tx, ctx, requestId, "template.updated", "template", id, Object.keys(input).filter(key => key !== "version"), current.serviceId ?? undefined);
    return dto(await tx.formTemplate.findUniqueOrThrow({ where: { id }, include }));
  });
}
export async function deleteTemplate(ctx: Context, id: string, version: number, requestId: string) {
  await db.$transaction(async tx => {
    const current = await locateTemplate(tx, ctx, id, true);
    const removed = await tx.formTemplate.deleteMany({ where: { id, tenantId: ctx.tenantId, version } });
    if (!removed.count) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었거나 이미 삭제되었습니다.");
    await invalidateTemplateCache(tx, ctx.tenantId, id);
    await audit(tx, ctx, requestId, "template.deleted", "template", id, [], current.serviceId ?? undefined);
  });
}
export async function useTemplate(ctx: Context, id: string, input: { version: number; serviceId: string; title?: string }, requestId: string, tx: Transaction) {
  const template = await getTemplate(ctx, id, false, tx);
  if (template.version !== input.version) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 최신 내용을 확인해주세요.");
  // Snapshot the full schema and allocate new question identities for the independent form.
  const content = cloneFormContent(template.content);
  const form = await createForm(ctx, { serviceId: input.serviceId, title: input.title ?? template.title, content }, requestId, tx);
  await audit(tx, ctx, requestId, "template.used", "template", id, [], input.serviceId);
  return formDto(form, ctx);
}
