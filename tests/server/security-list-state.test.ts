import { expect, test } from "vitest";
import { listHref } from "@/lib/list-url-state";
import { ipListState, mfaListState } from "@/lib/security-list-state";

test("20페이지는 기본 행 수와 구분하고 검색 특수문자와 정렬을 주소에 유지한다", () => {
  const href = listHref("/security/ip", "", { page: 20, pageSize: 20, q: "IPv6 & 설명 +#", status: "disabled", sort: "cidr", direction: "asc" });
  expect(ipListState(new URL(href, "https://example.test").searchParams)).toEqual({ page: 20, pageSize: 20, search: "IPv6 & 설명 +#", status: "disabled", sort: "cidr", direction: "asc" });
  expect(listHref("/security/ip", "page=2&pageSize=10", { page: 1, pageSize: 20 })).toBe("/security/ip");
});

test("잘못된 보안 목록 주소는 제한된 API 계약 값으로 복원한다", () => {
  const params = new URLSearchParams("page=1e30&pageSize=1000&status=deleted&sort=sql&direction=other");
  expect(ipListState(params)).toEqual({ page: 100000, pageSize: 20, search: "", status: "all", sort: "createdAt", direction: "desc" });
  expect(mfaListState(new URLSearchParams("page=-1&status=exception&q=홍길동"))).toEqual({ page: 1, pageSize: 20, search: "홍길동", status: "exception" });
});
