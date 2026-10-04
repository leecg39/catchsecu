import { complianceCloseInput } from "@/contracts/analytics";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { closeComplianceMonth, readComplianceClose } from "@/server/compliance-close";
import { requestQuery } from "@/server/request-query";

export const GET = route(async (request, requestId) => {
  const input = complianceCloseInput.parse(requestQuery(request));
  return json(await readComplianceClose(await requireContext(request.headers, "service.read"), input, requestId));
});
export const POST = route(async (request, requestId) => {
  const input = await body(request, complianceCloseInput);
  return json(await closeComplianceMonth(await requireContext(request.headers, "service.read"), input, requestId));
});
