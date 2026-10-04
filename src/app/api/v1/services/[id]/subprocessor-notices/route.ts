import { z } from "zod";
import { subprocessorNoticeInput } from "@/contracts/subprocessors";
import { requireContext } from "@/server/context";
import { body, json, listQuery, route } from "@/server/http";
import { listSubprocessorNotices, sendSubprocessorNoticeRequest } from "@/server/subprocessors";

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
  const result = await sendSubprocessorNoticeRequest(ctx, id, input, request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
