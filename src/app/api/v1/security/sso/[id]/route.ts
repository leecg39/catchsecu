import { z } from "zod";
import { ssoProviderPatch, ssoProviderRemove } from "@/contracts/sso";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { removeSsoProvider, updateSsoProvider } from "@/server/sso";

const idOf = (request: Request) => z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
export const PATCH = route(async (request, requestId) =>
  json(await updateSsoProvider(await requireContext(request.headers, "security.write"), idOf(request), await body(request, ssoProviderPatch), requestId)));
export const DELETE = route(async (request, requestId) =>
  json(await removeSsoProvider(await requireContext(request.headers, "security.write"), idOf(request), (await body(request, ssoProviderRemove)).version, requestId)));
