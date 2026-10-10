import { afterEach, expect, test } from "vitest";
import { env } from "@/server/env";
import { assertSsoBrowser, ssoBrowserTransport, startSsoBrowser } from "@/server/sso-browser";

const original = { BETTER_AUTH_URL: env.BETTER_AUTH_URL, ALLOW_LOCAL_SSO: env.ALLOW_LOCAL_SSO };
afterEach(() => Object.assign(env, original));
const headers = (cookie = "") => new Headers({ cookie });
const pair = (value: string) => value.split(";")[0];

test("최초 두 탭의 응답이 어느 순서로 도착해도 양쪽 브라우저 결합이 유지된다", () => {
  env.BETTER_AUTH_URL = "https://app.example.test";
  // Both requests leave before either response arrives: neither has a cookie.
  const first = startSsoBrowser(headers()), second = startSsoBrowser(headers());
  for (const responses of [[first, second], [second, first]]) {
    const jar = new Map<string, string>();
    for (const response of responses) {
      const cookie = pair(response.browserCookie); jar.set(cookie.split("=")[0], cookie);
    }
    const cookie = [...jar.values()].join("; ");
    expect(() => assertSsoBrowser(first, headers(cookie))).not.toThrow();
    expect(() => assertSsoBrowser(second, headers(cookie))).not.toThrow();
    const next = startSsoBrowser(headers(cookie));
    expect([first.browserHash, second.browserHash]).toContain(next.browserHash);
  }
});

test("HTTPS 브라우저 결합은 host-only HttpOnly Secure SameSite=None 쿠키와 해시만 저장한다", () => {
  env.BETTER_AUTH_URL = "https://app.example.test";
  const started = startSsoBrowser(headers(), "saml");
  expect(started.browserCookie).toMatch(/^__Host-catchsecu-sso-browser-[a-f0-9]{32}=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Max-Age=600; SameSite=None; Secure$/);
  expect(started.browserHash).toMatch(/^[a-f0-9]{64}$/);
  expect(started.browserCookie).not.toContain("Domain=");
  expect(started.browserHash).not.toContain(pair(started.browserCookie).split("=")[1]);
  expect(() => assertSsoBrowser(started, headers(pair(started.browserCookie)), "saml")).not.toThrow();
});
test("같은 브라우저 다중 탭은 nonce를 재사용하고 독립 브라우저는 다른 nonce를 발급한다", () => {
  env.BETTER_AUTH_URL = "https://app.example.test";
  const first = startSsoBrowser(headers());
  const second = startSsoBrowser(headers(pair(first.browserCookie)));
  expect(second).toEqual(first);
  expect(startSsoBrowser(headers()).browserHash).not.toBe(first.browserHash);
  expect(() => assertSsoBrowser(first, headers(pair(second.browserCookie)))).not.toThrow();
});
test.each(["missing", "other", "duplicate", "malformed", "legacy", "local-only"])("HTTPS 콜백은 %s 쿠키/해시를 거절한다", kind => {
  env.BETTER_AUTH_URL = "https://app.example.test";
  const started = startSsoBrowser(headers());
  const cookie = kind === "missing" ? "" : kind === "other" ? pair(startSsoBrowser(headers()).browserCookie)
    : kind === "duplicate" ? pair(started.browserCookie) + "; " + pair(started.browserCookie)
    : kind === "malformed" ? pair(started.browserCookie).split("=")[0] + "=invalid"
    : kind === "local-only" ? pair(started.browserCookie).replace("__Host-catchsecu-sso-browser", "catchsecu-sso-browser-local") : pair(started.browserCookie);
  expect(() => assertSsoBrowser(kind === "legacy" ? { browserHash: null } : started, headers(cookie)))
    .toThrow(expect.objectContaining({ code: "SSO_BROWSER_MISMATCH" }));
});
test.each(["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"])("명시적으로 허용한 %s는 별도 Lax 쿠키를 쓰지만 SAML은 거절한다", url => {
  env.BETTER_AUTH_URL = url; env.ALLOW_LOCAL_SSO = "1";
  const started = startSsoBrowser(headers(), "oidc");
  expect(started.browserCookie).toMatch(/^catchsecu-sso-browser-local-[a-f0-9]{32}=/);
  expect(started.browserCookie).toContain("SameSite=Lax");
  expect(started.browserCookie).not.toContain("Secure");
  expect(() => assertSsoBrowser(started, headers(pair(started.browserCookie)), "saml"))
    .toThrow(expect.objectContaining({ code: "SSO_HTTPS_REQUIRED" }));
  expect(() => startSsoBrowser(headers(), "saml")).toThrow(expect.objectContaining({ code: "SSO_HTTPS_REQUIRED" }));
});
test.each(["flag-off", "remote", "private", "credentials"])("%s HTTP 설정은 전달 헤더로 완화할 수 없다", kind => {
  env.BETTER_AUTH_URL = kind === "remote" ? "http://app.example.test" : kind === "private" ? "http://10.0.0.1" : kind === "credentials" ? "http://user:pass@localhost" : "http://localhost";
  env.ALLOW_LOCAL_SSO = kind === "flag-off" ? "0" : "1";
  expect(() => ssoBrowserTransport()).toThrow(expect.objectContaining({ code: "SSO_HTTPS_REQUIRED" }));
  expect(() => startSsoBrowser(new Headers({ host: "localhost", "x-forwarded-proto": "https" })))
    .toThrow(expect.objectContaining({ code: "SSO_HTTPS_REQUIRED" }));
});
