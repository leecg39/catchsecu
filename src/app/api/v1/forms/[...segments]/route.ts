import { approvalRequestInput } from "@/contracts/security";
import { approvalForForm, requestApproval } from "@/server/approvals";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { requireContext } from "@/server/context";
import { body, fail, json, listQuery, route } from "@/server/http";
import { archiveForm, contentDto, createForm, formDto, formPatch, publishForm, requireForm, updateForm } from "@/server/forms";
import { listSubmissions } from "@/server/submissions";
import { idempotent } from "@/server/idempotency";
function parts(request: Request) {
  const [id, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: z.uuid().parse(id), action };
}
export const GET = route(async (request, requestId) => {
  const { id, action } = parts(request);
  const ctx = await requireContext(request.headers, action === "submissions" ? "submission.read" : "form.read");
  if (action === "submissions") {
    const query = listQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return json(await listSubmissions(ctx, id, query.page, query.pageSize, requestId));
  }
  if (action === "approvals") {
    const query = listQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return json(await approvalForForm(ctx, id, query.page, query.pageSize));
  }
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(formDto(await requireForm(ctx, id), ctx));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action && action !== "draft") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.write"), input = await body(request, formPatch);
  return json(formDto(await updateForm(ctx, id, input, requestId), ctx));
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request);
  const ctx = await requireContext(request.headers, action === "publish" ? "form.publish" : "form.write");
  if (action === "approvals") {
    const input = await body(request, approvalRequestInput);
    const result = await idempotent("approval:request:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input,
      async tx => ({ status: 201, body: await requestApproval(tx, ctx, id, input, requestId) }));
    return json(result.body, result.status);
  }
  if (action === "publish") {
    const input = await body(request, z.object({ version: z.number().int().positive(), expiresAt: z.iso.datetime().optional() }).strict());
    const result = await idempotent("form:publish:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input,
      async tx => ({ status: 201, body: await publishForm(tx, ctx, id, input, requestId) }));
    return json(result.body, result.status);
  }
  if (action === "copy") {
    const input = await body(request, z.object({ title: z.string().trim().min(1).max(200).optional() }).strict());
    const original = await requireForm(ctx, id, "form.write");
    const result = await idempotent("form:copy:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input, async tx => ({
      status: 201, body: formDto(await createForm(ctx, { serviceId: original.serviceId, title: input.title ?? original.title + " (복사)", content: contentDto(original.versions[0]) }, requestId, tx), ctx),
    }));
    return json(result.body, result.status);
  }
  if (action === "pause" || action === "resume") {
    const input = await body(request, z.object({ version: z.number().int().positive() }).strict());
    const form = await requireForm(ctx, id, "form.publish");
    const status = action === "pause" ? "paused" : "published";
    if (action === "resume") {
      const active = form.publications[0];
      if (!active || (active.expiresAt && active.expiresAt <= new Date())) fail(409, "PUBLICATION_CLOSED", "유효한 게시 링크가 없습니다. 다시 게시해주세요.");
    }
    await db.$transaction(async tx => {
      const updated = await tx.form.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: action === "pause" ? "published" : "paused" }, data: { status, version: { increment: 1 } } });
      if (!updated.count) fail(409, "INVALID_TRANSITION", "변경되었거나 게시 중인 폼이 아닙니다.");
      await audit(tx, ctx, requestId, "form." + status, "form", id, ["status"], form.serviceId);
    });
    return json(formDto(await requireForm(ctx, id), ctx));
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request);
  const ctx = await requireContext(request.headers, action === "favorite" ? "form.read" : "form.write");
  if (action === "favorite") {
    await requireForm(ctx, id);
    await db.formFavorite.deleteMany({ where: { tenantId: ctx.tenantId, memberId: ctx.member.id, formId: id } });
    return new Response(null, { status: 204 });
  }
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await archiveForm(ctx, id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
export const PUT = route(async request => {
  const { id, action } = parts(request);
  if (action !== "favorite") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.read");
  await requireForm(ctx, id);
  await db.formFavorite.upsert({ where: { tenantId_memberId_formId: { tenantId: ctx.tenantId, memberId: ctx.member.id, formId: id } },
    update: {}, create: { tenantId: ctx.tenantId, memberId: ctx.member.id, formId: id } });
  return json({ favorite: true });
});
