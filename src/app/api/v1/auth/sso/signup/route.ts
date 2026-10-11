import { ssoSignupAccept, ssoSignupCancel } from "@/contracts/sso-signup";
import { body, json, route } from "@/server/http";
import { acceptSsoSignup, cancelSsoSignup, clearSsoSignupCookie, getSsoSignup } from "@/server/sso-signup";
export const GET = route(async request => json(await getSsoSignup(request.headers)));
export const POST = route(async request => {
  const result = await acceptSsoSignup(request.headers, await body(request, ssoSignupAccept));
  const response = json({ redirect: result.redirect });
  if (result.clearSessionCookie) response.headers.append("set-cookie", result.clearSessionCookie);
  response.headers.append("set-cookie", result.cookie);
  response.headers.append("set-cookie", clearSsoSignupCookie());
  return response;
});
export const DELETE = route(async request => {
  const input = await body(request, ssoSignupCancel);
  const response = json(await cancelSsoSignup(request.headers, input.intentId));
  response.headers.append("set-cookie", clearSsoSignupCookie());
  return response;
});
