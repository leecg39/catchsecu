import { ssoPolicySelection } from "@/contracts/sso-login-policy";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { requestSsoPolicyChallenge } from "@/server/sso-login-policy";

export const POST = route(async (request, requestId) => json(await requestSsoPolicyChallenge(
  await requireContext(request.headers, "security.write"), await body(request, ssoPolicySelection), requestId), 201));
