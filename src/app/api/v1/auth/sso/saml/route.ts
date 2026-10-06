import { ssoRoute } from "@/server/sso-route";
import { handleSamlCallback } from "@/server/sso";
import { readSamlPost } from "@/server/saml-validation";

// SAML 2.0 HTTP-POST ACS: IdP가 SAMLResponse·RelayState를 form-urlencoded로 POST한다.
export const POST = ssoRoute(async request => {
  const form = await readSamlPost(request);
  const { redirect, cookie, clearSessionCookie } = await handleSamlCallback(
    form,
    request.headers);
  const headers = new Headers({ location: redirect });
  if (clearSessionCookie) headers.append("set-cookie", clearSessionCookie);
  headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}, "saml-assertion");
