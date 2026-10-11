import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: "", pathname: "/log/form-approval", queried: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/ApplicationContext", () => ({ useApplication: () => ({ data: {
  serviceId: "20000000-0000-4000-8000-000000000001",
} }) }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {}, api: vi.fn(), errorText: String,
  useResource: (path: string | null) => {
    if (path) state.queried.push(path);
    return { loading: false, reload: vi.fn(), data: path?.startsWith("/forms/")
      ? { items: [], total: 0, page: 1, pageSize: 10, policy: { requireApproval: true, referenceRequired: false, requestTemplate: "", approvalRevision: 1 }, canRequest: false, canReview: false }
      : { items: [], total: 0, page: 1, pageSize: 20 } };
  },
}));

import { ApprovalLog, ApprovalPanel } from "@/components/forms/Approvals";
import type { FormRecord } from "@/contracts/forms";

beforeEach(() => { state.query = ""; state.pathname = "/log/form-approval"; state.queried = []; });

const form = { id: "30000000-0000-4000-8000-000000000001", serviceId: "20000000-0000-4000-8000-000000000001",
  serviceName: "QA", ownerName: "QA", title: "승인 폼", status: "draft", version: 1, createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z", content: {}, draftNumber: 1, hasDraft: false, published: false, favorite: false,
  publication: null } as FormRecord;

test("승인 내역의 검색·상태·페이지를 직접 진입 URL에서 복원한다", () => {
  state.query = "q=" + encodeURIComponent("한글 & 승인") + "&status=rejected&page=3&pageSize=10";
  const html = renderToStaticMarkup(createElement(ApprovalLog));
  const params = new URL(state.queried[0], "https://qa.test").searchParams;
  expect(Object.fromEntries(params)).toMatchObject({
    search: "한글 & 승인", status: "rejected", page: "3", pageSize: "10",
    serviceId: "20000000-0000-4000-8000-000000000001",
  });
  expect(html).toContain('value="한글 &amp; 승인"');
  expect(html).toContain('value="rejected" selected=""');
});

test("잘못된 상태·페이지 크기·음수 페이지를 기본 목록으로 정규화한다", () => {
  state.query = "status=unknown&page=-1&pageSize=999&q=" + "a".repeat(101);
  renderToStaticMarkup(createElement(ApprovalLog));
  const params = new URL(state.queried[0], "https://qa.test").searchParams;
  expect(Object.fromEntries(params)).toMatchObject({
    search: "a".repeat(100), status: "all", page: "1", pageSize: "20",
  });
});

test("과도한 페이지를 서버 계약 상한으로 제한한다", () => {
  state.query = "page=100001&pageSize=100";
  renderToStaticMarkup(createElement(ApprovalLog));
  expect(new URL(state.queried[0], "https://qa.test").searchParams.get("page")).toBe("100000");
});

test("폼 설정의 승인 내역 페이지를 전용 URL 키에서 복원한다", () => {
  state.pathname = "/form/ai/setting";
  state.query = "formId=" + form.id + "&approvalPage=3&approvalPageSize=50";
  renderToStaticMarkup(createElement(ApprovalPanel, { form, dirty: false, onChanged: async () => undefined }));
  expect(state.queried[0]).toBe("/forms/" + form.id + "/approvals?page=3&pageSize=50");
});

test("폼 설정 승인 내역의 잘못된 페이지 값은 1·10으로 정규화한다", () => {
  state.pathname = "/form/ai/setting";
  state.query = "formId=" + form.id + "&approvalPage=-1&approvalPageSize=100";
  renderToStaticMarkup(createElement(ApprovalPanel, { form, dirty: false, onChanged: async () => undefined }));
  expect(state.queried[0]).toBe("/forms/" + form.id + "/approvals?page=1&pageSize=10");
});

test("폼 설정 승인 내역의 과도한 페이지를 서버 계약 상한으로 제한한다", () => {
  state.pathname = "/form/ai/setting";
  state.query = "formId=" + form.id + "&approvalPage=100001&approvalPageSize=20";
  renderToStaticMarkup(createElement(ApprovalPanel, { form, dirty: false, onChanged: async () => undefined }));
  expect(state.queried[0]).toBe("/forms/" + form.id + "/approvals?page=100000&pageSize=20");
});
