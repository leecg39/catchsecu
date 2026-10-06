import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ capabilities: ["billing.read", "billing.write"], status: "paid", error: null as null | { message: string }, queried: [] as string[] }));
const id = "10000000-0000-4000-8000-000000000001";
vi.mock("@/components/ApplicationContext", () => ({ useApplication: () => ({ data: { capabilities: state.capabilities } }) }));
vi.mock("@/lib/api", () => ({ api: vi.fn(), errorText: String, useResource: (path: string) => {
 state.queried.push(path);
 return { error: state.error, reload: vi.fn(), data: path === "/subscriptions" ? { subscriptions: [{ id: "sub", planName: "Mock Plan", periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-11-01T00:00:00Z" }] } : path.endsWith("/refunds") ? { items: [{ id: "r1", amount: 2000, status: "refunded", reason: "partial", createdAt: "2026-10-02T00:00:00Z" }, { id: "r2", amount: 3000, status: "requested", reason: "pending", createdAt: "2026-10-03T00:00:00Z" }], refundedTotal: 2000, refundable: 10000 } : { id: "10000000-0000-4000-8000-000000000001", subscriptionId: "sub", amount: 12000, currency: "KRW", status: state.status } };
} }));
import { InvoiceDetail } from "@/components/services/InvoiceDetail";
const render = (refundMode = false, orderId = id) => renderToStaticMarkup(createElement(InvoiceDetail, { id: orderId, refundMode }));
beforeEach(() => { state.capabilities = ["billing.read", "billing.write"]; state.status = "paid"; state.error = null; state.queried = []; });
test("invalid invoice path does not query billing data", () => { expect(render(false, "invalid")).toContain("청구서 주소"); expect(state.queried).toEqual([]); });
test("missing read capability denies detail before requests", () => { state.capabilities = []; expect(render()).toContain("조회할 권한"); expect(state.queried).toEqual([]); });
test("paid detail shows actual amount, PDF, and excludes pending refunds from available total", () => { const html = render(); expect(html).toContain("12,000원"); expect(html).toContain("7,000원"); expect(html).toContain("청구서 PDF 다운로드"); expect(html).toContain("Mock Plan"); });
test("pending payment does not offer invoice PDF or refund action", () => { state.status = "pending"; const html = render(); expect(html).not.toContain("청구서 PDF 다운로드"); expect(html).not.toContain("환불 요청하기"); });
test("read-only caller can see invoice but cannot request refund", () => { state.capabilities = ["billing.read"]; expect(render()).not.toContain("환불 요청하기"); expect(render(true)).toContain("환불을 요청할 권한"); expect(render(true)).not.toContain('name="amount"'); });
test("resource denial hides old amounts and offers retry", () => { state.error = {message: "접근이 거부되었습니다"}; const html=render(); expect(html).toContain("다시 시도"); expect(html).not.toContain("12,000원"); expect(html).not.toContain("청구서 PDF 다운로드"); });

import { ServicesPages } from "@/components/services";
test.each([`/bill/${id}`, `/creditBill/${id}`, `/bill/${id}/refund`])("실제 화면 경로 %s가 청구 데이터를 표시한다", path => {
  const html = renderToStaticMarkup(createElement(ServicesPages, { path }));
  expect(html).toContain("Mock Plan"); expect(html).toContain("12,000원");
  if (path.endsWith("/refund")) expect(html).toContain('name="amount"');
});
