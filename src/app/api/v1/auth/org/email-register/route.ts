import { orgEmailRegisterBody } from "@/contracts/sso";
import { body } from "@/server/http";
import { ssoRoute } from "@/server/sso-route";
import { registerOrgEmail } from "@/server/org-auth";

export const POST = ssoRoute(async request => {
  const result = await registerOrgEmail(await body(request, orgEmailRegisterBody), request.headers);
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "private, no-store" });
  if (result.clearSessionCookie) headers.append("set-cookie", result.clearSessionCookie);
  headers.append("set-cookie", result.cookie);
  return new Response(JSON.stringify({ status: result.status, redirect: result.redirect }), { status: 200, headers });
});
