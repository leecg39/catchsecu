import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: "", paths: [] as string[], pushed: [] as string[] }));
const orderId = "10000000-0000-4000-8000-000000000001";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  usePathname: () => "/pay/history",
  useRouter: () => ({ push: (path: string) => state.pushed.push(path), replace: (path: string) => state.pushed.push(path) }),
}));
vi.mock("@/lib/api", () => ({
  api: vi.fn(), ApiError: class extends Error {}, errorText: String,
  useResource: (path: string | null) => {
    if (path) state.paths.push(path);
    if (path?.startsWith("/usage-events")) return { reload: vi.fn(), data: { items: [{
      id: "usage-1", kind: "capture", sourceKind: "campaign_delivery", serviceId: "service-1", serviceName: "문자 서비스",
      amount: 60, currency: "KRW", reservationId: "reserve-1", entries: [], createdAt: "2026-10-10T03:00:00.000Z",
    }], total: 21, page: 2, pageSize: 20 } };
    if (path === "/billing/orders") return { reload: vi.fn(), data: { items: [
      { id: orderId, subscriptionId: "sub-1", planName: "개인정보 수명 관리", amount: 12000, currency: "KRW", status: "paid", refundedTotal: 2000, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", version: 2 },
      { id: "20000000-0000-4000-8000-000000000002", subscriptionId: "sub-2", planName: "대기 상품", amount: 9000, currency: "KRW", status: "pending", refundedTotal: 0, createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z", version: 1 },
    ] } };
    return { reload: vi.fn(), data: { items: [], total: 0, page: 1, pageSize: 10 } };
  },
}));

import { billingHistoryListState } from "@/lib/billing-list-state";
import { PaymentCancel, PaymentHistory } from "@/components/services/payment";
import { ServicesPages } from "@/components/services";

beforeEach(() => { state.query = ""; state.paths = []; state.pushed = []; });

test("결제 내역의 탭·기간·페이지·행 수를 URL에서 안전하게 복원한다", () => {
  expect(billingHistoryListState(new URLSearchParams("tab=message&from=2026-10-01&to=2026-10-11&page=20&pageSize=50")))
    .toEqual({ tab: "message", fromMonth: "", toMonth: "", from: "2026-10-01", to: "2026-10-11", page: 20, pageSize: 50 });
  expect(billingHistoryListState(new URLSearchParams("tab=other&from=bad&to=2026-02-30&page=-1&pageSize=999")))
    .toEqual({ tab: "billing", fromMonth: "", toMonth: "", from: "", to: "", page: 1, pageSize: 10 });
});

test("문자 탭은 영속 원장 사용 내역을 조회하고 서버 페이지 상태를 표시한다", () => {
  state.query = "tab=message&from=2026-10-01&to=2026-10-11&page=2&pageSize=20";
  const html = renderToStaticMarkup(createElement(PaymentHistory));
  expect(state.paths).toContain("/usage-events?category=message&page=2&pageSize=20&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-11T23%3A59%3A59.999Z");
  expect(html).toContain("문자 서비스");
  expect(html).toContain("사용 확정");
  expect(html).toContain("2 / 2");
  expect(html).not.toContain("문자 공급자 연동 후 표시됩니다");
});

test("결제 취소 경로는 실패 안내 대신 실제 환불 가능한 주문을 선택하게 한다", () => {
  const html = renderToStaticMarkup(createElement(PaymentCancel));
  expect(html).toContain("환불할 결제 선택");
  expect(html).toContain("개인정보 수명 관리");
  expect(html).toContain(`/bill/${orderId}/refund`);
  expect(html).not.toContain("주문이 완료되지 않았습니다");
  expect(renderToStaticMarkup(createElement(ServicesPages, { path: "/pay/cancel" }))).toContain("환불할 결제 선택");
});

test.each([
  `/pay/result/success/${orderId}`,
  `/pay/credit/success/${orderId}`,
  `/pay/plus/success/${orderId}`,
  `/pay/plus/success/${orderId}/credit`,
])("정확한 성공 경로 %s만 서버 주문 상태를 조회한다", path => {
  const html = renderToStaticMarkup(createElement(ServicesPages, { path }));
  expect(html).toContain("결제 결과");
  expect(state.paths).toContain(`/billing/orders/${orderId}?result=`);
});

test.each([
  `/pay/result/success/${orderId}/extra`,
  `/pay/credit/success/${orderId}/extra`,
  `/pay/plus/success/${orderId}/credit/extra`,
  "/pay/result/fail/extra",
  "/pay/plus/fail/error/extra",
])("정의되지 않은 결과 경로 %s는 주문 상태를 조회하지 않는다", path => {
  const html = renderToStaticMarkup(createElement(ServicesPages, { path }));
  expect(html).toContain("화면을 확인할 수 없습니다");
  expect(state.paths.some(value => value.startsWith("/billing/orders/"))).toBe(false);
});

test.each(["/pay/result/fail", "/pay/plus/fail/provider_error"])("정확한 실패 경로 %s는 실패 안내를 표시한다", path => {
  expect(renderToStaticMarkup(createElement(ServicesPages, { path }))).toContain("주문이 완료되지 않았습니다");
});
