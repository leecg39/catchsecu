import { retentionRuleCreate } from "@/contracts/retention-rules";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createRetentionRule, listRetentionRules } from "@/server/retention-rules";

export const GET = route(async request =>
  json(await listRetentionRules(await requireContext(request.headers, "security.read"),
    Object.fromEntries(new URL(request.url).searchParams))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "security.write");
  const result = await createRetentionRule(ctx, await body(request, retentionRuleCreate),
    request.headers.get("idempotency-key"), requestId);
  const response = json(result.body, result.status);
  response.headers.set("Location", "/api/v1/retention-rules/" + result.body.id);
  return response;
});
