import { z } from "zod";
import { marketingChange, marketingCreate, marketingList, marketingSummaryQuery, marketingVersions } from "@/contracts/marketing";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { createMarketingRequest, listMarketing, marketingSources, marketingSummary, readMarketing, updateMarketing, withdrawMarketing } from "@/server/marketing";
import { requestQuery, requireEmptyQuery } from "@/server/request-query";
import { safeCsvCell } from "@/server/import-csv";
const parts = (request: Request) => new URL(request.url).pathname.split("/").slice(4);
export const GET = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "marketing.read"), segments = parts(request), [first, second] = segments;
  const query = requestQuery(request);
  if (first === "summary" && segments.length === 1) {
    const input = marketingSummaryQuery.parse(query);
    return json(await marketingSummary(ctx, input, requestId));
  }
  if (first === "sources" && segments.length === 1) {
    const q = z.object({ serviceId: z.uuid(), page: z.coerce.number().int().min(1).max(100000).default(1), search: z.string().max(100).default("") }).strict().parse(query);
    return json(await marketingSources(ctx, q.serviceId, q.page, q.search, requestId));
  }
  if (first === "preferences" && (segments.length === 1 || (second === "export" && segments.length === 2))) {
    const result = await listMarketing(ctx, marketingList.parse(query), requestId, second === "export");
    if (!second) return json(result);
    const cell = (value: unknown) => safeCsvCell(String(value ?? ""));
    const rows = [["이름", "채널", "연락처", "수집 출처", "동의일", "상태", "발송 제외", "철회일", "발송 차단 사유"], ...result.items.map(r => [r.name, r.channel, r.contact, r.sourceTitle, r.grantedAt, r.status, r.excluded ? "예" : "아니요", r.withdrawnAt, r.denial])];
    return new Response("\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="marketing-preferences.csv"', "X-Content-Type-Options": "nosniff" } });
  }
  if (first === "preferences" && second && segments.length === 2) { requireEmptyQuery(request); return json(await readMarketing(ctx, z.uuid().parse(second), requestId)); }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  requireEmptyQuery(request);
  const ctx = await requireContext(request.headers, "marketing.write"), segments = parts(request), [first, second] = segments;
  if (first === "preferences" && segments.length === 1) {
    const input = await body(request, marketingCreate);
    const result = await createMarketingRequest(ctx, input, request.headers.get("idempotency-key"), requestId);
    return json(result.body, result.status);
  }
  if (first === "preferences" && second === "withdrawals" && segments.length === 2) {
    const input = await body(request, z.object({ serviceId: z.uuid(), items: marketingVersions }).strict());
    return json(await withdrawMarketing(ctx, input.serviceId, input.items, requestId));
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (request, requestId) => {
  requireEmptyQuery(request);
  const [first, id, ...rest] = parts(request); if (first !== "preferences" || rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return json(await updateMarketing(await requireContext(request.headers, "marketing.write"), z.uuid().parse(id), await body(request, marketingChange), requestId));
});
export const DELETE = route(async (request, requestId) => {
  requireEmptyQuery(request);
  const [first, id, ...rest] = parts(request); if (first !== "preferences" || rest.length) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  const input = await body(request, z.object({ serviceId: z.uuid(), version: z.number().int().positive() }).strict());
  return json(await withdrawMarketing(await requireContext(request.headers, "marketing.write"), input.serviceId, [{ id: z.uuid().parse(id), version: input.version }], requestId, true));
});
