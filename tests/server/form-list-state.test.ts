import { expect, test } from "vitest";
import { formListState } from "@/lib/form-list-state";
import { listHref } from "@/lib/list-url-state";

test("목록 링크는 검색·날짜·보관·즐겨찾기·정렬·페이지를 복원한다", () => {
  expect(formListState(new URLSearchParams("q=한글+%26+QA&start=2026-10-01&end=2026-10-11&status=archived&favorite=true&sort=name&direction=asc&page=3&pageSize=10")))
    .toEqual({ search: "한글 & QA", start: "2026-10-01", end: "2026-10-11", status: "archived", favorite: true, sort: "name", direction: "asc", page: 3, pageSize: 10, expanded: true });
});
test("잘못된 날짜와 목록 값은 유효한 기본값으로 제한한다", () => {
  expect(formListState(new URLSearchParams("start=2026-02-30&end=bad&status=unknown&favorite=yes&sort=bad&direction=bad&page=-1&pageSize=999")))
    .toEqual({ search: "", start: "", end: "", status: "", favorite: false, sort: "createdAt", direction: "desc", page: 1, pageSize: 20, expanded: false });
});
test("상세 검색 닫힘은 날짜 필터를 보존하고 URL 입력 길이와 페이지 상한을 적용한다", () => {
  const result = formListState(new URLSearchParams("details=0&start=2026-10-01&page=999999&q=" + "x".repeat(101)));
  expect(result).toMatchObject({ start: "2026-10-01", expanded: false, page: 100000, search: "x".repeat(100) });
});
test("검색 초기화는 필터만 제거하며 페이지 크기와 정렬을 유지한다", () => {
  const url = listHref("/form/manage", "q=old&start=2026-10-01&status=archived&favorite=true&page=2&pageSize=10&sort=name", { q: null, start: null, status: null, favorite: null, page: 1 });
  expect(formListState(new URL(url, "https://qa.test").searchParams)).toMatchObject({ search: "", start: "", status: "", favorite: false, page: 1, pageSize: 10, sort: "name" });
});
