import { z } from "zod";
import { cancelRequest, purchaseRequest, scheduleTrialCancelRequest } from "@/contracts/subscriptions";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { cancelPurchase, entitlement, requestPurchase, scheduleTrialCancellation, subscriptions, undoTrialCancellation } from "@/server/subscriptions";
const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4).filter(Boolean);
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "billing.read"), p = parts(request);
  if (p.length === 0) return json({ subscriptions: await subscriptions(ctx), entitlement: await entitlement(ctx) });
  if (p.length === 1 && p[0] === "entitlement") return json(await entitlement(ctx));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "billing.write"), p = parts(request), key = request.headers.get("idempotency-key");
  if (p.length === 0) { const result = await requestPurchase(ctx, (await body(request, purchaseRequest)).planVersionId, key, requestId); return json(result.body, result.status); }
  if (p.length === 2 && p[1] === "cancel") { const result = await cancelPurchase(ctx, z.uuid().parse(p[0]), (await body(request, cancelRequest)).version, key, requestId); return json(result.body, result.status); }
  if (p.length === 2 && p[1] === "schedule-cancel") {
    const input = await body(request, scheduleTrialCancelRequest);
    const result = await scheduleTrialCancellation(ctx, z.uuid().parse(p[0]), input.version, new Date(input.effectiveAt), key, requestId, input.reason);
    return json(result.body, result.status);
  }
  if (p.length === 2 && p[1] === "undo-cancel") {
    const input = await body(request, cancelRequest);
    const result = await undoTrialCancellation(ctx, z.uuid().parse(p[0]), input.version, key, requestId);
    return json(result.body, result.status);
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
