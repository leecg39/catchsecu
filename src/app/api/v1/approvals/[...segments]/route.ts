import { z } from "zod";
import { requireContext } from "@/server/context";
import { decideApproval, getApproval } from "@/server/approvals";
import { approvalCancelInput, approvalDecisionInput } from "@/contracts/security";
import { body, fail, json, route } from "@/server/http";
function parts(request: Request) {
  const [id, action, ...rest] = new URL(request.url).pathname.split("/").slice(4);
  if (rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return { id: z.uuid().parse(id), action };
}
export const GET = route(async request => {
  const { id, action } = parts(request);
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await getApproval(await requireContext(request.headers, "form.read"), id));
});
export const POST = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action !== "decision") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.approve");
  return json(await decideApproval(ctx, id, await body(request, approvalDecisionInput), requestId));
});
export const DELETE = route(async (request, requestId) => {
  const { id, action } = parts(request);
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(request.headers, "form.write");
  return json(await decideApproval(ctx, id, { ...await body(request, approvalCancelInput), decision: "cancelled" }, requestId));
});
