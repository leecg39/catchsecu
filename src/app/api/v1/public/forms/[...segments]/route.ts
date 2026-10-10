import { z } from "zod";
import { publicAuthorAssets } from "@/server/author-asset-reads";
import { sharingQuery } from "@/server/share-query";
import { route, json, body, fail, rateLimit } from "@/server/http";
import { publicForm, submitForm } from "@/server/submissions";
import { submissionInput } from "@/contracts/domains";
import { verificationCallbackInput, verificationChallengeInput } from "@/contracts/verification";
import { completeVerification, issueVerificationChallenge } from "@/server/verification-flow";
import { tokenHash } from "@/server/crypto";
import { publicUploadInput } from "@/contracts/files";
import { initPublicUpload } from "@/server/files";
import { participationChallengeInput, participationChallengeVerifyInput } from "@/contracts/form-participation-access";
import { PARTICIPATION_COOKIE, participationProofFromRequest, startParticipationChallenge, verifyParticipationChallenge } from "@/server/participation-access";
function parts(request: Request) {
  const [token, action, ...rest] = new URL(request.url).pathname.split("/").slice(5);
  if (rest.length || !token) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  return { token, action };
}
export const GET = route(async (request, requestId) => {
  const segments = new URL(request.url).pathname.split("/").slice(5);
  if (segments[1] === "author-assets" && (segments.length === 2 || (segments.length === 4 && segments[3] === "download"))) {
    const access = sharingQuery(new URL(request.url), z.object({ surface: z.enum(["active", "closed", "completion"]).default("active"),
      proof: z.string().min(1).max(2048).optional() }).strict().superRefine((value, ctx) => {
        if (value.surface === "completion" && !value.proof) ctx.addIssue({ code: "custom", path: ["proof"], message: "제출 완료 안내 증명이 필요합니다." });
        if (value.surface !== "completion" && value.proof) ctx.addIssue({ code: "custom", path: ["proof"], message: "이 화면에서는 완료 안내 증명을 사용할 수 없습니다." });
      }));
    await rateLimit("public:asset:" + tokenHash(segments[0]), 300);
    const result = await publicAuthorAssets(segments[0], requestId, segments[2] ? z.uuid().parse(segments[2]) : undefined,
      { ...access, participationProof: request.headers.get("x-participation-proof") ?? participationProofFromRequest(request) });
    return result instanceof Response ? result : json(result);
  }
  const { token, action } = parts(request);
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await rateLimit("public:read:" + tokenHash(token), 300);
  return json(await publicForm(token, request.headers.get("x-participation-proof") ?? participationProofFromRequest(request)));
});
export const POST = route(async (request, requestId) => {
  const { token, action } = parts(request);
  if (action === "uploads") {
    await rateLimit("public:upload:" + tokenHash(token), 30);
    const result = await initPublicUpload(token, await body(request, publicUploadInput), request.headers.get("idempotency-key"), requestId,
      request.headers.get("x-participation-proof") ?? participationProofFromRequest(request));
    return json(result.body, result.status);
  }
  if (action === "verification") {
    await rateLimit("public:verify:" + tokenHash(token), 30);
    const input = await body(request, verificationChallengeInput);
    return json(await issueVerificationChallenge(token, input.kind, requestId), 201);
  }
  if (action === "verification-callback") {
    await rateLimit("public:verify-callback:" + tokenHash(token), 30);
    return json(await completeVerification(token, await body(request, verificationCallbackInput), requestId));
  }
  if (action === "participation-challenges") {
    await rateLimit("public:participation-challenge:" + tokenHash(token), 20);
    const result = await startParticipationChallenge(token, await body(request, participationChallengeInput), requestId);
    const response = json(result, 201);
    if ("proof" in result) response.headers.append("Set-Cookie", `${PARTICIPATION_COOKIE}=${result.proof}; Path=/api/v1/public/forms/${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Max-Age=1800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
    return response;
  }
  if (action === "participation-challenges-verify") {
    await rateLimit("public:participation-verify:" + tokenHash(token), 40);
    const input = await body(request, participationChallengeVerifyInput.extend({ challengeId: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict());
    const { challengeId, ...verification } = input;
    const result = await verifyParticipationChallenge(token, challengeId, verification, requestId), response = json(result);
    response.headers.append("Set-Cookie", `${PARTICIPATION_COOKIE}=${result.proof}; Path=/api/v1/public/forms/${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Max-Age=1800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
    return response;
  }
  if (action !== "submissions") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await rateLimit("public:submit:" + tokenHash(token), 120);
  const input = await body(request, submissionInput);
  const result = await submitForm(token, input, request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
