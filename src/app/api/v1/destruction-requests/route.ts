import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { destructionQuery, listDestructions } from "@/server/destruction";
export const GET = route(async request => json(await listDestructions(
  await requireContext(request.headers, "submission.destroy"),
  destructionQuery.parse(Object.fromEntries(new URL(request.url).searchParams)))));
