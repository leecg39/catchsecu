import { z } from "zod";
import { db, type Transaction } from "./db";
import { type Context } from "./context";
import { lockCurrentForm } from "./forms";
import { formScope, lockFormService } from "./form-access";
import { fail, listQuery } from "./http";
import { audit } from "./audit";
import { decrypt } from "./crypto";
import { publicForm } from "./submissions";

export const fixedUrlInput = z.object({
  name: z.string().trim().min(1).max(200),
  formId: z.uuid(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "URL은 영문 소문자·숫자·하이픈 3~64자로 입력해주세요.").optional(),
}).strict();
export const fixedUrlPatch = fixedUrlInput.omit({ slug:true }).partial().extend({ version:z.number().int().positive() })
  .refine(input => input.name !== undefined || input.formId !== undefined,"변경할 이름이나 연결 폼을 입력해주세요.");
export const fixedUrlQuery = listQuery.extend({ serviceId:z.uuid().optional(),status:z.enum(["active","revoked"]).default("active") }).strict();
const include = { publication: { select: { formId: true, form: { select: { serviceId: true, title: true } } } } };
type Row = Awaited<ReturnType<typeof locate>>;
export function fixedUrlDto(row: Row) {
  return { id: row.id, name: row.name, slug: row.slug, status: row.status, version: row.version, createdAt: row.createdAt,
    formId: row.publication.formId, formTitle: row.publication.form.title, url: "/url/" + row.slug };
}
async function locate(tx: Transaction, ctx: Context, id: string, write = false) {
  await formScope(tx,ctx,write ? "form.publish":"form.read");
  const row = await tx.fixedUrl.findFirst({ where: { id, tenantId: ctx.tenantId }, include });
  if (!row) fail(404, "NOT_FOUND", "고정 URL을 찾을 수 없습니다.");
  await lockFormService(tx,ctx,row.publication.form.serviceId,write ? "form.publish":"form.read",write);
  return row;
}
export async function requireFixedUrl(ctx: Context, id: string, write = false) {
  return db.$transaction(async tx => {
    await formScope(tx,ctx,write ? "form.publish":"form.read");
    await tx.$queryRaw`SELECT id FROM "FixedUrl" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    return locate(tx,ctx,id,write);
  });
}
export async function listFixedUrls(ctx: Context, query: { page: number; pageSize: number; search: string; status?: string; serviceId?: string; sort?: "name" | "createdAt"; direction?: "asc" | "desc" }) {
  return db.$transaction(async tx => {
  const scope=await formScope(tx,ctx,"form.read");
  if (query.serviceId) await lockFormService(tx,ctx,query.serviceId,"form.read",false);
  const services = await tx.service.findMany({ where: scope, select: { id: true } });
  const where = { tenantId: ctx.tenantId, status: query.status ?? "active",
    name: { contains: query.search, mode: "insensitive" as const },
    publication: { form: { serviceId: query.serviceId ?? { in: services.map(service => service.id) } } } };
  const total=await tx.fixedUrl.count({ where }),page=Math.min(query.page,Math.max(1,Math.ceil(total/query.pageSize)));
  const items=await tx.fixedUrl.findMany({ where, include, orderBy: [query.sort === "name" ? { name:query.direction ?? "desc" } : { createdAt:query.direction ?? "desc" },{ id:"asc" }],skip:(page-1)*query.pageSize,take:query.pageSize });
  return { items: items.map(fixedUrlDto), total, page, pageSize: query.pageSize };
  });
}
type Form = Awaited<ReturnType<typeof lockCurrentForm>>["form"];
function activePublication(form: Form) {
  const publication=form.publications[0];
  if (form.status !== "published" || !publication || publication.formVersionId !== form.publishedVersionId || (publication.expiresAt && publication.expiresAt <= new Date()))
    fail(409,"NOT_PUBLISHED","유효한 게시 링크가 있는 캐치폼을 선택해주세요.");
  return publication;
}
export async function createFixedUrl(ctx: Context, input: z.infer<typeof fixedUrlInput>, requestId: string, tx: Transaction) {
  const { form }=await lockCurrentForm(tx,ctx,input.formId,"form.publish"),publication=activePublication(form);
    const row = await tx.fixedUrl.create({ data: { tenantId: ctx.tenantId, publicationId: publication.id,
      name: input.name, slug: input.slug ?? crypto.randomUUID().replaceAll("-", "") }, include });
    await audit(tx, ctx, requestId, "fixed_url.created", "fixedUrl", row.id, ["name", "formId"], form.serviceId);
    return fixedUrlDto(row);
}
async function lockedFixed(tx: Transaction,ctx: Context,id: string,targetId?: string) {
  await formScope(tx,ctx,"form.publish");
  const initial=await tx.fixedUrl.findFirst({ where:{ id,tenantId:ctx.tenantId },include });
  if (!initial) fail(404,"NOT_FOUND","고정 URL을 찾을 수 없습니다.");
  const sourceId=initial.publication.formId;
  // Publication also locks Form before FixedUrl; keep that order for retarget/revoke.
  await tx.$queryRaw`SELECT id FROM "Form" WHERE "tenantId"=${ctx.tenantId} AND id IN (${sourceId},${targetId ?? sourceId}) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "FixedUrl" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  const current=await tx.fixedUrl.findUniqueOrThrow({ where:{ id },include });
  if (current.publication.formId !== sourceId) fail(409,"VERSION_CONFLICT","연결 대상이 변경되었습니다. 최신 내용을 불러와주세요.");
  await lockCurrentForm(tx,ctx,sourceId,"form.publish",true);
  return { current,target:targetId ? (await lockCurrentForm(tx,ctx,targetId,"form.publish")).form : null };
}
export async function updateFixedUrl(ctx: Context, id: string, input: z.infer<typeof fixedUrlPatch>, requestId: string) {
  fixedUrlPatch.parse(input);
  return db.$transaction(async tx => {
    const { current,target }=await lockedFixed(tx,ctx,id,input.formId),publication=target ? activePublication(target):null;
    const changed = await tx.fixedUrl.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: "active" },
      data: { name: input.name, publicationId: publication?.id, version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "고정 URL이 변경되었거나 폐기되었습니다.");
    await audit(tx, ctx, requestId, "fixed_url.updated", "fixedUrl", id, Object.keys(input).filter(key => key !== "version"), current.publication.form.serviceId);
    return fixedUrlDto(await tx.fixedUrl.findUniqueOrThrow({ where: { id }, include }));
  },{ timeout:15000 });
}
export async function revokeFixedUrl(ctx: Context, id: string, version: number, requestId: string) {
  await db.$transaction(async tx => {
    const { current }=await lockedFixed(tx,ctx,id);
    const changed = await tx.fixedUrl.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: "active" }, data: { status: "revoked", version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "고정 URL이 변경되었거나 폐기되었습니다.");
    await audit(tx, ctx, requestId, "fixed_url.revoked", "fixedUrl", id, ["status"], current.publication.form.serviceId);
  },{ timeout:15000 });
}
export async function resolveFixedUrl(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) fail(404, "NOT_FOUND", "고정 URL을 찾을 수 없습니다.");
  const row = await db.fixedUrl.findUnique({ where: { slug }, include: { publication: { select: { tokenCipher: true } } } });
  if (!row) fail(404, "NOT_FOUND", "고정 URL을 찾을 수 없습니다.");
  if (row.status !== "active") fail(410, "URL_REVOKED", "사용이 종료된 고정 URL입니다.");
  const token = decrypt<string>(row.publication.tokenCipher);
  return { ...await publicForm(token), token };
}
