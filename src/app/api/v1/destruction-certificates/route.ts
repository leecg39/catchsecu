import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { destructionRequestQuery, listDestructions } from "@/server/destruction";
export const GET = route(async request => json(await listDestructions(
  await requireContext(request.headers, "audit.read"),
  destructionRequestQuery(request, true), true)));
