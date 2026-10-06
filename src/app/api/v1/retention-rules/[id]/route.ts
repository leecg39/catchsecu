import { z } from "zod";
import { retentionRulePatch } from "@/contracts/retention-rules";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { archiveRetentionRule, readRetentionRule, updateRetentionRule } from "@/server/retention-rules";

const id = (request: Request) => z.uuid().parse(new URL(request.url).pathname.split("/").at(-1));
export const GET = route(async request =>
  json(await readRetentionRule(await requireContext(request.headers, "security.read"), id(request))));
export const PATCH = route(async (request, requestId) =>
  json(await updateRetentionRule(await requireContext(request.headers, "security.write"), id(request),
    await body(request, retentionRulePatch), requestId)));
export const DELETE = route(async (request, requestId) => {
  const version = z.coerce.number().int().positive().parse(request.headers.get("if-match"));
  await archiveRetentionRule(await requireContext(request.headers, "security.write"), id(request), version, requestId);
  return new Response(null, { status: 204 });
});
