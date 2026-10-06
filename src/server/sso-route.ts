import { ssoFailureCode } from "@/lib/sso-recovery";
import { route } from "./http";

/** Keep API status contracts; document navigation gets a safe GET error screen. */
export function ssoRoute(handler: Parameters<typeof route>[0], externalAuthentication?: "saml-assertion") {
  const handle = route(handler, externalAuthentication);
  return async (request: Request): Promise<Response> => {
    const response = await handle(request);
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.append("Vary", "Accept, Sec-Fetch-Dest");
    const destination = request.headers.get("sec-fetch-dest");
    const acceptsHtml = (request.headers.get("accept") ?? "").split(",").some(item => {
      const [type, ...params] = item.trim().toLowerCase().split(";");
      return type.trim() === "text/html" && !params.some(param => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(param));
    });
    const document = destination === "document" || (!destination && acceptsHtml);
    if (response.status < 400 || !document) return response;
    const value = await response.json().catch(() => null);
    const headers = new Headers(response.headers);
    headers.delete("Content-Type");
    headers.delete("Content-Length");
    headers.set("Location", `/login?error=${ssoFailureCode(value?.error?.code)}`);
    return new Response(null, { status: 303, headers });
  };
}
