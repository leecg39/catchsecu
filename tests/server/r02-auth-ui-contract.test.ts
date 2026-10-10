import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import routeMatrix from "../../docs/planning/09-rea-fullstack/route-matrix.json";

const state = vi.hoisted(() => ({
  query: "returnTo=%2Fmy-page%2Finfo",
  resource: "ready" as "ready" | "loading" | "unauthorized" | "failed" | "companies",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number; code: string; requestId?: string; retryAfterSeconds?: number;
    constructor(message: string, status: number, code: string, requestId?: string, retryAfterSeconds?: number) {
      super(message); this.status = status; this.code = code; this.requestId = requestId; this.retryAfterSeconds = retryAfterSeconds;
    }
  },
  api: vi.fn(),
  errorText: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
  useResource: (path: string | null) => {
    if (!path) return { loading: false, reload: vi.fn() };
    if (state.resource === "loading") return { loading: true, reload: vi.fn() };
    if (state.resource === "unauthorized") return { loading: false, error: { status: 401, message: "세션이 만료되었습니다." }, reload: vi.fn() };
    if (state.resource === "failed") return { loading: false, error: { status: 500, message: "일시적으로 불러오지 못했습니다." }, reload: vi.fn() };
    if (path.startsWith("/companies")) return state.resource === "companies"
      ? { loading: false, data: { items: [{ id: "company-a", name: "접근 가능한 회사" }], total: 21, page: 1, pageSize: 20, blockedTotal: 1 }, reload: vi.fn() }
      : { loading: false, data: { items: [], total: 0, page: 1, pageSize: 20, blockedTotal: 1 }, reload: vi.fn() };
    if (path === "/context") return { loading: false, data: { user: { twoFactorEnabled: false } }, reload: vi.fn() };
    return { loading: false, data: { required: false, minPassword: 12, passwordReuse: 10 }, reload: vi.fn() };
  },
}));

import { AuthPages, matchAuth } from "@/components/auth/AuthPages";

const render = (path: string) => renderToStaticMarkup(createElement(AuthPages, { path }));
const expected: Record<string, string> = {
  "/auth-code": "OTP 인증", "/expire/code": "인증 시간이 만료되었습니다.", "/login": "아직 계정이 없으신가요?",
  "/login-email": "이메일 인증", "/login-failed": "로그인에 실패했습니다.", "/login-otp": "OTP 인증", "/logout": "로그아웃",
  "/not-allow-ip": "허용되지 않은 IP 접근 제한", "/password-change-email": "비밀번호 찾기",
  "/password-change-email/complete": "이메일을 확인해주세요.", "/password-change-rule": "비밀번호 변경", "/passwordChange": "비밀번호 변경",
  "/signup": "회원가입", "/two-step": "2단계 인증 설정", "/two-step-setting": "2단계 인증 설정",
};

beforeEach(() => { state.query = "returnTo=%2Fmy-page%2Finfo"; state.resource = "ready"; });

test("R02-T03의 15개 원본 경로가 모두 독립 인증 화면으로 연결된다", () => {
  const paths = routeMatrix.filter(row => row.ui_task === "R02-T03").map(row => row.path).sort();
  expect(paths).toEqual(Object.keys(expected).sort());
  for (const path of paths) {
    expect(matchAuth(path)).toBe(true);
    const html = render(path);
    expect(html).toContain(expected[path]);
    expect(html).not.toContain("외부 인증이 필요합니다.");
  }
});

test("인증 링크는 안전한 returnTo만 유지하고 외부 이동값을 버린다", () => {
  expect(render("/signup")).toContain("/login?returnTo=%2Fmy-page%2Finfo");
  state.query = "returnTo=https%3A%2F%2Fevil.example%2Fsteal";
  const html = render("/signup");
  expect(html).not.toContain("evil.example");
  expect(html).toContain('href="/login"');
});

test("비밀번호 정책의 로딩·401·실패 상태는 입력을 숨기고 복구 행동을 제공한다", () => {
  state.resource = "loading"; expect(render("/password-change-rule")).toContain("비밀번호 정책을 확인하고 있습니다.");
  state.resource = "unauthorized"; const unauthorized = render("/password-change-rule");
  expect(unauthorized).toContain("로그인하거나 이메일 재설정 링크를 이용해주세요."); expect(unauthorized).not.toContain('name="current"');
  state.resource = "failed"; const failed = render("/password-change-rule");
  expect(failed).toContain("일시적으로 불러오지 못했습니다."); expect(failed).toContain("다시 시도"); expect(failed).not.toContain('name="current"');
});

test("MFA 설정은 로딩·세션 만료·서버 실패를 구분하고 재시도할 수 있다", () => {
  state.resource = "loading"; expect(render("/two-step-setting")).toContain("인증 설정을 확인하고 있습니다.");
  state.resource = "unauthorized"; const unauthorized = render("/two-step-setting");
  expect(unauthorized).toContain("세션이 만료되었습니다."); expect(unauthorized).toContain("다시 로그인");
  state.resource = "failed"; const failed = render("/two-step-setting");
  expect(failed).toContain("일시적으로 불러오지 못했습니다."); expect(failed).toContain("다시 시도");
});

test("IP 제한 화면은 빈 상태와 검색·선택·페이지 이동 상태를 구분한다", () => {
  const empty = render("/not-allow-ip");
  expect(empty).toContain("현재 IP에서 접근할 수 있는 회사가 없습니다."); expect(empty).toContain("회사 검색");
  state.resource = "companies"; const populated = render("/not-allow-ip");
  expect(populated).toContain("접근 가능한 회사 선택"); expect(populated).toContain("이전"); expect(populated).toContain("다음");
});

test("만료·콜백 오류는 returnTo를 보존한 재시작 링크와 한국어 오류를 표시한다", () => {
  state.query = "error=INVALID_TOKEN&returnTo=%2Fmy-page%2Finfo";
  const html = render("/passwordChange");
  expect(html).toContain("링크가 만료되었거나 이미 사용되었습니다.");
  expect(html).toContain("/password-change-email?returnTo=%2Fmy-page%2Finfo");
});
