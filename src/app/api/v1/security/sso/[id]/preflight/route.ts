import { z } from "zod";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { preflightSsoProvider } from "@/server/sso";

export const POST = route(async (request, requestId) =>
  json(await preflightSsoProvider(await requireContext(request.headers, "security.write"),
    z.uuid().parse(new URL(request.url).pathname.split("/")[5]), requestId)));
