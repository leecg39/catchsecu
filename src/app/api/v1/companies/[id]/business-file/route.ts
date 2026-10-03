import { z } from "zod";
import { requireContext } from "@/server/context";
import { fail, json, rateLimit, route } from "@/server/http";
import { deleteBusinessFile, downloadBusinessFile, uploadBusinessFile } from "@/server/company-management";
import { readFileBody } from "@/server/file-validation";
import { MAX_FILE_BYTES } from "@/contracts/files";
async function context(request: Request) {
  const ctx = await requireContext(request.headers, "company.manage");
  if (new URL(request.url).pathname.split("/").at(-2) !== ctx.tenantId) fail(404, "NOT_FOUND", "회사를 찾을 수 없습니다.");
  return ctx;
}
export const GET = route(async (request, requestId) => {
  const ctx = await context(request), id = new URL(request.url).searchParams.get("fileId");
  return downloadBusinessFile(ctx, id === null ? undefined : z.uuid().parse(id), requestId);
});
export const POST = route(async (request, requestId) => {
  const ctx = await context(request);
  await rateLimit("company:file:" + ctx.member.id, 15);
  const params = z.object({ name: z.string().min(1).max(200), size: z.coerce.number().int().min(1).max(MAX_FILE_BYTES) }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  const mime = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  const bytes = await readFileBody(request, params.size, mime);
  return json(await uploadBusinessFile(ctx, version, params.name, mime, bytes, requestId), 201);
});
export const DELETE = route(async (request, requestId) => {
  await deleteBusinessFile(await context(request), z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
