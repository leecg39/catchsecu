import { documentScope } from "./documents";
import { validateDocumentSelections } from "./form-documents";
import { z } from "zod";
import { db, type Transaction } from "./db";
import { type Context, requireService, serviceScope } from "./context";
import { audit } from "./audit";
import { fail } from "./http";
import { formContentSchema, validateFormForPublish } from "@/contracts/domains";
import { createForm, formDto } from "./forms";
import type { Prisma } from "@/generated/prisma/client";

export const templateInput = z.object({ serviceId: z.uuid(), title: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(80), content: formContentSchema }).strict();
export const templatePatch = templateInput.omit({ serviceId: true }).partial().extend({ version: z.number().int().positive() }).strict();
const include = { service: { select: { name: true } } };
function dto(row: Prisma.FormTemplateGetPayload<{ include: typeof include }>) {
  return { id: row.id, serviceId: row.serviceId, serviceName: row.service?.name ?? null, scope: row.tenantId ? "company" : "public",
    title: row.title, category: row.category, content: formContentSchema.parse(row.content), version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function validContent(content: z.infer<typeof formContentSchema>) {
  try { validateFormForPublish(content); }
  catch (error) { fail(422, "INVALID_TEMPLATE", error instanceof Error ? error.message : "템플릿 내용을 확인해주세요."); }
}
export async function getTemplate(ctx: Context, id: string, write = false, tx: Transaction = db) {
  const row = await tx.formTemplate.findFirst({ where: { id, OR: [{ tenantId: ctx.tenantId }, { tenantId: null }] }, include });
  if (!row || row.status !== "active") fail(404, "NOT_FOUND", "템플릿을 찾을 수 없습니다.");
  if (!row.tenantId) {
    if (write) fail(403, "PUBLIC_TEMPLATE_READ_ONLY", "공용 템플릿은 서비스 템플릿으로 복제한 뒤 수정해주세요.");
  } else {
    if (!row.serviceId) fail(409, "TEMPLATE_SERVICE_REQUIRED", "템플릿의 서비스 정보가 없습니다.");
    await requireService(ctx, row.serviceId, write ? "form.write" : "form.read");
  }
  return dto(row);
}
export async function listTemplates(ctx: Context, query: { page: number; pageSize: number; search: string; scope: "all" | "company" | "public"; serviceId?: string }) {
  if (query.serviceId) await requireService(ctx, query.serviceId, "form.read");
  const allowed = serviceScope(ctx, "form.read");
  const company = { tenantId: ctx.tenantId, ...(query.serviceId ? { serviceId: query.serviceId } : allowed.id ? { serviceId: allowed.id } : {}) };
  const where = { status: "active", OR: query.scope === "public" ? [{ tenantId: null }] : query.scope === "company" ? [company] : [{ tenantId: null }, company],
    AND: [{ OR: [{ title: { contains: query.search, mode: "insensitive" as const } }, { category: { contains: query.search, mode: "insensitive" as const } }] }] };
  const [items, total] = await db.$transaction([
    db.formTemplate.findMany({ where, include, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }),
    db.formTemplate.count({ where }),
  ]);
  return { items: items.map(dto), total, page: query.page, pageSize: query.pageSize };
}
export async function createTemplate(ctx: Context, input: z.infer<typeof templateInput>, requestId: string, tx: Transaction) {
  const scope = await documentScope(tx, ctx, "form.write");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${input.serviceId} FOR SHARE`;
  const service = await tx.service.findFirst({ where: { AND: [scope, { id: input.serviceId }] } });
  if (!service) fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  if (service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에는 템플릿을 등록할 수 없습니다.");
  validContent(input.content);
  await validateDocumentSelections(tx, ctx, input.serviceId, input.content.documentConsents ?? [], input.content.retentionDays);
  const row = await tx.formTemplate.create({ data: { tenantId: ctx.tenantId, ...input, content: input.content as Prisma.InputJsonValue }, include });
  await audit(tx, ctx, requestId, "template.created", "template", row.id, ["title", "category", "content"], input.serviceId);
  return dto(row);
}
export async function updateTemplate(ctx: Context, id: string, input: z.infer<typeof templatePatch>, requestId: string) {
  const current = await getTemplate(ctx, id, true);
  if (input.content) validContent(input.content);
  return db.$transaction(async tx => {
    const scope = await documentScope(tx, ctx, "form.write");
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${current.serviceId} FOR SHARE`;
    if (!await tx.service.findFirst({ where: { AND: [scope, { id: current.serviceId!, status: "active" }] } })) fail(403, "SERVICE_FORBIDDEN", "이 서비스의 템플릿을 변경할 수 없습니다.");
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
  const current = await getTemplate(ctx, id, true);
  await db.$transaction(async tx => {
    const removed = await tx.formTemplate.deleteMany({ where: { id, tenantId: ctx.tenantId, version } });
    if (!removed.count) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었거나 이미 삭제되었습니다.");
    await audit(tx, ctx, requestId, "template.deleted", "template", id, [], current.serviceId ?? undefined);
  });
}
export async function useTemplate(ctx: Context, id: string, input: { version: number; serviceId: string; title?: string }, requestId: string, tx: Transaction) {
  const template = await getTemplate(ctx, id, false, tx);
  if (template.version !== input.version) fail(409, "VERSION_CONFLICT", "템플릿이 변경되었습니다. 최신 내용을 확인해주세요.");
  // Snapshot the full schema and allocate new question identities for the independent form.
  const ids = new Map(template.content.questions.map(question => [question.id, crypto.randomUUID()]));
  const original = template.content.marketing;
  const content = { ...template.content, questions: template.content.questions.map(question => ({ ...question, id: ids.get(question.id)! })),
    ...(original ? { marketing: { ...original, nameQuestionId: ids.get(original.nameQuestionId)!,
      ...(original.emailQuestionId ? { emailQuestionId: ids.get(original.emailQuestionId)! } : {}),
      ...(original.smsQuestionId ? { smsQuestionId: ids.get(original.smsQuestionId)! } : {}) } } : {}) };
  const form = await createForm(ctx, { serviceId: input.serviceId, title: input.title ?? template.title, content }, requestId, tx);
  await audit(tx, ctx, requestId, "template.used", "template", id, [], input.serviceId);
  return formDto(form, ctx);
}
