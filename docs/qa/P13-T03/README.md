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
