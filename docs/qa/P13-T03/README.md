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
