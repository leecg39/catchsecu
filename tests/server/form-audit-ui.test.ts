import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ queried: [] as string[], formService: "10000000-0000-4000-8000-000000000001", empty: false }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ApplicationContext", () => ({ useApplication: () => ({ data: { capabilities: ["audit.read"] } }) }));
vi.mock("@/lib/api", () => ({ api: vi.fn(), errorText: String, useResource: (path: string | null) => {
 if(path) state.queried.push(path);
 return { loading: false, reload: vi.fn(), data: !path ? undefined : path === "/context" ? { company: { role: "auditor" }, services: [] } : path.includes("/audit-events") ? { total: state.empty ? 0 : 1, page: 1, pageSize: 10, items: state.empty ? [] : [{ id: "event", createdAt: "2026-10-06T00:00:00Z", action: "submission.viewed", resource: "submission", resourceId: null, serviceName: "Mock", actorName: "관리자" }] } : { id: "10000000-0000-4000-8000-000000000002", serviceId: state.formService, title: "폼" } };
} }));
import { Workflow } from "@/components/forms/Workflow";
const id = "10000000-0000-4000-8000-000000000002";
const render = (path: string) => renderToStaticMarkup(createElement(Workflow, { path }));
beforeEach(() => { state.queried = []; state.empty = false; });
test("감사 전용 역할의 폼 로그는 본문·응답 API 없이 전용 기록을 조회한다", () => {
 const html = render(`/form/manage/applicant/log/${id}`);
 expect(html).toContain("캐치폼 감사 로그"); expect(html).toContain("submission.viewed"); expect(html).not.toContain("응답 정보");
 expect(state.queried).toContain(`/forms/${id}/audit-events?scope=company&kind=all&page=1&pageSize=10`);
 expect(state.queried).not.toContain(`/forms/${id}`); expect(state.queried.some(p => p.includes("/submissions"))).toBe(false);
});
test("잘못된 로그 주소는 조회를 보내지 않는다", () => { expect(render("/form/manage/applicant/log/invalid")).toContain("로그 주소"); expect(state.queried).toEqual([]); });
test("URI의 서비스가 폼과 다르면 응답 목록을 렌더하지 않는다", () => { expect(render(`/form/manage/applicant/10000000-0000-4000-8000-000000000009/${id}`)).toContain("서비스를 확인"); expect(state.queried.some(p => p.includes("/submissions"))).toBe(false); });
test("빈 감사 안내는 표 스크롤 밖에 표시된다", () => { state.empty = true; const html = render(`/form/manage/applicant/log/${id}`); expect(html.indexOf("조회된 감사 기록이 없습니다.")).toBeLessThan(html.indexOf('class="cs-table-wrap"')); });
