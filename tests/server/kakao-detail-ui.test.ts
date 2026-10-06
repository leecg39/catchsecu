import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ capabilities: ["message.manage"], status: "approved", error: null as null | { message: string }, queried: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/ApplicationContext", () => ({ useApplication: () => ({ data: { capabilities: state.capabilities, serviceId: "service", services: [] } }) }));
vi.mock("@/lib/api", () => ({ api: vi.fn(), ApiError: class extends Error { status=409; }, errorText: String, useResource: (path: string) => {
 state.queried.push(path);return { reload: vi.fn(), error: state.error, data: { id: "10000000-0000-4000-8000-000000000001", serviceId: "service", channelId: "channel", version: 4, name: "검증 템플릿", body: "#{name}님 안내", status: state.status, reviewNote: "심사 의견", buttons: [{ name: "자세히", type: "WL", link: "https://example.test" }] } };
} }));
import { ServicesPages } from "@/components/services";
const id="10000000-0000-4000-8000-000000000001";
const render = (suffix="") => renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates/"+id+suffix}));
beforeEach(()=>{state.capabilities=["message.manage"];state.status="approved";state.error=null;state.queried=[];});
test("상세 경로는 실제 본문·버튼·심사 상태와 수정 링크를 렌더한다",()=>{const html=render();expect(html).toContain("알림톡 템플릿 상세");expect(html).toContain("검증 템플릿");expect(html).toContain("#{name}님 안내");expect(html).toContain("자세히");expect(html).toContain("템플릿 수정");expect(state.queried).toEqual(["/kakao/templates/"+id]);});
test("수정 경로는 기존 값을 채우고 서버 계약 길이와 변수 미리보기를 제공한다",()=>{const html=render("/edit");expect(html).toContain("알림톡 템플릿 수정");expect(html).toContain('maxLength="100"');expect(html).toContain('maxLength="1000"');expect(html).toContain("버튼 1 주소");expect(html).toContain("name 변수 값");});
test.each(["submitted","archived"])("%s 상태는 수정 필드를 잠근다",status=>{state.status=status;const html=render("/edit");expect(html).toContain('<fieldset disabled=""');expect(html).not.toContain("템플릿 수정</a>");});
test("오류 응답은 이전 본문을 숨기고 다시 시도할 수 있다",()=>{state.error={message:"권한이 회수되었습니다"};const html=render();expect(html).toContain("다시 시도");expect(html).not.toContain("#{name}님 안내");});
test("관리 권한이 없으면 템플릿 API를 요청하지 않는다",()=>{state.capabilities=[];expect(render()).toContain("관리할 권한");expect(state.queried).toEqual([]);});
test("잘못된 UUID는 안내만 표시한다",()=>{expect(renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates/invalid"}))).toContain("템플릿 주소");expect(state.queried).toEqual([]);});

test("템플릿 등록 경로는 UUID 오류가 아닌 작성 화면을 표시한다",()=>{const html=renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates/register"}));expect(html).toContain("템플릿 이름");expect(html).not.toContain("템플릿 주소");});
