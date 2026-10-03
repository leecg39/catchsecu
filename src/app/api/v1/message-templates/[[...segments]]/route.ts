import { z } from "zod";
import { messageTemplateCreate, messageTemplatePatch, messageTemplateList, messageTemplateVersion } from "@/contracts/message-templates";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { createMessageTemplate, listMessageTemplates, readMessageTemplate, updateMessageTemplate, changeMessageTemplate } from "@/server/message-templates";
const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4).filter(Boolean);
export const GET = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "message.read"), s = parts(request);
  if (!s.length) return json(await listMessageTemplates(ctx, messageTemplateList.parse(Object.fromEntries(new URL(request.url).searchParams)), requestId));
  const id = z.uuid().parse(s[0]);
  if (s.length === 1) return json(await readMessageTemplate(ctx, id, requestId));
  if (s.length === 3 && s[1] === "revisions") return json(await readMessageTemplate(ctx, id, requestId, z.coerce.number().int().positive().parse(s[2])));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "message.manage"), s = parts(request); await rateLimit("message-template:change:" + ctx.member.id, 60);
  if (!s.length) { const result = await createMessageTemplate(ctx, await body(request, messageTemplateCreate), request.headers.get("idempotency-key"), requestId); return json(result.body, result.status); }
  if (s.length === 2 && ["archive", "restore"].includes(s[1])) return json(await changeMessageTemplate(ctx, z.uuid().parse(s[0]), (await body(request, messageTemplateVersion)).version, s[1] as "archive" | "restore", requestId));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (request, requestId) => {
  const s = parts(request); if (s.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "message.manage"); await rateLimit("message-template:change:" + ctx.member.id, 60);
  return json(await updateMessageTemplate(ctx, z.uuid().parse(s[0]), await body(request, messageTemplatePatch), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const s = parts(request); if (s.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await changeMessageTemplate(await requireContext(request.headers, "message.manage"), z.uuid().parse(s[0]), (await body(request, messageTemplateVersion)).version, "delete", requestId));
});
