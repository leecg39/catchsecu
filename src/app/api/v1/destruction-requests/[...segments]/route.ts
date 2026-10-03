import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { decideDestruction, destructionRequestQuery } from "@/server/destruction";
import { destructionAction, destructionSchedule } from "@/contracts/destruction";
export const POST = route(async (request, requestId) => {
  const [rawId, action, ...extra] = new URL(request.url).pathname.split("/").slice(4);
  if (extra.length || !["approve", "reject", "cancel", "retry", "reschedule"].includes(action)) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "submission.destroy");
  destructionRequestQuery(request, false, true);
  const input = action === "reschedule" ? await body(request, destructionSchedule) : await body(request, destructionAction);
  return json(await decideDestruction(ctx, z.uuid().parse(rawId), action as "approve" | "reject" | "cancel" | "retry" | "reschedule", input, requestId));
});
