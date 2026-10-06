import { expect, test } from "vitest";
import { summarizePageGate, type PageGateResult } from "../../scripts/lib/qa-page-gate";
const valid = (path: string): PageGateResult => ({ manifestPath: path, route: path, status: 200, finalUrl: path,
  overflow: { 1440: false, 768: false, 390: false }, refreshed: true, backOk: true, consoleErrors: [] });
test("모든 기대 경로의 세 해상도·새로고침·뒤로가기 확인이 있어야 통과한다", () => {
  expect(summarizePageGate(["/a", "/b"], [valid("/a"), valid("/b")])).toMatchObject({ result: "passed", checked: 2 });
});
test("기록하지 않은 경로와 명시적인 스킵은 모두 전체 통과를 막는다", () => {
  expect(summarizePageGate(["/a", "/b"], [valid("/a")])).toMatchObject({ result: "failed", missing: ["/b"] });
  expect(summarizePageGate(["/a", "/b"], [valid("/a"), { ...valid("/b"), skipped: "fixture 없음" }])).toMatchObject({ result: "failed", checked: 1, skipped: [{ path: "/b", reason: "fixture 없음" }] });
});
test("중복 경로나 예상 밖 경로로 누락을 채울 수 없다", () => {
  expect(summarizePageGate(["/a", "/b"], [valid("/a"), valid("/a"), valid("/c")])).toMatchObject({ result: "failed", missing: ["/b"], duplicate: ["/a"], unexpected: ["/c"] });
});
for (const [name, patch] of Object.entries({ status: { status: 503 }, redirect: { status: 307 }, finalUrl: { finalUrl: undefined },
  overflow: { overflow: { 1440: false, 768: false, 390: true } }, missingViewport: { overflow: { 1440: false } },
  refresh: { refreshed: undefined }, back: { backOk: false }, console: { consoleErrors: ["render failed"] }, error: { error: "timeout" } })) {
  test(`${name}: 불완전하거나 실패한 관찰은 통과하지 않는다`, () => {
    expect(summarizePageGate(["/a"], [{ ...valid("/a"), ...patch }])).toMatchObject({ result: "failed", failed: ["/a"] });
  });
}

test("알 수 없는 동적 인자는 임의 토큰으로 대체하지 않는다", async () => {
  const { resolvePageFixture } = await import("../../scripts/lib/qa-page-gate");
  expect(resolvePageFixture("/notice/:admNotiId", { ":noticeId": "5", ":token": "invalid" })).toEqual({ route: "/notice/:admNotiId", missing: [":admNotiId"] });
  expect(resolvePageFixture("/notice/:admNotiId", { ":admNotiId": "5" })).toEqual({ route: "/notice/5", missing: [] });
});
test("fixture 값은 경로 인자로 인코딩한다", async () => {
  const { resolvePageFixture } = await import("../../scripts/lib/qa-page-gate");
  expect(resolvePageFixture("/document/:token", { ":token": "a/b?c" })).toEqual({ route: "/document/a%2Fb%3Fc", missing: [] });
});
