import { route } from "@/server/http";
import { handleSamlCallback } from "@/server/sso";

// SAML 2.0 HTTP-POST ACS: IdP가 SAMLResponse·RelayState를 form-urlencoded로 POST한다.
export const POST = route(async request => {
  const form = await request.formData().catch(() => null);
  const { redirect, cookie } = await handleSamlCallback(
    { SAMLResponse: form?.get("SAMLResponse")?.toString(), RelayState: form?.get("RelayState")?.toString() },
    request.headers);
  return new Response(null, { status: 302, headers: { location: redirect, "set-cookie": cookie } });
}, "saml-assertion");
