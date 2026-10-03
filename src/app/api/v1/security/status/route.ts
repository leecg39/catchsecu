import { requireContext } from "@/server/context";
import { requireEmptyQuery } from "@/server/request-query";
import { json,route } from "@/server/http";
import { securityStatus } from "@/server/mfa-policy";
export const GET=route(async request=>{requireEmptyQuery(request);return json(await securityStatus(await requireContext(request.headers,"security.read")));});
