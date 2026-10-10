/** Route contracts describe preparation and expected outcomes, never execution success. */
export type FixtureValue = { value: string; model: string; verified: boolean; limitation?: string };
export type FixtureBindings = Partial<Record<
  "service" | "form" | "submission" | "question" | "file" | "publicForm" | "fixedUrl" |
  "document" | "documentToken" | "subjectToken" | "kakaoTemplate" | "paymentOrder" |
  "notice" | "guide" | "supportTicket" | "importJob" | "unsubscribeToken", FixtureValue>>;
export type FixtureRoute = {
  id: string; path: string; domain: string; route_kind?: string; page_acceptance: string;
  actors: string; api_operations: { method: string; path: string }[];
};
const authStatePaths = new Set([
  "/auth-code", "/login-otp", "/two-step", "/two-step-setting", "/passwordChange",
  "/login/gpki/callback", "/login/saeol/callback", "/login/oauth2/verified",
  "/login/saml/verified", "/link/oauth2/verified", "/gpki/email-register",
]);
const externalAuth = /^(?:\/login\/(?:gpki|saeol|oauth2|saml)|\/gpki\/|\/saeol\/|\/gwloginUser\/|\/link\/oauth2|\/oauth2\/)/;
const authPath = /^(?:\/login|\/signup|\/auth-code|\/password|\/two-step|\/gpki|\/saeol|\/gwloginUser|\/link\/oauth2|\/oauth2|\/expire)/;

function bindingKey(path: string, name: string): keyof FixtureBindings | null {
  if (name === "serviceId") return "service";
  if (name === "formId") return "form";
  if (name === "customerId") return "submission";
  if (name === "questionId") return "question";
  if (name === "fileId") return "file";
  if (name === "templateId") return "kakaoTemplate";
  if (name === "admNotiId") return "notice";
  if (name === "purchaseId" || name === "purchasedId") return "paymentOrder";
  if (name === "infoOwnerToken") return "subjectToken";
  if (name === "token" && path.startsWith("/document/")) return "documentToken";
  if (name === "token" && path.startsWith("/email/unsubscribe/")) return "unsubscribeToken";
  if (name === "outerToken") return path.startsWith("/url/") ? "fixedUrl" : "publicForm";
  if (name === "id") {
    if (/^\/(?:bill|creditBill)\//.test(path)) return "paymentOrder";
    if (path.startsWith("/admin/notices/")) return "notice";
    if (path.startsWith("/admin/guides/")) return "guide";
    if (/^\/(?:admin|my-page)\/support\//.test(path)) return "supportTicket";
  }
  return null;
}
const literals: Record<string, string> = { type: "license", errorCode: "PG_DENIED", category: "items", agree: "required", isDomestic: "domestic", result: "pending", org: "fixture-org" };

export function buildRouteFixture(route: FixtureRoute, bindings: FixtureBindings) {
  const missing: string[] = [], used: Array<{ parameter: string; binding: keyof FixtureBindings; model: string; limitation?: string }> = [];
  function resolveValue(name: string, key: keyof FixtureBindings) {
    const fixture = bindings[key];
    if (!fixture?.verified || !fixture.value) { missing.push(key); return ""; }
    used.push({ parameter: name, binding: key, model: fixture.model, limitation: fixture.limitation });
    return encodeURIComponent(fixture.value);
  }
  const fallback = route.route_kind === "fallback" || route.path.includes("*");
  let path = fallback ? route.path.replace("*", "__rea_unknown_route__") : route.path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const key = bindingKey(route.path, name);
    if (key) return resolveValue(name, key);
    if (literals[name]) return literals[name];
    throw new Error(route.id + ": unknown route parameter " + name);
  });
  const query: string[] = [];
  if (/^\/form\/ai\/(?:basic-frame(?:\/v3)?|agreement|recipient|set|setting|share)$/.test(route.path))
    query.push("formId=" + resolveValue("formId query", "form"));
  if (route.path === "/basic/result/consent/edit") query.push("documentId=" + resolveValue("documentId query", "document"));
  if (/^\/form\/info-upload\/(?:agreement|recipient)$/.test(route.path)) query.push("jobId=" + resolveValue("jobId query", "importJob"));
  if (query.length) path += "?" + query.join("&");
  const external = externalAuth.test(route.path);
  const browserState = authStatePaths.has(route.path) || route.path.startsWith("/shared-privacy/") ||
    route.path.includes("/shared") || route.path.startsWith("/infoOwner/agree-history/") ||
    route.path.startsWith("/infoOwner/action-history/") || route.path.startsWith("/identification/");
  const prerequisites = [
    ...missing.map(key => "실제 DB/API에서 " + key + " fixture 생성·유효 상태 확인"),
    ...(browserState ? ["선행 요청으로 발급한 state/challenge/OTP 또는 해당 토큰에 바인딩된 브라우저 세션 준비. URL 방문만으로 성공 처리 금지"] : []),
    ...(external ? ["시험 IdP/기관 계정과 서명된 실제 callback 준비. 임의 result/state로 대체 금지"] : []),
  ];
  const anonymous = /^(?:\/project[s]?\/|\/test-projects\/|\/url\/|\/document\/|\/infoOwner\/|\/shared-privacy\/|\/identification\/|\/customer-use-case\/)/.test(route.path);
  return {
    routeId: route.id, template: route.path, path: missing.length ? null : path,
    domain: route.domain, fallback, bindings: used, missingBindings: [...new Set(missing)],
    preparation: prerequisites.length ? "required" : "ready_for_execution",
    prerequisites, externalRequired: external, execution: "not_run",
    scenarios: [
      { id: route.id + "-normal", kind: "normal", actor: anonymous ? "해당 공개 토큰/브라우저 소유자" : authPath.test(route.path) ? "인증 흐름에 맞는 미로그인/인증대기 계정" : route.actors,
        expected: fallback ? "HTTP 404, 업무 API 호출/쓰기 없음" : route.page_acceptance, execution: "not_run" },
      { id: route.id + "-denied", kind: "denied", actor: anonymous ? "다른 브라우저·만료/회수된 토큰" : "미로그인·권한 없는 역할·다른 회사/서비스",
        expected: authPath.test(route.path) ? "유효 challenge 없이 세션 발급/계정 연결 불가" : "401/403/404/410 또는 명시적인 권한 화면; 데이터와 성공 알림 없음", execution: "not_run" },
      { id: route.id + "-failure", kind: "failure", actor: "정상 시나리오와 동일",
        expected: fallback ? "잘못된 하위 URL도 404; wildcard가 임의 경로를 허용하지 않음" : "잘못된 ID/버전 충돌/서버 실패를 오류로 표시; 입력 보존; 재시도 후 DB 중복 변경 없음", execution: "not_run" },
    ],
    apiCandidates: route.api_operations,
    limitation: "계약/fixture 준비 상태만 검사한다. HTTP 200, 파일 존재, 선언된 시나리오는 CRUD 실행 통과 증거가 아니다.",
  };
}
