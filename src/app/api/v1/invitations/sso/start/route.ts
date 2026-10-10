import { ssoInvitationStart } from "@/contracts/sso";
import { body, json } from "@/server/http";
import { startSso } from "@/server/sso";
import { ssoRoute } from "@/server/sso-route";

export const POST = ssoRoute(async request => {
  const input = await body(request, ssoInvitationStart);
  const { redirect, browserCookie } = await startSso(input.providerId, "invite", request.headers, input.token);
  const response = json({ redirect });
  response.headers.append("set-cookie", browserCookie);
  return response;
});
