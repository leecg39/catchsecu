import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ capabilities: ["message.manage"], status: "approved", error: null as null | { message: string }, queried: [] as string[], channels: [] as { id: string; name: string; searchId: string; status: string }[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/ApplicationContext", () => ({ useApplication: () => ({ data: { capabilities: state.capabilities, serviceId: "service", services: [] } }) }));
vi.mock("@/lib/api", () => ({ api: vi.fn(), ApiError: class extends Error { status=409; }, errorText: String, useResource: (path: string | null) => {
 if (!path) return { reload: vi.fn() };
 state.queried.push(path);if (path.includes("?serviceId=")) return { reload: vi.fn(), error: state.error, data: { items: path.startsWith("/kakao/channels?") ? state.channels : [] } };return { reload: vi.fn(), error: state.error, data: { id: "10000000-0000-4000-8000-000000000001", serviceId: "service", channelId: "channel", version: 4, name: "검증 템플릿", body: "#{name}님 안내", status: state.status, reviewNote: "심사 의견", buttons: [{ name: "자세히", type: "WL", link: "https://example.test" }] } };
} }));
import { ServicesPages } from "@/components/services";
const id="10000000-0000-4000-8000-000000000001";
const render = (suffix="") => renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates/"+id+suffix}));
beforeEach(()=>{state.capabilities=["message.manage"];state.status="approved";state.error=null;state.queried=[];state.channels=[];});
test("상세 경로는 실제 본문·버튼·심사 상태와 수정 링크를 렌더한다",()=>{const html=render();expect(html).toContain("알림톡 템플릿 상세");expect(html).toContain("검증 템플릿");expect(html).toContain("#{name}님 안내");expect(html).toContain("자세히");expect(html).toContain("템플릿 수정");expect(state.queried).toEqual(["/kakao/templates/"+id]);});
test("수정 경로는 기존 값을 채우고 서버 계약 길이와 변수 미리보기를 제공한다",()=>{const html=render("/edit");expect(html).toContain("알림톡 템플릿 수정");expect(html).toContain('maxLength="100"');expect(html).toContain('maxLength="1000"');expect(html).toContain("버튼 1 주소");expect(html).toContain("name 변수 값");});
test.each(["submitted","archived"])("%s 상태는 수정 필드를 잠근다",status=>{state.status=status;const html=render("/edit");expect(html).toContain('<fieldset disabled=""');expect(html).not.toContain("템플릿 수정</a>");});
test("오류 응답은 이전 본문을 숨기고 다시 시도할 수 있다",()=>{state.error={message:"권한이 회수되었습니다"};const html=render();expect(html).toContain("다시 시도");expect(html).not.toContain("#{name}님 안내");});
test("관리 권한이 없으면 템플릿 API를 요청하지 않는다",()=>{state.capabilities=[];expect(render()).toContain("관리할 권한");expect(state.queried).toEqual([]);});
test("잘못된 UUID는 안내만 표시한다",()=>{expect(renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates/invalid"}))).toContain("템플릿 주소");expect(state.queried).toEqual([]);});

test("템플릿 등록 경로는 UUID 오류가 아닌 작성 화면을 표시한다",()=>{const html=renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates/register"}));expect(html).toContain("템플릿 이름");expect(html).not.toContain("템플릿 주소");});

test("목록 관리 권한이 없으면 채널·템플릿 목록을 요청하지 않는다",()=>{state.capabilities=[];const html=renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates"}));expect(html).toContain("관리할 권한");expect(state.queried).toEqual([]);});
test("목록 조회 오류는 재시도와 등록 잠금을 표시한다",()=>{state.error={message:"목록을 읽지 못했습니다"};const html=renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk/templates"}));expect(html).toContain("채널 다시 불러오기");expect(html).toContain("템플릿 다시 불러오기");expect(html).toContain('<fieldset disabled=""');});

test("이름이 같은 채널도 검색 ID로 수정·삭제 버튼을 구분한다",()=>{state.channels=[{id:"first",name:"같은 이름",searchId:"@first",status:"verified"},{id:"second",name:"같은 이름",searchId:"@second",status:"verified"}];const html=renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk"}));for(const id of ["first","second"]){expect(html).toContain('aria-label="같은 이름 @'+id+' 채널 수정"');expect(html).toContain('aria-label="같은 이름 @'+id+' 채널 삭제·보관"');}});

test("보관한 채널은 수정·삭제 버튼 대신 보관 상태를 표시한다",()=>{state.channels=[{id:"archived",name:"과거 채널",searchId:"@archived",status:"archived"}];const html=renderToStaticMarkup(createElement(ServicesPages,{path:"/alimtalk"}));expect(html).toContain("보관된 채널");expect(html).not.toContain('aria-label="과거 채널 @archived 채널 수정"');expect(html).not.toContain('aria-label="과거 채널 @archived 채널 삭제·보관"');});
