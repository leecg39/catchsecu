import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { RemoteTable } from "@/components/RemoteTable";
const base = { columns: ["이름", "상태"], rows: [{ id: "1", cells: ["저장된 행", "완료"] }], total: 1, page: 1, pageSize: 20, onPage: () => {}, onPageSize: () => {} };
test("정상 응답은 데이터 행과 페이지 수를 유지한다", () => {
  const html = renderToStaticMarkup(createElement(RemoteTable, base));
  expect(html).toContain("저장된 행"); expect(html).toContain("완료"); expect(html).not.toContain('role="alert"');
});
test("로딩 안내는 이전 데이터 대신 표시되고 가로 스크롤 표 밖에 있다", () => {
  const html = renderToStaticMarkup(createElement(RemoteTable, { ...base, loading: true }));
  expect(html).not.toContain("저장된 행"); expect(html).toContain('aria-busy="true"');
  expect(html.indexOf('role="status"')).toBeGreaterThan(html.indexOf("</table>"));
});
test("조회 실패는 이전 데이터를 숨기고 오류를 표 밖에서 알린다", () => {
  const html = renderToStaticMarkup(createElement(RemoteTable, { ...base, error: "조회에 실패했습니다" }));
  expect(html).not.toContain("저장된 행"); expect(html).toContain("조회에 실패했습니다");
  expect(html.indexOf('role="alert"')).toBeGreaterThan(html.indexOf("</table>"));
});
test("빈 목록 문구는 넓은 표 밖에서 표시되고 이전/다음 이동을 막는다", () => {
  const html = renderToStaticMarkup(createElement(RemoteTable, { ...base, rows: [], total: 0, empty: "등록된 발신자가 없습니다" }));
  expect(html.indexOf("등록된 발신자가 없습니다")).toBeGreaterThan(html.indexOf("</table>"));
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});
