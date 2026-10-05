# P13-T03 내비게이션·모달·캐시 일관성 — 진행 중

> 2026-10-07. 전체 완료 아님 — 아래는 이번에 실측·수정한 범위.

## 발견·수정된 결함

사이드바 footer의 **홈페이지 / 개인정보 처리방침 / 서비스 이용약관** 버튼이 실제 목적지 없이 placeholder 모달("연결된 화면을 확인해주세요.")만 열었다 — "모든 visible action이 실제 API/이동에 연결" 조건 위반.

- `src/components/AppShell.tsx`: 세 버튼을 실제 링크로 교체 — 홈페이지 → `https://catchsecu.com`(새 탭, noopener), 처리방침 → `/legal/privacy`, 이용약관 → `/legal/terms`
- `src/components/LegalPages.tsx`: 플랫폼 처리방침·이용약관 실제 정적 문서 (Panel/cs-gate 스타일, 돌아가기·로그인 링크)
- `src/app/[[...slug]]/page.tsx`: `/legal/(privacy|terms)`를 known 시스템 경로로 추가
- `src/lib/public-paths.ts`: `/legal` 접두사 공개(미로그인 열람 가능 — 법적 문서의 통상 정책)
- `src/components/CloneApp.tsx`: `/legal/*` → LegalPages (셸 없는 공개 문서)
- `src/components/auth/LiveAuth.tsx`: 회원가입 동의 체크박스 문구를 실제 약관·방침 문서 링크로 연결(새 탭)

## 실브라우저 검증 (chrome-devtools → :3100 dev)

| 항목 | 실측 |
|---|---|
| 익명 `/legal/terms`·`/legal/privacy` | 200, 실제 조항 렌더링(로그인 리디렉션 없음 — 공개 문서) |
| `/legal`·`/legal/unknown` | 404 |
| 로그인 상태 footer | 세 링크 href 실제 값 확인; `개인정보 처리방침` 클릭 → `/legal/privacy` 이동 |
| `/signup` SSR | 약관·방침 링크가 서버 렌더 HTML에 존재 |

검증: tsc 0 오류, eslint 0 오류(img 경고 1, 기존), auth-navigation·auth-session-gate·context-audit **38/38 통과**, verify-plan 181 경로 유지(manifest 미변경 — /legal은 원본 외 로컬 시스템 경로).

## 남은 범위

- 모든 메뉴·헤더·모달 action의 전수 클릭 감사와 서버 cache invalidation 일관성(새로고침/뒤로가기 후 stale 데이터), loading/empty/validation/conflict/forbidden/retry/disabled 상태별 화면 증거
- 181개 경로 전체 화면 게이트는 P13-T04에서 처리

## 전수 action 감사 + 캐시 일관성 (2026-10-05)

**정적 감사** — `src/components/**/*.tsx`의 모든 `<button>`을 태그 끝까지 파싱해 핸들러(`onClick`/`type=submit`/`formAction`) 유무를 검사했다(중괄호 중첩 인식). `href="#"`·`javascript:void`·빈 onClick·`alert(` 0건.

핸들러 없는 `<button>` 16건 전부 의도된 비액션으로 확인:
- `shared.tsx` `ActionButton` — `{...props}`로 호출측 onClick 전달(조합 연결)
- `shared.tsx` `DataTable` 현재 페이지 `<button className="active">` — 페이지 인디케이터
- `auth/LiveAuth.tsx` 7건 — 부모 `<form onSubmit>`의 기본 submit 버튼
- `services/kakao.tsx` 7건 — Infotalk 미리보기 목업의 표시 전용 버튼

**캐시 일관성 실측** — `scripts/qa-cache-consistency.ts` + [cache-consistency.json](cache-consistency.json) 3/3:
- 서버에서 서비스 externalName을 직접 변경 → 브라우저 새로고침에 새 값 반영
- 다른 화면 이동 → 뒤로가기 → 최신값 유지(bfcache·SPA 캐시 stale 없음)
- 값 원복 → 새로고침 시 원복값 반영(읽기 캐시 없음 재확인)
- 구조적 근거: `src/lib/api.ts`의 `api()`는 모든 요청에 `cache: "no-store"`, `useResource`는 마운트·reload마다 재조회

남은 범위: loading/empty/validation/conflict/forbidden/retry 상태별 화면 증거의 전수 캡처와 원본 대조는 계속 미완료.

## 상태별 화면 실측 (2026-10-05, `scripts/qa-state-screens.ts` → [state-screens.json](state-screens.json), [screens](states/))

viewer 계정으로 상태별 화면을 실브라우저 실측했다. 7/7 통과.

| 상태 | 경로/시나리오 | 실측 |
|---|---|---|
| forbidden 404 | `/security/policy`·`/member` | viewer 미소유 경로는 404로 종결(스크린샷 첨부) |
| forbidden 게이트 | `/security/sso/setting` | 목록 API가 403을 반환하고 화면은 "이 작업을 수행할 권한이 없습니다" + 다시 불러오기 버튼 |
| 일반 화면 | `/company-info` | 회사 등록 폼 200 — 모든 로그인 사용자에게 허용되는 경로 |
| 목록/empty | `/notice` | 공지 목록 정상 렌더, viewer에게 관리 액션 버튼(삭제·새 공지) 노출 0 |
| pageerror | 전 경로 | 앱 오류 0(dev 서버의 Performance.measure 잡음만 필터링) |

남은 범위: validation/conflict/disabled 상태의 화면 전수 캡처와 원본 대조는 계속 미완료.

## conflict 상태 실측 (2026-10-05, `scripts/qa-conflict-state.ts` → [conflict-state.json](conflict-state.json))

같은 프로필 편집 화면을 두 탭에서 열어 stale version 저장 경합을 유발했다. [스크린샷](states/conflict-profile.png):

- 탭 A 저장 → `PATCH /me` 성공, DB의 name 즉시 갱신 확인
- 탭 B(구 version) 저장 → 409 `VERSION_CONFLICT` → 화면에 "다른 곳에서 변경한 프로필…" 안내 + **최신 프로필 다시 불러오기** 버튼 + 저장 버튼 비활성(conflict 해소 전 재전송 차단)
- 시험 후 원래 이름으로 복구

## loading·validation·disabled·error·retry 실측 (2026-10-05, `scripts/qa-ui-states.ts` → [ui-states.json](ui-states.json))

`/mail/number` 발신 주소 관리 화면에서 네트워크 주입(`page.route`)으로 상태를 유발했다. 5/5 통과.

| 상태 | 유발 방법 | 실측 |
|---|---|---|
| loading | 목록 API 1.5초 지연 | `role="status"` "불러오는 중입니다." 표시 ([loading-senders.png](states/loading-senders.png)) |
| validation | 등록 모달에 잘못된 이메일 제출 | `role="alert"` "입력 내용을 확인해주세요." 표시 ([validation-sender.png](states/validation-sender.png)) |
| disabled/busy | 등록 API 지연 중 제출 버튼 | `disabled` 속성 + "등록 중…" 라벨 — 이중 제출 차단 ([disabled-busy.png](states/disabled-busy.png)) |
| error | 목록 API를 arm 동안 전부 500 응답 | `role="alert"` 오류 메시지가 테이블에 표시 ([error-retry.png](states/error-retry.png)) — AbortError는 `useResource`가 의도적으로 무시(내비게이션 취소), 실제 실패만 오류 상태가 됨 |
| retry | arm 해제 후 새로고침/reload | 목록 정상 복구 — stale 오류 잔류 없음 |

주의: React strict-mode 이중 마운트로 첫 실패만 유발하면 두 번째 요청이 성공해 오류가 덮인다 — error 상태 실측은 지속 실패 구간이 필요하다(스크립트에 반영).

남은 범위: empty 상태는 [P12-T02 빈 테넌트 실측](../P12-T02/)과 P14-T01 빈 계정 경로에서 부분 확인. 원본 대조와 전 경로 상태 전수 캡처는 계속 미완료.

## 전수 action 감사 스윕 (2026-10-12, `scripts/qa-action-audit.ts` → [action-audit.json](action-audit.json))

매니페스트의 모든 경로를 owner 계정 실브라우저로 방문해 보이는 버튼 전수 클릭 + 동일 출처 링크 실제 GET 검증. 결과: **169 경로, 버튼 1,792개 발견, 468회 클릭, 1,243개 스킵(파괴적 동작·중복 라벨), 경로 오류 0**.

- **발견된 실버그 2건 → 수정 완료**
  - `/alimtalk/direct`·`/alimtalk/catchform` 링크 404 — `KakaoTemplates`/`CampaignPage`가 생성하는 링크가 라우트 화이트리스트에 없어 404. `page.tsx`에 `kakaoCampaign` 허용 경로 추가(리서치 매니페스트는 원본 서비스 기록이므로 오염하지 않음).
  - `/form/ai/create` 등 3개 경로의 `다음으로` 버튼이 신규 폼(레코드 없음·clean)에서 무음 no-op — `draft.save()`가 `!dirty && !force`일 때 undefined 반환으로 검증 피드백 자체가 표시되지 않았음. `draft.save(!draft.record)`로 바꿔 신규 폼에서는 강제 검증 → `role="alert"` "제목·질문·선택 항목과 설정 범위를 확인해주세요." 표시 확인.
- **수정 후 재검증**: 해당 경로만 필터 재실행 — `/alimtalk/direct`·`/alimtalk/catchform`·`/alimtalk/send`(원본 URL, 카카오 직접 발송 화면에 연결) 모두 200 + 버튼 효과 확인, badLinks 해소.
- **dead로 보고된 나머지 80건 분류**: 실버그는 위 2건 + 다음으로뿐, 나머지는 수동 실측으로 오탐 확정 —
  - 상태 가드된 no-op(정상): `검색` 27건·`기간 적용`/`기본 기간` 18건 — 입력이 없거나 필터가 이미 동일 상태면 React가 동일 state set을 건너뛰어 재조회 없음. 입력 후 클릭 시 `/api/v1/notices?search=…`·`/api/v1/forms?search=…` 등 실조회 확인.
  - 이미 활성인 컨트롤: 현재 페이지 `1`(12), 선택됨 `◉`(7), 기본 탭 `비밀번호 변경`·`받은 요청`·`본인인증 사용 내역`·`캐치폼 템플릿`·`개인정보 수집·이용 동의서`·`전체 미리보기`, 기본 언어 `한국어`.
  - 같은 길이 DOM 갱신 오탐: `복구코드 사용`(3) — 실제로 백업코드 입력 모드로 전환됨(수동 실측에서 DOM 변경 확인).
  - 표본 UI: `kakao-playground`의 `채널 추가`·`버튼 이름 입력` — 디자인 표본용 무핸들러 버튼(정적 감사의 "의도된 비액션"과 동일).
  - 감사 자체의 선행 클릭 오탐: `다음으로` 재실행 시 이전 클릭이 invalid 자동저장을 유발해 오류가 이미 표시된 상태 — 동일 오류 재표시는 DOM delta 없음으로 dead 집계. 최초 클릭에는 오류가 표시됨(수동 실측).
- **파괴적 액션 미클릭**: 삭제·발송·결제·승인 등 부작용 버튼 1,243건은 클릭 자체가 실제 쓰기이므로 제외 — 이들의 배선 검증은 각 도메인 QA(캠페인 발송/결제/파기 등)에서 별도 실측.

남은 범위: 스킵된 파괴적 버튼의 UI→API 배선은 서버 통합 테스트가 담보, 원본 서비스와의 화면 대조는 외부 접근 불가로 계속 미완료.
