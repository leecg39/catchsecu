import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { assetOverview } from "@/server/subscriptions";

export const GET = route(async request => json(await assetOverview(await requireContext(request.headers, "billing.read"))));
