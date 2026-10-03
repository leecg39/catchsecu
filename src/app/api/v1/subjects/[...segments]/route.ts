import { z } from "zod";
import { subjectAccessInput, subjectSessionInput, subjectWithdrawalInput, subjectEmptyQuery, subjectPageQuery } from "@/contracts/subjects";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { subjectQuery } from "@/server/subject-query";
import { tokenHash } from "@/server/crypto";
import { SUBJECT_COOKIE, SUBJECT_BROWSER_COOKIE, subjectCookie, setSubjectCookie, requestSubjectAccess, createSubjectSession,
  withSubject, logoutSubject, subjectConsents, subjectEvents, requestWithdrawal, subjectWithdrawal } from "@/server/subjects";
function parts(request: Request) { return new URL(request.url).pathname.split("/").slice(4); }
async function authenticated<T>(request: Request, operation: Parameters<typeof withSubject<T>>[2]) {
  const id = request.headers.get("x-subject-session");
  if (!id || !z.uuid().safeParse(id).success) fail(401, "SUBJECT_AUTH_REQUIRED", "이메일 인증 후 동의 이력을 조회해주세요.");
  const token = subjectCookie(request);
  if (token) await rateLimit("subject:session:" + tokenHash(token), 120);
  return withSubject(token, id, operation);
}
export const POST = route(async (request, requestId) => {
  const segments = parts(request), [first, second, id, action] = segments;
  subjectQuery(request, subjectEmptyQuery);
  if (first === "access-requests" && segments.length === 1) {
    const input = await body(request, subjectAccessInput);
    await rateLimit("subject:access:global", 120);
    await rateLimit("subject:access:" + tokenHash(input.email), 5, 600);
    const result = await requestSubjectAccess(input, subjectCookie(request, SUBJECT_BROWSER_COOKIE), requestId);
    const response = json({ accepted: true }, 202);
    setSubjectCookie(response, SUBJECT_BROWSER_COOKIE, result.browser, 600, request); return response;
  }
  if (first === "sessions" && segments.length === 1) {
    const input = await body(request, subjectSessionInput);
    await rateLimit("subject:verify:global", 240);
    await rateLimit("subject:verify:" + tokenHash(input.token), 10, 600);
    const result = await createSubjectSession(input.token, subjectCookie(request, SUBJECT_BROWSER_COOKIE));
    const response = json({ id: result.id, expiresAt: result.expiresAt }, 201);
    setSubjectCookie(response, SUBJECT_COOKIE, result.token, (Date.parse(result.expiresAt) - Date.now()) / 1000, request);
    return response;
  }
  if (first === "logout" && segments.length === 1) {
    await logoutSubject(subjectCookie(request));
    const response = new Response(null, { status: 204 });
    setSubjectCookie(response, SUBJECT_COOKIE, "", 0, request); return response;
  }
  if (first === "me" && second === "withdrawals" && segments.length === 2) {
    const input = await body(request, subjectWithdrawalInput);
    return json(await authenticated(request, (tx, session) => requestWithdrawal(tx, session, input, requestId)), 201);
  }
  if (first === "me" && second === "withdrawals" && segments.length === 4 && (action === "confirm" || action === "cancel")) {
    return json(await authenticated(request, (tx, session) => subjectWithdrawal(tx, session, z.uuid().parse(id), action, requestId)));
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const GET = route(async (request, requestId) => {
  const segments = parts(request), [first, second, id] = segments;
  if (first !== "me") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  return authenticated(request, async (tx, session) => {
    if (segments.length === 1) { subjectQuery(request, subjectEmptyQuery); return json({ id: session.id, expiresAt: session.expiresAt }); }
    if (["consents", "events"].includes(second) && segments.length === 2) {
      const { page, pageSize } = subjectQuery(request, subjectPageQuery);
      return json(await (second === "consents" ? subjectConsents : subjectEvents)(tx, session, page, pageSize, requestId));
    }
    if (second === "withdrawals" && segments.length === 3) { subjectQuery(request, subjectEmptyQuery); return json(await subjectWithdrawal(tx, session, z.uuid().parse(id), "read", requestId)); }
    fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  });
});
