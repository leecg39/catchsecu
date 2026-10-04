import { collectDestructionQuery } from "@/contracts/analytics";
import { collectDestructionDaily } from "@/server/collect-destruction";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { requestQuery } from "@/server/request-query";

export const GET = route(async (request, requestId) => {
  const input = collectDestructionQuery.parse(requestQuery(request));
  return json(await collectDestructionDaily(await requireContext(request.headers, "service.read"), input, requestId));
});
