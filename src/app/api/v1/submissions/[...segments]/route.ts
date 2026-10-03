import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { actionInput, changeSubmission, correctionInput, correctSubmission, createNote, getSubmission, mutateNote, noteInput } from "@/server/submission-management";
import { idempotent } from "@/server/idempotency";
import { changeRetention } from "@/server/destruction";
import { retentionInput } from "@/contracts/destruction";
import { lockSubmission } from "@/server/submission-access";
function parts(request: Request) {
  const [rawId, action, rawNoteId, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: z.uuid().parse(rawId), action, noteId: rawNoteId ? z.uuid().parse(rawNoteId) : undefined };
}
export const GET = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await getSubmission(await requireContext(request.headers, "submission.read"), id, requestId));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action, noteId } = parts(request), ctx = await requireContext(request.headers, action === "retention" ? "submission.destroy" : "submission.write");
  if (action === "retention" && !noteId) return json(await changeRetention(ctx, id, await body(request, retentionInput), requestId));
  if (action === "notes" && noteId) return json(await mutateNote(ctx, id, noteId, await body(request, noteInput.extend({ version: z.number().int().positive() })), requestId));
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await correctSubmission(ctx, id, await body(request, correctionInput), requestId));
});
export const POST = route(async (request, requestId) => {
  const { id, action, noteId } = parts(request);
  if (noteId) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  if (action === "notes") {
    const ctx = await requireContext(request.headers, "submission.write"), input = await body(request, noteInput);
    const result = await idempotent("submission:note:" + ctx.member.id + ":" + id, request.headers.get("idempotency-key"), input,
      async tx => ({ status: 201, body: await createNote(ctx, id, input, requestId, tx),
        resource: { tenantId: ctx.tenantId, resourceType: "submission", resourceId: id } }),
      tx => lockSubmission(tx, ctx, id, "submission.write"));
    return json(result.body, result.status);
  }
  if (!["withdraw", "destruction-request", "hold"].includes(action)) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, action === "withdraw" ? "submission.write" : "submission.destroy");
  const input = action === "hold" ? await body(request, actionInput.extend({ hold: z.boolean() })) : await body(request, actionInput);
  return json(await changeSubmission(ctx, id, action as "withdraw" | "destruction-request" | "hold", input, requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action, noteId } = parts(request);
  if (action !== "notes" || !noteId) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "submission.write");
  await mutateNote(ctx, id, noteId, { version: z.coerce.number().int().positive().parse(request.headers.get("if-match")) }, requestId);
  return new Response(null, { status: 204 });
});
