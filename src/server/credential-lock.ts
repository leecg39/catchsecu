import { passwordChangeInput, passwordResetInput } from "@/contracts/security";
import { APIError } from "better-auth/api";
import { credentialScope } from "./credential-scope";
import { db } from "./db";
import { body, fail, rateLimit, route } from "./http";

export const credentialOperation = () => credentialScope.getStore();
type SessionLookup = (headers: Headers) => Promise<string | null>;
type ResetLookup = (token: string) => Promise<string | null>;
class CredentialRollback { constructor(public response: Response) {} }

export function guardCredentialRequests(handler: (request: Request) => Promise<Response>, userFromSession: SessionLookup, userFromReset: ResetLookup) {
  const guarded = route(async request => {
    const path = new URL(request.url).pathname, reset = path.endsWith("/reset-password");
    const input = reset ? await body(request, passwordResetInput) : await body(request, passwordChangeInput);
    const token = reset ? ("token" in input && input.token) || new URL(request.url).searchParams.get("token") : null;
    if (reset && (!token || token.length > 256 || token.length < 16)) fail(400, "INVALID_TOKEN", "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요.");
    let userId: string | null;
    try { userId = reset ? await userFromReset(token!) : await userFromSession(request.headers); }
    catch (error) {
      if (error instanceof APIError && error.statusCode === 401) fail(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해주세요.");
      throw error;
    }
    if (!userId) fail(reset ? 400 : 401, reset ? "INVALID_TOKEN" : "UNAUTHENTICATED", reset ? "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요." : "로그인이 필요합니다.");
    await rateLimit("password-mutation:" + userId, 10);
    const headers = new Headers(request.headers); headers.delete("content-length");
    const payload = reset ? { newPassword: input.newPassword, token } : { ...input, revokeOtherSessions: true };
    const forwarded = new Request(request.url, { method: "POST", headers, body: JSON.stringify(payload) });
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"password:" + userId}, 0))`;
        await tx.$queryRaw`SELECT c.id FROM "Company" c JOIN "Membership" m ON m."tenantId" = c.id
          WHERE m."userId" = ${userId} AND m.status = 'active' AND c.status = 'active' ORDER BY c.id FOR SHARE OF c`;
        // The auth adapter and hooks use the scoped transaction through db.ts.
        // Failed responses must roll back token consumption as well as credentials.
        return credentialScope.run({ userId, client: tx }, async () => {
          const response = await handler(forwarded);
          if (!response.ok) throw new CredentialRollback(response);
          return response;
        });
      }, { timeout: 30000, maxWait: 5000 });
    } catch (error) {
      if (error instanceof CredentialRollback) return error.response;
      throw error;
    }
  });
  return (request: Request) => request.method === "POST" && ["/api/v1/auth/change-password", "/api/v1/auth/reset-password"].includes(new URL(request.url).pathname)
    ? guarded(request) : handler(request);
}
