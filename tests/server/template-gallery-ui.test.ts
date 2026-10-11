import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ archived: false, query: "", queried: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query || (state.archived ? "scope=company&status=archived" : "scope=company")),
  usePathname: () => "/form/template",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/ApplicationContext", () => ({ useApplication: () => ({ data: {
  serviceId: "20000000-0000-4000-8000-000000000001",
} }) }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error { status = 500; }, api: vi.fn(), errorText: String,
  useResource: (path: string | null) => {
    if (path) state.queried.push(path);
    const archived = path?.includes("status=archived") ?? false;
    return { loading: false, reload: vi.fn(), data: !path ? undefined : {
      items: [{
        id: "30000000-0000-4000-8000-000000000001", serviceId: "20000000-0000-4000-8000-000000000001", serviceName: "검증 서비스",
        scope: "company", title: archived ? "보관 템플릿" : "활성 템플릿", category: "QA", description: "상태 화면 검증", thumbnailAssetId: null,
        licenseScope: "SERVICE", licenseAvailable: true, status: archived ? "archived" : "active", version: archived ? 2 : 1,
        createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z",
        content: { body: "본문", questions: [], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 },
        actions: archived
          ? { preview: true, use: false, edit: false, archive: false, restore: true, remove: true }
          : { preview: true, use: true, edit: true, archive: true, restore: false, remove: true },
      }], total: 1, page: 1, pageSize: 20,
      permissions: { canCreate: true, subscriptionActive: false, targets: [{ id: "20000000-0000-4000-8000-000000000001", name: "검증 서비스" }] },
    } };
  },
}));

import { TemplateGallery } from "@/components/forms/TemplateGallery";

beforeEach(() => { state.archived = false; state.query = ""; state.queried = []; });

test("서비스 템플릿 활성 목록은 상태 필터와 편집·보관 동작을 표시한다", () => {
  const html = renderToStaticMarkup(createElement(TemplateGallery));
  expect(state.queried[0]).toContain("scope=company");
  expect(state.queried[0]).toContain("status=active");
  expect(html).toContain("템플릿 상태");
  expect(html).toContain("활성 템플릿");
  expect(html).toContain(">사용하기<");
  expect(html).toContain(">편집<");
  expect(html).toContain(">보관<");
  expect(html).not.toContain(">복원<");
});

test("보관 목록은 복원·삭제만 제공하고 새 사용·편집을 숨긴다", () => {
  state.archived = true;
  const html = renderToStaticMarkup(createElement(TemplateGallery));
  expect(state.queried[0]).toContain("status=archived");
  expect(html).toContain("보관 템플릿");
  expect(html).toContain("보관됨");
  expect(html).toContain(">복원<");
  expect(html).toContain(">삭제<");
  expect(html).not.toContain(">사용하기<");
  expect(html).not.toContain(">편집<");
});

test("직접 진입 URL의 검색·보관·페이지 크기를 API와 입력에 복원한다", () => {
  state.query = "scope=company&status=archived&q=" + encodeURIComponent("한글 & QA") + "&page=3&pageSize=10";
  const html = renderToStaticMarkup(createElement(TemplateGallery));
  const params = new URL(state.queried[0], "https://qa.test").searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ scope: "company", status: "archived", search: "한글 & QA", page: "3", pageSize: "10" });
  expect(html).toContain('value="한글 &amp; QA"');
});

test("잘못된 페이지와 크기는 기본값으로 제한하고 공용 목록은 보관 상태를 적용하지 않는다", () => {
  state.query = "scope=public&status=archived&page=-3&pageSize=999&q=" + "x".repeat(101);
  renderToStaticMarkup(createElement(TemplateGallery));
  const params = new URL(state.queried[0], "https://qa.test").searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ scope: "public", status: "active", page: "1", pageSize: "20", search: "x".repeat(100) });
});
