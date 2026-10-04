import { z } from "zod";
import { subprocessorPatch } from "@/contracts/subprocessors";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { updateSubprocessor } from "@/server/subprocessors";

function parts(request: Request) {
  const segments = new URL(request.url).pathname.split("/");
  return { id: z.uuid().parse(segments[4]), subId: z.uuid().parse(segments[6]) };
}
export const PATCH = route(async (request, requestId) => {
  const { id, subId } = parts(request);
  return json(await updateSubprocessor(await requireContext(request.headers, "service.manage"), id, subId, await body(request, subprocessorPatch), requestId));
});
