import { trustedClientIp } from "@/server/client-ip";
import { contextSelectionInput } from "@/contracts/context";
import { body, json, route } from "@/server/http";
import { contextDto, requireActor, requireContext } from "@/server/context";
import { selectCompany, selectService } from "@/server/context-selection";
export const GET = route(async request => json(await contextDto(request.headers)));
export const POST = route(async (request, requestId) => {
  const actor = await requireActor(request.headers);
  const input = await body(request, contextSelectionInput);
  if ("companyId" in input) {
    await selectCompany(actor, input.companyId, trustedClientIp(request.headers), requestId);
  } else {
    const ctx = await requireContext(request.headers);
    await selectService(ctx, input.serviceId, requestId);
  }
  return json(await contextDto(request.headers));
});
