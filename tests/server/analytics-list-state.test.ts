import { describe, expect, test } from "vitest";
import { analyticsKstBoundary, analyticsListState, complianceListState } from "@/lib/analytics-list-state";
import { listHref } from "@/lib/list-url-state";

describe("R23 통계 화면 URL 상태", () => {
  test("기간·검색을 안전한 값으로 복원한다", () => {
    expect(analyticsListState(new URLSearchParams("from=2026-10-01&to=2026-10-31&q=%EA%B2%80%EC%83%89")))
      .toEqual({ from: "2026-10-01", to: "2026-10-31", search: "검색" });
    expect(analyticsListState(new URLSearchParams("from=2026-02-30&to=no&q=")))
      .toEqual({ from: "", to: "", search: "" });
  });

  test("날짜 필터는 실행 호스트 시간대와 무관한 KST 반개구간으로 변환한다", () => {
    expect(analyticsKstBoundary("2026-10-01", false)).toBe("2026-10-01T00:00:00+09:00");
    expect(analyticsKstBoundary("2026-10-31", true)).toBe("2026-11-01T00:00:00+09:00");
    expect(analyticsKstBoundary("2028-02-29", true)).toBe("2028-03-01T00:00:00+09:00");
    expect(analyticsKstBoundary("invalid", false)).toBe("");
  });

  test("월마감 범위·출력 페이지를 복원하고 비정상 값을 기본값으로 제한한다", () => {
    const id = "20000000-0000-4000-8000-000000000001";
    expect(complianceListState(new URLSearchParams(`month=2026-09&scope=${id}&exportPage=3&exportPageSize=50`), "2026-10"))
      .toEqual({ month: "2026-09", scope: id, exportPage: 3, exportPageSize: 50 });
    expect(complianceListState(new URLSearchParams("month=2200-01&scope=wrong&exportPage=-1&exportPageSize=7"), "2026-10"))
      .toEqual({ month: "2026-10", scope: "", exportPage: 1, exportPageSize: 10 });
    expect(complianceListState(new URLSearchParams("scope=company"), "2026-10").scope).toBe("company");
  });

  test("필터 적용·초기화 URL이 뒤로가기에 보존된다", () => {
    expect(listHref("/privacy-detail", "", { from: "2026-10-01", to: "2026-10-31", q: "서비스", page: 1 }))
      .toBe("/privacy-detail?from=2026-10-01&to=2026-10-31&q=%EC%84%9C%EB%B9%84%EC%8A%A4");
    expect(listHref("/log/month-monitoring", "month=2026-10&scope=company&exportPage=4", { exportPage: null, exportPageSize: 20 }))
      .toBe("/log/month-monitoring?month=2026-10&scope=company&exportPageSize=20");
  });
});
