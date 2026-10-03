import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { entitlement } from "@/server/subscriptions";

export const GET = route(async request => json(await entitlement(await requireContext(request.headers, "billing.read"))));
