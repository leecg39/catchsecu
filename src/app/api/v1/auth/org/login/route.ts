import { orgLoginBody } from "@/contracts/sso";
import { body } from "@/server/http";
import { ssoRoute } from "@/server/sso-route";
import { orgLogin } from "@/server/org-auth";

// 가상 조직 인증 로그인 — 성공 시 completeSso 결과(redirect·session cookie)를
// JSON으로 반환한다. 쿠키는 같은 응답의 Set-Cookie로 내려 브라우저가 저장한다.
export const POST = ssoRoute(async request => {
  const result = await orgLogin(await body(request, orgLoginBody), request.headers);
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "private, no-store" });
  if (result.status === "verified") {
    if (result.clearSessionCookie) headers.append("set-cookie", result.clearSessionCookie);
    headers.append("set-cookie", result.cookie);
    return new Response(JSON.stringify({ status: result.status, redirect: result.redirect }), { status: 200, headers });
  }
  headers.append("set-cookie", result.browserCookie);
  const { status, ticket, expiresAt, protocol } = result;
  return new Response(JSON.stringify({ status, ticket, expiresAt, protocol }), { status: 200, headers });
});
