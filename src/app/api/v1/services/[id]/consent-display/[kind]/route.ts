import { z } from "zod";
import { displayInput } from "@/contracts/documents";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { readDisplay, updateDisplay } from "@/server/documents";
function parts(request: Request) { const parts = new URL(request.url).pathname.split("/"); return { id: z.uuid().parse(parts[4]), kind: z.enum(["collection", "third_party"]).parse(parts[6]) }; }
export const GET = route(async request => { const { id, kind } = parts(request); return json(await readDisplay(await requireContext(request.headers, "service.manage"), id, kind)); });
export const PATCH = route(async (request, requestId) => { const { id, kind } = parts(request); return json(await updateDisplay(await requireContext(request.headers, "service.manage"), id, kind, await body(request, displayInput), requestId)); });
