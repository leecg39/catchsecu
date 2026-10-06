import { ssoRoute } from "@/server/sso-route";
import { handleSsoCallback } from "@/server/sso";

export const GET = ssoRoute(async request => {
  const url = new URL(request.url);
  const { redirect, cookie, clearSessionCookie } = await handleSsoCallback(url.searchParams, request.headers);
  const headers = new Headers({ location: redirect });
  if (clearSessionCookie) headers.append("set-cookie", clearSessionCookie);
  headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
});
