import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { getMember, memberInput, removeMember, transferOwnership, updateMember } from "@/server/members";
import { auth } from "@/server/auth";
function parts(request: Request) {
  const [rawId, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: z.uuid().parse(rawId), action };
}
export const GET = route(async request => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await getMember(await requireContext(request.headers, "member.manage"), id));
});
export const PATCH = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateMember(await requireContext(request.headers, "member.manage"), id, await body(request, memberInput), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await removeMember(await requireContext(request.headers, "member.manage"), id, z.coerce.number().int().positive().parse(request.headers.get("if-match")), requestId);
  return new Response(null, { status: 204 });
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request); if (action !== "transfer") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "member.manage");
  if (ctx.member.role !== "owner") fail(403, "OWNER_REQUIRED", "회사 소유자만 소유권을 이전할 수 있습니다.");
  const input = await body(request, z.object({ version: z.number().int().positive(), password: z.string().min(1).max(128) }).strict());
  await rateLimit("ownership:" + ctx.member.id, 5);
  try {
    const result = await auth.api.verifyPassword({ headers: request.headers, body: { password: input.password } });
    if (!result.status) fail(401, "PASSWORD_REQUIRED", "현재 비밀번호를 확인해주세요.");
  } catch { fail(401, "PASSWORD_REQUIRED", "현재 비밀번호를 확인해주세요."); }
  return json(await transferOwnership(ctx, id, input.version, requestId));
});
