import { route, json, body, fail, rateLimit } from "@/server/http";
import { publicForm, submitForm } from "@/server/submissions";
import { submissionInput } from "@/contracts/domains";
import { tokenHash } from "@/server/crypto";
import { publicUploadInput } from "@/contracts/files";
import { initPublicUpload } from "@/server/files";
function parts(request: Request) {
  const [token, action, ...rest] = new URL(request.url).pathname.split("/").slice(5);
  if (rest.length || !token) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  return { token, action };
}
export const GET = route(async request => {
  const { token, action } = parts(request);
  if (action) fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await rateLimit("public:read:" + tokenHash(token), 300);
  return json(await publicForm(token));
});
export const POST = route(async (request, requestId) => {
  const { token, action } = parts(request);
  if (action === "uploads") {
    await rateLimit("public:upload:" + tokenHash(token), 30);
    const result = await initPublicUpload(token, await body(request, publicUploadInput), request.headers.get("idempotency-key"), requestId);
    return json(result.body, result.status);
  }
  if (action !== "submissions") fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
  await rateLimit("public:submit:" + tokenHash(token), 120);
  const input = await body(request, submissionInput);
  const result = await submitForm(token, input, request.headers.get("idempotency-key"), requestId);
  return json(result.body, result.status);
});
