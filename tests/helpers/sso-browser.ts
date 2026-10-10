/** Minimal explicit cookie jar for direct route tests; raw handlers bypass it for adversarial cases. */
export class SsoTestBrowser {
  private bindings = new Map<string, string>();
  reset() { this.bindings.clear(); }
  cookie(authCookie = "") {
    if (/(?:^|;\s*)(?:__Host-catchsecu-sso-browser|catchsecu-sso-browser-local)-[a-f0-9]{32}=/.test(authCookie)) return authCookie;
    return [authCookie, ...this.bindings.values()].filter(Boolean).join("; ");
  }
  capture(response: Response) {
    for (const cookie of response.headers.getSetCookie().filter(value => /^(?:__Host-catchsecu-sso-browser|catchsecu-sso-browser-local)-[a-f0-9]{32}=/.test(value)))
      this.bindings.set(cookie.split("=", 1)[0], cookie.split(";")[0]);
    return response;
  }
  wrap(handler: (request: Request) => Promise<Response>) {
    return async (request: Request) => {
      const headers = new Headers(request.headers);
      headers.set("cookie", this.cookie(headers.get("cookie") ?? ""));
      return this.capture(await handler(new Request(request, { headers })));
    };
  }
}
