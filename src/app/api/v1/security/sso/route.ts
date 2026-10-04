import { ssoProviderCreate } from "@/contracts/sso";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createSsoProvider, listSsoProviders } from "@/server/sso";

export const GET = route(async request => json(await listSsoProviders(await requireContext(request.headers, "security.read"))));
export const POST = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "security.write");
  return json(await createSsoProvider(ctx, await body(request, ssoProviderCreate), requestId), 201);
});
