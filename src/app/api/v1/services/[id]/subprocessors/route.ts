import { z } from "zod";
import { subprocessorInput } from "@/contracts/subprocessors";
import { requireContext } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createSubprocessor, listSubprocessors } from "@/server/subprocessors";

function serviceId(request: Request) { return z.uuid().parse(new URL(request.url).pathname.split("/")[4]); }
export const GET = route(async request => {
  const id = serviceId(request);
  const query = listQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await listSubprocessors(await requireContext(request.headers, "service.manage"), id, query));
});
export const POST = route(async (request, requestId) => {
  const id = serviceId(request);
  const ctx = await requireContext(request.headers, "service.manage");
  const input = await body(request, subprocessorInput);
  const result = await idempotent("subprocessor:create:" + ctx.tenantId + ":" + id, request.headers.get("idempotency-key"), input,
    async tx => {
      const row = await createSubprocessor(tx, ctx, id, input, requestId);
      return { status: 201, body: row, resource: { tenantId: ctx.tenantId, resourceType: "subprocessor" as const, resourceId: row.id } };
    });
  return json(result.body, result.status);
});
