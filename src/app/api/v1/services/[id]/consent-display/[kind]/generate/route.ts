import { z } from "zod";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { generateDisplayProposal } from "@/server/documents";

function parts(request: Request) { const parts = new URL(request.url).pathname.split("/"); return { id: z.uuid().parse(parts[4]), kind: z.enum(["collection", "third_party"]).parse(parts[6]) }; }
export const POST = route(async (request, requestId) => {
  const { id, kind } = parts(request);
  return json(await generateDisplayProposal(await requireContext(request.headers, "service.manage"), id, kind, requestId));
});
