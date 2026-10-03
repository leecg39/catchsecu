import { approvalRequestInput } from "@/contracts/security";
import { approvalForForm, requestApproval } from "@/server/approvals";
import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, fail, json, listQuery, route } from "@/server/http";
import { archiveForm, copyForm, formDeletionState, formDto, formPatch, lockCurrentForm, publishForm, purgeForm, readForm, setFormFavorite, transitionForm, updateForm, updateFormDraft } from "@/server/forms";
import { listSubmissions } from "@/server/submissions";
import { idempotent } from "@/server/idempotency";
import { submissionListQuery } from "@/contracts/submissions";
function parts(request: Request) {
  const [id, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: z.uuid().parse(id), action };
}
type FormReply = ReturnType<typeof formDto>;
function draftReply(value: Omit<FormReply, "publication"> & { publication: Omit<NonNullable<FormReply["publication"]>, "token"> | null }) {
  const publication = value.publication;
  return { ...value, publication: publication ? { id: publication.id, responseCount: publication.responseCount,
    maxResponses: publication.maxResponses, expiresAt: publication.expiresAt } : null };
}
export const GET = route(async (request, requestId) => {
  const { id, action } = parts(request);
  const ctx = await requireContext(request.headers, action === "submissions" ? "submission.read" : "form.read");
  if (action === "submissions") {
    const query = submissionListQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return json(await listSubmissions(ctx, id, query.page, query.pageSize, requestId, query));
  }
  if (action === "approvals") {
    const query = listQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return json(await approvalForForm(ctx, id, query.page, query.pageSize));
  }
  if (action === "deletion") return json(await formDeletionState(ctx, id));
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await readForm(ctx,id));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action && action !== "draft") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.write"), input = await body(request, formPatch);
  const key = request.headers.get("idempotency-key");
  if (key !== null) {
    const result = await idempotent("form:draft:" + ctx.member.id + ":" + id, key, input,
      async tx => ({ status: 200, body: draftReply(formDto(await updateFormDraft(tx, ctx, id, input, requestId), ctx)),
        resource: { tenantId: ctx.tenantId, resourceType: "form", resourceId: id } }),
      tx => lockCurrentForm(tx, ctx, id, "form.write"));
    return json(draftReply(result.body), result.status);
  }
  return json(draftReply(formDto(await updateForm(ctx, id, input, requestId), ctx)));
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request);
  const ctx = await requireContext(request.headers, ["publish", "pause", "resume"].includes(action ?? "") ? "form.publish" : "form.write");
  if (action === "approvals") {
    const input = await body(request, approvalRequestInput);
    const result = await idempotent("approval:request:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input,
      async tx => ({ status: 201, body: await requestApproval(tx, ctx, id, input, requestId) }),
      tx => lockCurrentForm(tx,ctx,id,"form.write"));
    return json(result.body, result.status);
  }
  if (action === "publish") {
    const input = await body(request, z.object({ version: z.number().int().positive(), expiresAt: z.iso.datetime().optional() }).strict());
    const result = await idempotent("form:publish:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input,
      async tx => ({ status: 201, body: await publishForm(tx, ctx, id, input, requestId) }),
      tx => lockCurrentForm(tx,ctx,id,"form.publish"));
    return json(result.body, result.status);
  }
  if (action === "copy") {
    const input = await body(request, z.object({ title: z.string().trim().min(1).max(200).optional() }).strict());
    const result = await idempotent("form:copy:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input, async tx => {
      const copied = await copyForm(tx, ctx, id, input.title, requestId);
      return { status: 201, body: copied, resource: { tenantId: ctx.tenantId, resourceType: "form", resourceId: copied.id } };
    }, tx => lockCurrentForm(tx, ctx, id, "form.write", true));
    return json(result.body, result.status);
  }
  if (action === "pause" || action === "resume") {
    const input = await body(request, z.object({ version: z.number().int().positive() }).strict());
    return json(await transitionForm(ctx, id, input.version, action, requestId));
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request);
  const ctx = await requireContext(request.headers, action === "favorite" ? "form.read" : "form.write");
  if (action === "favorite") {
    await setFormFavorite(ctx, id, false);
    return new Response(null, { status: 204 });
  }
  if (action && action !== "purge") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  if (action === "purge") await purgeForm(ctx, id, version, requestId);
  else await archiveForm(ctx, id, version, requestId);
  return new Response(null, { status: 204 });
});
export const PUT = route(async request => {
  const { id, action } = parts(request);
  if (action !== "favorite") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.read");
  await setFormFavorite(ctx, id, true);
  return json({ favorite: true });
});
