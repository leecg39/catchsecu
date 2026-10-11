import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ query: "", queried: [] as string[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query), usePathname: () => "/form/fixed-url", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/ApplicationContext", () => ({ useApplication: () => ({ data: { serviceId: "20000000-0000-4000-8000-000000000001", capabilities: ["form.read", "form.publish"] } }) }));
vi.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, api: vi.fn(), errorText: String,
  useResource: (path: string | null) => { if (path) state.queried.push(path); return { loading: false, reload: vi.fn(), data: { items: [], page: 1, pageSize: 20, total: 0 } }; },
}));
import { FixedUrls } from "@/components/forms/FixedUrls";
beforeEach(() => { state.query = ""; state.queried = []; });
test("고정 URL의 검색·종료상태·페이지를 직접 진입 URL에서 복원한다", () => {
  state.query = "q=" + encodeURIComponent("한글 & URL") + "&status=revoked&page=2&pageSize=10";
  const html = renderToStaticMarkup(createElement(FixedUrls));
  expect(Object.fromEntries(new URL(state.queried[0], "https://qa.test").searchParams)).toMatchObject({ search: "한글 & URL", status: "revoked", page: "2", pageSize: "10", serviceId: "20000000-0000-4000-8000-000000000001" });
  expect(html).toContain('value="한글 &amp; URL"');
  expect(html).toContain('value="revoked" selected=""');
});
test("잘못된 상태·페이지 크기와 음수 페이지는 유효한 기본 목록으로 정규화한다", () => {
  state.query = "status=unknown&page=-1&pageSize=999&q=" + "a".repeat(101);
  renderToStaticMarkup(createElement(FixedUrls));
  expect(Object.fromEntries(new URL(state.queried[0], "https://qa.test").searchParams)).toMatchObject({ search: "a".repeat(100), status: "active", page: "1", pageSize: "20" });
});
test("과도한 페이지는 서버 계약 상한 내로 제한한다", () => {
  state.query = "page=100001&pageSize=100";
  renderToStaticMarkup(createElement(FixedUrls));
  expect(new URL(state.queried[0], "https://qa.test").searchParams.get("page")).toBe("100000");
});
