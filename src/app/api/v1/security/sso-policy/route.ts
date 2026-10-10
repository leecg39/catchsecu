import { ssoPolicySave } from "@/contracts/sso-login-policy";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { readSsoLoginPolicy, saveSsoLoginPolicy } from "@/server/sso-login-policy";

export const GET = route(async request => json(await readSsoLoginPolicy(await requireContext(request.headers, "security.read"))));
export const PUT = route(async (request, requestId) => json(await saveSsoLoginPolicy(
  await requireContext(request.headers, "security.write"), await body(request, ssoPolicySave), requestId)));
