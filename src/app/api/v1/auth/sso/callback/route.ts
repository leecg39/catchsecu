import { route } from "@/server/http";
import { handleSsoCallback } from "@/server/sso";

export const GET = route(async request => {
  const url = new URL(request.url);
  const { redirect, cookie } = await handleSsoCallback(url.searchParams, request.headers);
  return new Response(null, { status: 302, headers: { location: redirect, "set-cookie": cookie } });
});
