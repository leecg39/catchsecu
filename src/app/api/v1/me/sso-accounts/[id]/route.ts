import { auth } from "@/server/auth";
import { env } from "@/server/env";
import { ssoAccountUnlink } from "@/contracts/sso";
import { z } from "zod";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { unlinkOwnSsoAccount } from "@/server/sso-accounts";

export const DELETE = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers);
  const id = z.uuid().parse(new URL(request.url).pathname.split("/").at(-1));
  const value = await body(request, ssoAccountUnlink);
  const response = json(await unlinkOwnSsoAccount(ctx, id, value.updatedAt, requestId));
  const context = await auth.$context;
  for (const name of [context.authCookies.sessionToken.name, context.createAuthCookie("two_factor").name])
    response.headers.append("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${env.BETTER_AUTH_URL.startsWith("https:") ? "; Secure" : ""}`);
  return response;
});
