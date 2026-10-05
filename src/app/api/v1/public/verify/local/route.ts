import { route, json, body, rateLimit } from "@/server/http";
import { verificationProviderInput } from "@/contracts/verification";
import { localVerificationResponse } from "@/server/verification-flow";

// 내장 sandbox 공급자 — challenge에 묶인 어서션에 서명한다.
// 외부 본인인증사의 challenge→assertion 역할을 로컬에서 재현하는 어댑터이며,
// signature는 콜백이 실제로 검증하는 값이다.
export const POST = route(async (request, requestId) => {
  const input = await body(request, verificationProviderInput);
  await rateLimit("public:verify-local:" + input.attemptId, 10);
  return json(await localVerificationResponse(input, requestId));
});
