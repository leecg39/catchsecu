import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { plans } from "@/server/subscriptions";
export const GET = route(async request => json(await plans(await requireContext(request.headers, "billing.read"))));
