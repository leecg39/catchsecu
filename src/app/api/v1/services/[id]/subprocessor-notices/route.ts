import { z } from "zod";
import { subprocessorNoticeInput } from "@/contracts/subprocessors";
import { requireContext } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { listSubprocessorNotices, sendSubprocessorNotice } from "@/server/subprocessors";

function serviceId(request: Request) { return z.uuid().parse(new URL(request.url).pathname.split("/")[4]); }
export const GET = route(async request => {
  const id = serviceId(request);
  const query = listQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await listSubprocessorNotices(await requireContext(request.headers, "service.manage"), id, query));
});
export const POST = route(async (request, requestId) => {
  const id = serviceId(request);
  const ctx = await requireContext(request.headers, "service.manage");
  const input = await body(request, subprocessorNoticeInput);
  const result = await idempotent("subprocessor-notice:" + ctx.tenantId + ":" + id, request.headers.get("idempotency-key"), input,
    async tx => {
      const notice = await sendSubprocessorNotice(tx, ctx, id, input, requestId);
      return { status: 201, body: notice, resource: { tenantId: ctx.tenantId, resourceType: "subprocessor-notice" as const, resourceId: notice.id } };
    });
  return json(result.body, result.status);
});
