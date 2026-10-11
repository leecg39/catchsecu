import { expect, test } from "vitest";
import { activityListHref, activityListState, listDate, reviewListState } from "@/lib/activity-list-state";

test("공유 주소의 날짜·범위·페이지 입력은 API 호출 전에 유효한 값으로 제한한다", () => {
  const state = reviewListState(new URLSearchParams("scope=other&status=deleted&from=2026-02-30&to=oops&page=1e30&pageSize=500&reviewId=oops&serviceId=oops"));
  expect(state).toMatchObject({ scope: "received", status: "all", from: "", to: "", page: 100000, pageSize: 10, reviewId: "", serviceId: "" });
  expect(listDate("2024-02-29")).toBe("2024-02-29");
  expect(listDate("2025-02-29")).toBe("");
  expect(activityListState(new URLSearchParams("page=-2&pageSize=20"))).toMatchObject({ page: 1, pageSize: 20 });
});

test("20페이지·20행과 검색 특수문자가 URL 왕복 뒤에도 같은 목록 조건을 만든다", () => {
  const href = activityListHref("/my-page/info-activity-log", "scope=company", { page: 20, pageSize: 20, q: "가&나+# /", from: "2026-01-01", status: "resolved" });
  const state = reviewListState(new URL(href, "https://example.test").searchParams);
  expect(state).toMatchObject({ scope: "company", page: 20, pageSize: 20, search: "가&나+# /", from: "2026-01-01", status: "resolved" });
});

test("상세 선택을 닫아도 기존 목록 조건을 유지하며 새로고침으로 상세가 다시 열리지 않는다", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const opened = activityListHref("/my-page/info-activity-log", "scope=sent&page=2&q=요청", { reviewId: id });
  expect(reviewListState(new URL(opened, "https://example.test").searchParams).reviewId).toBe(id);
  const closed = activityListHref("/my-page/info-activity-log", opened.split("?")[1], { reviewId: null });
  expect(reviewListState(new URL(closed, "https://example.test").searchParams)).toMatchObject({ scope: "sent", page: 2, search: "요청", reviewId: "" });
});
