import { z } from "zod";
import { ssoRoute } from "@/server/sso-route";
import { startSso } from "@/server/sso";

export const GET = ssoRoute(async request => {
  const url = new URL(request.url);
  const providerId = z.uuid().parse(url.pathname.split("/")[5]);
  const mode = z.enum(["login", "link"]).default("login").parse(url.searchParams.get("mode") ?? "login");
  const { redirect, browserCookie } = await startSso(providerId, mode, request.headers);
  return new Response(null, { status: 302, headers: { location: redirect, "set-cookie": browserCookie } });
});
