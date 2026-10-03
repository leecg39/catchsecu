import { z } from "zod";
import { db, type Transaction } from "./db";
import { type Context, requireService, serviceScope } from "./context";
import { requireForm } from "./forms";
import { fail } from "./http";
import { audit } from "./audit";
import { decrypt } from "./crypto";
import { publicForm } from "./submissions";

export const fixedUrlInput = z.object({
  name: z.string().trim().min(1).max(200),
  formId: z.uuid(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "URL은 영문 소문자·숫자·하이픈 3~64자로 입력해주세요.").optional(),
}).strict();
const include = { publication: { select: { formId: true, form: { select: { serviceId: true, title: true } } } } };
type Row = Awaited<ReturnType<typeof requireFixedUrl>>;
export function fixedUrlDto(row: Row) {
  return { id: row.id, name: row.name, slug: row.slug, status: row.status, version: row.version, createdAt: row.createdAt,
    formId: row.publication.formId, formTitle: row.publication.form.title, url: "/url/" + row.slug };
}
export async function requireFixedUrl(ctx: Context, id: string, write = false) {
  const row = await db.fixedUrl.findFirst({ where: { id, tenantId: ctx.tenantId }, include });
  if (!row) fail(404, "NOT_FOUND", "고정 URL을 찾을 수 없습니다.");
  await requireService(ctx, row.publication.form.serviceId, write ? "form.publish" : "form.read");
  return row;
}
export async function listFixedUrls(ctx: Context, query: { page: number; pageSize: number; search: string; status?: string; serviceId?: string }) {
  if (query.serviceId) await requireService(ctx, query.serviceId, "form.read");
  const services = await db.service.findMany({ where: serviceScope(ctx, "form.read"), select: { id: true } });
  const where = { tenantId: ctx.tenantId, status: query.status ?? "active",
    name: { contains: query.search, mode: "insensitive" as const },
    publication: { form: { serviceId: query.serviceId ?? { in: services.map(service => service.id) } } } };
  const [items, total] = await db.$transaction([
    db.fixedUrl.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    db.fixedUrl.count({ where }),
  ]);
  return { items: items.map(fixedUrlDto), total, page: query.page, pageSize: query.pageSize };
}
export async function createFixedUrl(ctx: Context, input: z.infer<typeof fixedUrlInput>, requestId: string, tx: Transaction) {
  const form = await requireForm(ctx, input.formId, "form.publish"), publication = form.publications[0];
  if (form.status !== "published" || !publication || (publication.expiresAt && publication.expiresAt <= new Date())) fail(409, "NOT_PUBLISHED", "유효한 게시 링크가 있는 캐치폼을 선택해주세요.");
    await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${form.id} FOR UPDATE`;
    const live = await tx.form.findUniqueOrThrow({ where: { id: form.id }, select: { status: true, publishedVersionId: true } });
    if (live.status !== "published" || live.publishedVersionId !== publication.formVersionId) fail(409, "VERSION_CONFLICT", "게시 상태가 변경되었습니다. 다시 선택해주세요.");
    const row = await tx.fixedUrl.create({ data: { tenantId: ctx.tenantId, publicationId: publication.id,
      name: input.name, slug: input.slug ?? crypto.randomUUID().replaceAll("-", "") }, include });
    await audit(tx, ctx, requestId, "fixed_url.created", "fixedUrl", row.id, ["name", "formId"], form.serviceId);
    return fixedUrlDto(row);
}
export async function updateFixedUrl(ctx: Context, id: string, input: { version: number; name?: string; formId?: string }, requestId: string) {
  const current = await requireFixedUrl(ctx, id, true);
  const form = input.formId ? await requireForm(ctx, input.formId, "form.publish") : null, publication = form?.publications[0];
  if (form && (form.status !== "published" || !publication || (publication.expiresAt && publication.expiresAt <= new Date()))) fail(409, "NOT_PUBLISHED", "유효한 게시 링크가 있는 캐치폼을 선택해주세요.");
  return db.$transaction(async tx => {
    if (form) {
      await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${form.id} FOR UPDATE`;
      const live = await tx.form.findUniqueOrThrow({ where: { id: form.id }, select: { status: true, publishedVersionId: true } });
      if (live.status !== "published" || live.publishedVersionId !== publication!.formVersionId) fail(409, "VERSION_CONFLICT", "게시 상태가 변경되었습니다. 다시 선택해주세요.");
    }
    const changed = await tx.fixedUrl.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: "active" },
      data: { name: input.name, publicationId: publication?.id, version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "고정 URL이 변경되었거나 폐기되었습니다.");
    await audit(tx, ctx, requestId, "fixed_url.updated", "fixedUrl", id, Object.keys(input).filter(key => key !== "version"), current.publication.form.serviceId);
    return fixedUrlDto(await tx.fixedUrl.findUniqueOrThrow({ where: { id }, include }));
  });
}
export async function revokeFixedUrl(ctx: Context, id: string, version: number, requestId: string) {
  const current = await requireFixedUrl(ctx, id, true);
  await db.$transaction(async tx => {
    const changed = await tx.fixedUrl.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: "active" }, data: { status: "revoked", version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "고정 URL이 변경되었거나 폐기되었습니다.");
    await audit(tx, ctx, requestId, "fixed_url.revoked", "fixedUrl", id, ["status"], current.publication.form.serviceId);
  });
}
export async function resolveFixedUrl(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) fail(404, "NOT_FOUND", "고정 URL을 찾을 수 없습니다.");
  const row = await db.fixedUrl.findUnique({ where: { slug }, include: { publication: { select: { tokenCipher: true } } } });
  if (!row) fail(404, "NOT_FOUND", "고정 URL을 찾을 수 없습니다.");
  if (row.status !== "active") fail(410, "URL_REVOKED", "사용이 종료된 고정 URL입니다.");
  const token = decrypt<string>(row.publication.tokenCipher);
  return { ...await publicForm(token), token };
}
