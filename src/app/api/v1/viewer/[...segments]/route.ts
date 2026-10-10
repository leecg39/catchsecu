import { z } from "zod";
import { challengeIdInput, challengeInput, sharingEmptyQuery, sharingPageQuery, verificationInput } from "@/contracts/sharing";
import { body, fail, json, rateLimit, route } from "@/server/http";
import { tokenHash } from "@/server/crypto";
import { CHALLENGE_COOKIE, VIEWER_COOKIE, getSharedSubmission, listSharedSubmissions, logoutViewer, setViewerCookie,
  sharedAuthorAssets, sharedFile, sharedFiles, startViewerChallenge, verifyViewerChallenge, viewerCookie, viewerInfo, withViewer } from "@/server/viewer";
import { fileBindingQuery, fileListQuery } from "@/server/file-query";
import { sharingQuery } from "@/server/share-query";
function parts(request: Request) { return new URL(request.url).pathname.split("/").slice(4); }
export const POST = route(async (request, requestId) => {
  sharingQuery(new URL(request.url), sharingEmptyQuery);
  const segments = parts(request), [first, id, action] = segments;
  if (first === "challenges" && segments.length === 1) {
    const input = await body(request, challengeInput);
    await rateLimit("viewer:start:global", 120);
    await rateLimit("viewer:start:" + tokenHash(input.email), 5, 600);
    const { client, ...result } = await startViewerChallenge(input, requestId), response = json(result, 202);
    setViewerCookie(response, CHALLENGE_COOKIE, client, 600, request);
    return response;
  }
  if (first === "challenges" && action === "verify" && segments.length === 3) {
    const challengeId = challengeIdInput.parse(id), input = await body(request, verificationInput);
    await rateLimit("viewer:verify:" + tokenHash(challengeId), 15, 600);
    const result = await verifyViewerChallenge(challengeId, input.code, viewerCookie(request, CHALLENGE_COOKIE), requestId);
    const response = json({ expiresAt: result.expiresAt });
    setViewerCookie(response, VIEWER_COOKIE, result.token, (new Date(result.expiresAt).getTime() - Date.now()) / 1000, request);
    setViewerCookie(response, CHALLENGE_COOKIE, "", 0, request);
    return response;
  }
  if (first === "logout" && segments.length === 1) {
    await logoutViewer(viewerCookie(request), requestId);
    const response = new Response(null, { status: 204 }); setViewerCookie(response, VIEWER_COOKIE, "", 0, request); return response;
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const GET = route(async (request, requestId) => {
  const segments = parts(request), [first, id, action] = segments, token = viewerCookie(request);
  if (token) await rateLimit("viewer:read:" + tokenHash(token), 120);
  const url = new URL(request.url);
  if (first === "session" && segments.length === 1) { sharingQuery(url, sharingEmptyQuery); return json(await withViewer(token, async (_tx, grant, session) => viewerInfo(grant, session))); }
  if (first === "submissions" && segments.length === 1) { const { page, pageSize } = sharingQuery(url, sharingPageQuery); return json(await listSharedSubmissions(token, page, pageSize, requestId)); }
  if (first === "submissions" && segments.length === 2) { sharingQuery(url, sharingEmptyQuery); return json(await getSharedSubmission(token, z.uuid().parse(id), requestId)); }
  if (first === "author-assets" && (segments.length === 1 || (segments.length === 3 && action === "download"))) {
    const query = sharingQuery(url, z.object({ submissionId: z.uuid() }).strict());
    const result = await sharedAuthorAssets(token, query.submissionId, requestId, id ? z.uuid().parse(id) : undefined);
    return result instanceof Response ? result : json(result);
  }
  if (first === "files" && segments.length === 1) {
    const { submissionId, ...query } = fileListQuery(new URL(request.url));
    return json(await sharedFiles(token, submissionId, query, requestId));
  }
  if (first === "files" && (segments.length === 2 || (segments.length === 3 && action === "download"))) {
    const query = fileBindingQuery(new URL(request.url), true);
    const result = await sharedFile(token, query.submissionId!, query.questionId!, z.uuid().parse(id), action === "download", requestId);
    return result instanceof Response ? result : json(result);
  }
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
