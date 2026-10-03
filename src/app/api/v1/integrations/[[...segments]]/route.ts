import { z } from "zod";
import { integrationCreate, integrationPatch, integrationQuery, integrationToggle, integrationDeleteMany, notificationVersion, notificationHistoryQuery } from "@/contracts/notifications";
import { createIntegration, listIntegrations, readIntegration, updateIntegration, toggleIntegration, deleteIntegrations, integrationOptions, testIntegration, notificationHistory, retryNotification } from "@/server/notifications";
import { requireContext } from "@/server/context";
import { body, fail, json, rateLimit, route } from "@/server/http";
const parts = (r: Request) => new URL(r.url).pathname.split("/").slice(4).filter(Boolean);
export const GET = route(async r => {
  const ctx = await requireContext(r.headers, "integration.read"), s = parts(r), query = Object.fromEntries(new URL(r.url).searchParams);
  if (!s.length) return json(await listIntegrations(ctx, integrationQuery.parse(query)));
  if (s.length === 1 && s[0] === "options") return json(await integrationOptions(ctx, z.uuid().parse(query.serviceId)));
  const id = z.uuid().parse(s[0]);
  if (s.length === 1) return json(await readIntegration(ctx, id));
  if (s.length === 2 && s[1] === "deliveries") return json(await notificationHistory(ctx, id, notificationHistoryQuery.parse(query)));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (r, requestId) => {
  const ctx = await requireContext(r.headers, "integration.manage"), s = parts(r), key = r.headers.get("idempotency-key");
  await rateLimit("integration:change:" + ctx.member.id, 60);
  if (!s.length) { const result = await createIntegration(ctx, await body(r, integrationCreate), key, requestId); return json(result.body, result.status); }
  if (s.length === 1 && s[0] === "delete") return json(await deleteIntegrations(ctx, await body(r, integrationDeleteMany), requestId));
  const id = z.uuid().parse(s[0]);
  if (s.length === 2 && s[1] === "enabled") { const input = await body(r, integrationToggle); return json(await toggleIntegration(ctx, id, input.version, input.enabled, requestId)); }
  if (s.length === 2 && s[1] === "test") {
    await rateLimit("integration:test:" + ctx.member.id, 10);
    const result = await testIntegration(ctx, id, (await body(r, notificationVersion)).version, key, requestId); return json(result.body, result.status);
  }
  if (s.length === 4 && s[1] === "deliveries" && s[3] === "retry") {
    const result = await retryNotification(ctx, id, z.uuid().parse(s[2]), (await body(r, notificationVersion)).version, key, requestId); return json(result.body, result.status);
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (r, requestId) => {
  const s = parts(r); if (s.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(r.headers, "integration.manage"); await rateLimit("integration:change:" + ctx.member.id, 60);
  return json(await updateIntegration(ctx, z.uuid().parse(s[0]), await body(r, integrationPatch), requestId));
});
export const DELETE = route(async (r, requestId) => {
  const s = parts(r); if (s.length !== 1) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const ctx = await requireContext(r.headers, "integration.manage"); await rateLimit("integration:change:" + ctx.member.id, 60);
  const input = await body(r, notificationVersion.extend({ serviceId: z.uuid() }).strict());
  return json(await deleteIntegrations(ctx, { serviceId: input.serviceId, items: [{ id: z.uuid().parse(s[0]), version: input.version }] }, requestId));
});
