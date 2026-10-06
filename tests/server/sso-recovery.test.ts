import { expect, test } from "vitest";
import { GET as callback } from "@/app/api/v1/auth/sso/callback/route";
import { POST as saml } from "@/app/api/v1/auth/sso/saml/route";
import { GET as start } from "@/app/api/v1/auth/sso/[providerId]/route";
import { env } from "@/server/env";
const origin = new URL(env.BETTER_AUTH_URL).origin;
test("OIDC 브라우저 실패는 민감한 입력 없이 로그인 화면으로 이동한다", async () => {
  const response = await callback(new Request(origin + "/api/v1/auth/sso/callback?error=access_denied&error_description=private-provider-detail&returnTo=https://evil.test", { headers: { accept: "text/html" } }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login?error=SSO_FAILED");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.text()).not.toContain("private-provider-detail");
});
test("SAML POST 실패도 GET 로그인 안내로 전환한다", async () => {
  const response = await saml(new Request(origin + "/api/v1/auth/sso/saml", { method: "POST", headers: { accept: "text/html", "content-type": "application/x-www-form-urlencoded", origin: "https://idp.example.test" }, body: "RelayState=x" }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login?error=SSO_FAILED");
});
test("잘못된 SSO 시작 주소는 안전한 화면 안내로 이동한다", async () => {
  const response = await start(new Request(origin + "/api/v1/auth/sso/invalid", { headers: { accept: "text/html" } }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login?error=SSO_FAILED");
});
test("JSON API 오류에 IdP 상세 입력을 되돌려주지 않는다", async () => {
  const response = await callback(new Request(origin + "/api/v1/auth/sso/callback?error=access_denied&error_description=private-provider-detail", { headers: { accept: "application/json" } }));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.get("location")).toBeNull();
  expect(await response.text()).not.toContain("private-provider-detail");
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SsoRecovery, SsoStartForm } from "@/components/auth/SsoRecovery";
import { ssoFailureCode, ssoLoginPath } from "@/lib/sso-recovery";
import { authErrorMessage } from "@/lib/auth-errors";
import { ssoRoute } from "@/server/sso-route";
import { fail } from "@/server/http";

test.each([
  ["PROVIDER_DENIED", "SSO_CANCELLED"], ["STATE_INVALID", "SSO_EXPIRED"], ["STATE_REPLAYED", "SSO_EXPIRED"],
  ["SSO_CONFIGURATION_CHANGED", "SSO_CHANGED"], ["SSO_LINK_REQUIRED", "SSO_LINK_NEEDED"],
  ["SSO_ACCOUNT_ALREADY_LINKED", "SSO_LINK_CONFLICT"], ["INVITATION_UNAVAILABLE", "SSO_INVITATION"],
  ["SSO_MEMBERSHIP_REQUIRED", "SSO_ACCESS"], ["JWKS_UNAVAILABLE", "SSO_UNAVAILABLE"], ["RATE_LIMITED", "SSO_LIMITED"],
  ["PRIVATE-error", "SSO_FAILED"], ["constructor", "SSO_FAILED"], ["__proto__", "SSO_FAILED"],
])("안전한 오류 매핑 %s", async (input, expected) => {
  const response = await ssoRoute(async () => fail(input === "RATE_LIMITED" ? 429 : 403, input, "PRIVATE-MESSAGE"))(
    new Request(origin, { headers: { "sec-fetch-dest": "document", accept: "*/*" } }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login?error=" + expected);
  expect(response.headers.get("x-request-id")).toBeTruthy();
  expect(response.headers.get("vary")).toContain("Accept");
  expect(response.headers.get("retry-after")).toBe(input === "RATE_LIMITED" ? "60" : null);
  expect(ssoFailureCode(input)).toBe(expected);
  const markup = renderToStaticMarkup(createElement(SsoRecovery, { code: expected }));
  expect(markup).toContain('role="alert"');
  expect(markup).not.toContain("PRIVATE");
});
const apiRequestHeaders: Record<string, string>[] = [
  { accept: "application/json" }, { accept: "*/*" }, { accept: "text/html;q=0, application/json" },
  { accept: "text/html", "sec-fetch-dest": "empty" },
];
test.each(apiRequestHeaders)("API 요청은 실패 상태와 JSON을 유지한다: %j", async headers => {
  const response = await ssoRoute(async () => fail(401, "STATE_INVALID", "만료"))(new Request(origin, { headers }));
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("STATE_INVALID");
});
test("일반 route의 출처 검사는 SSO 화면 처리에서도 유지된다", async () => {
  const response = await ssoRoute(async () => new Response("must-not-run"))(new Request(origin, { method: "POST", headers: { origin: "https://evil.test" } }));
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("ORIGIN_REJECTED");
});
const providerId = "e76c119e-56b3-4a50-8470-611eb705ae54";
const path = "/api/v1/auth/sso/" + providerId;
test.each([providerId, path, origin + path, origin + path + "?mode=login&returnTo=https://evil.test"]) ("회사 로그인 주소만 정규화한다: %s", input => {
  expect(ssoLoginPath(input, origin)).toBe(path + "?mode=login");
});
test.each(["https://evil.test" + path, "//evil.test" + path, "/\\evil.test" + path, "javascript:alert(1)",
  path + "?mode=link", path + "?mode=invite&invitation=secret", path + "?mode=login&mode=link", path + "#secret",
  "/api/v1/auth/sso/callback?state=secret", path + "\n/other", "/api/v1/auth/sso/%2f%2fevil.test", "https://user:pass@localhost" + path,
])("외부·초대·연결·콜백 주소를 로그인으로 바꾸지 않는다: %s", input => {
  expect(ssoLoginPath(input, origin)).toBeNull();
});
test("알 수 없는 오류와 Object 원형 이름은 화면에 출력하지 않는다", () => {
  for (const code of ["constructor", "__proto__", "<script>secret</script>"]) {
    expect(renderToStaticMarkup(createElement(SsoRecovery, { code }))).toBe("");
    expect(authErrorMessage(code)).toBeUndefined();
  }
  expect(renderToStaticMarkup(createElement(SsoStartForm))).toContain('name="ssoAddress"');
});
